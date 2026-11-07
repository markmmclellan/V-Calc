import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FieldState, SideState, Terrain, Weather } from '../lib/calc';
import type { Marks, Vol } from '../lib/bot';
import { baseName, CHARGE_MOVES, maxHpOf } from '../lib/bot';
import type { PokemonSet, Status } from '../lib/model';
import { spriteSources } from '../lib/sprites';
import Sprite from './Sprite';

/**
 * The battle drawn like a battle screen (theirs top right, yours bottom left), for updating it quickly during a game:
 * drag an HP bar, tap a status or stat tag, tap a move for "last move", tap a team icon when a Pokémon comes in.
 * Everything it changes is V-Calc's own battle state (HP, status, boosts, field) or the AI panel's marks.
 */
interface Props {
  mine: PokemonSet[]; // your three
  theirs: PokemonSet[]; // their six
  mineActive?: PokemonSet;
  theirActive?: PokemonSet;
  mark: (side: 0 | 1, s: PokemonSet) => Marks;
  setMark: (side: 0 | 1, s: PokemonSet, patch: Partial<Marks>) => void;
  isAppeared: (s: PokemonSet) => boolean;
  vol: [Vol, Vol];
  /** the panel's turn number: tapping the last move again on a later turn records it again instead of clearing it */
  turn: number;
  patchVol: (side: 0 | 1, patch: Partial<Vol>) => void;
  patchSet: (side: 0 | 1, s: PokemonSet, patch: Partial<PokemonSet>) => void;
  sendOut: (side: 0 | 1, s: PokemonSet) => void;
  field: FieldState;
  setField: (f: (old: FieldState) => FieldState) => void;
  /** Turns left of timed effects (weather, terrain, 'tr', '<side>:isReflect', 'v<side>:taunt'…) */
  timers: Record<string, number>;
  onTimer: (key: string) => void;
}

const STATUS: [Status, string, string][] = [
  ['', 'Healthy', ''],
  ['brn', 'BRN', 'Burned'],
  ['par', 'PAR', 'Paralyzed'],
  ['psn', 'PSN', 'Poisoned'],
  ['tox', 'TOX', 'Badly poisoned'],
  ['slp', 'SLP', 'Asleep'],
  ['frz', 'FRZ', 'Frozen'],
];
const STATS = [
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'SpA'],
  ['spd', 'SpD'],
  ['spe', 'Spe'],
] as const;
const WEATHERS: Weather[] = ['', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAINS: Terrain[] = ['', 'Electric', 'Grassy', 'Misty', 'Psychic'];
/** Effects on one side kept in V-Calc's field. */
const SIDE_FX: [keyof SideState, string][] = [
  ['isSR', 'Stealth Rock'],
  ['isReflect', 'Reflect'],
  ['isLightScreen', 'Light Screen'],
  ['isAuroraVeil', 'Aurora Veil'],
  ['isTailwind', 'Tailwind'],
  ['isSeeded', 'Leech Seed'],
  ['isBound', 'Bound'],
];
/** Effects on the Pokémon that is out, kept by the AI panel. */
const VOL_FX: [keyof Vol, string][] = [
  ['yawn', 'Drowsy'],
  ['taunt', 'Taunt'],
  ['trapped', 'Trapped'],
  ['substitute', 'Substitute'],
  ['confused', 'Confused'],
];

const boostLabel = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const hpColor = (pct: number) => (pct > 50 ? 'var(--bv-green)' : pct > 20 ? 'var(--bv-yellow)' : 'var(--bv-red)');

/** Your Pokémon from behind (Showdown's back sprite), falling back to the front one. */
function BackSprite({ species, size }: { species: string; size: number }) {
  const front = spriteSources(species);
  const sources = [...front.map((u) => u.replace('/ani/', '/ani-back/').replace('/gen5/', '/gen5-back/')), ...front];
  const [n, setN] = useState({ species, i: 0 });
  const i = n.species === species ? n.i : 0;
  if (!sources[i]) return null;
  return <NaturalSprite src={sources[i]} size={size} onError={() => setN({ species, i: i + 1 })} />;
}

/** The opposing Pokémon (Showdown's animated front sprite, falling back to the static one). */
function FrontSprite({ species, size }: { species: string; size: number }) {
  const sources = spriteSources(species);
  const [n, setN] = useState({ species, i: 0 });
  const i = n.species === species ? n.i : 0;
  if (!sources[i]) return null;
  return <NaturalSprite src={sources[i]} size={size} onError={() => setN({ species, i: i + 1 })} />;
}

/** A sprite at its own size, as Showdown shows them (a small Pokémon like Ditto stays small); only very large ones are
 * scaled down to fit the field. */
function NaturalSprite({ src, size, onError }: { src: string; size: number; onError: () => void }) {
  return <img className="bv-sprite" src={src} alt="" draggable={false} style={{ maxWidth: size * 1.6, maxHeight: size * 1.4 }} onError={onError} />;
}

/** Showdown's field effect images. */
const FX = 'https://play.pokemonshowdown.com/fx';

/** An HP bar you set by clicking or dragging along it. */
function HpBar({ pct, onSet }: { pct: number; onSet: (pct: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    onSet(Math.max(1, Math.min(100, Math.round(((x - r.left) / r.width) * 100))));
  };
  return (
    <div
      ref={ref}
      className="bv-hp"
      title="Click or drag to set HP"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        at(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && at(e.clientX)}
    >
      <span style={{ width: `${pct}%`, background: hpColor(pct) }} />
    </div>
  );
}

/** A number you can type over (HP as a percentage, or your own HP in points). */
function NumBox({ value, max, onSet, label }: { value: number; max: number; onSet: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="bv-num"
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={0}
      max={max}
      value={draft ?? String(value)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onSet(Math.max(1, Math.min(max, Math.round(n))));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export default function BattleView(p: Props) {
  // one small menu open at a time ("status-0", "boosts-1", "fx-0", "field"); a click elsewhere closes it
  const [menu, setMenu] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.bv-menu, .bv-open')) setMenu('');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  const toggle = (m: string) => setMenu((o) => (o === m ? '' : m));
  /** Turns left on a timed effect; tap for one less (wraps 1 → 8 for Light Clay, Damp Rock…). */
  const tm = (k: string) =>
    p.timers[k] !== undefined ? (
      <span
        className="bv-timer"
        title="Turns left (counts down with the turn number). Tap for one less."
        onClick={(e) => {
          e.stopPropagation();
          p.onTimer(k);
        }}
      >
        {p.timers[k]}
      </span>
    ) : null;

  const sideKey = (side: 0 | 1) => (side === 0 ? 'attackerSide' : 'defenderSide');
  const setSide = (side: 0 | 1, k: keyof SideState, v: boolean | number) =>
    p.setField((f) => ({ ...f, [sideKey(side)]: { ...f[sideKey(side)], [k]: v } }));
  /** Spikes 0-3, Toxic Spikes 0-2: each tap adds a layer, then back to none. */
  const LAYERS: ['spikes' | 'toxicSpikes', string, number][] = [
    ['spikes', 'Spikes', 3],
    ['toxicSpikes', 'Toxic Spikes', 2],
  ];
  const layers = (side: 0 | 1, k: 'spikes' | 'toxicSpikes') => p.field[sideKey(side)][k] || 0;

  /** Name, HP, status, stat stages and effects of the Pokémon that is out. */
  const statBox = (side: 0 | 1, s: PokemonSet | undefined) => {
    if (!s) return <div className={`bv-stat ${side ? 'opp' : 'me'}`}>{side ? 'Tap the one they send out' : 'Tap your Pokémon that is out'}</div>;
    const m = p.mark(side, s);
    const max = side === 0 ? maxHpOf(s) : undefined;
    const pct = m.ko ? 0 : s.hpPercent;
    const st = STATUS.find((x) => x[0] === s.status) ?? STATUS[0];
    const boosts = STATS.filter(([k]) => s.boosts[k]);
    const sideState = p.field[sideKey(side)];
    const tags: ReactNode[] = [];
    for (const [k, l] of SIDE_FX)
      if (sideState[k])
        tags.push(
          <button key={k} className="bv-tag fx" title="Tap to remove" onClick={() => setSide(side, k, false)}>
            {l}
            {tm(`${side}:${k}`)}
          </button>,
        );
    for (const [k, l] of LAYERS)
      if (layers(side, k))
        tags.push(
          <button key={k} className="bv-tag fx" title="Tap to remove" onClick={() => setSide(side, k, 0)}>
            {l}
            {layers(side, k) > 1 ? ` ×${layers(side, k)}` : ''}
          </button>,
        );
    if (p.vol[side].transformed)
      tags.push(
        <span key="tf" className="bv-tag fx" title="Transform / Imposter: it copied this Pokémon (types, stats, moves)">
          Transformed: {p.vol[side].transformed}
        </span>,
      );
    if (p.vol[side].disabled)
      tags.push(
        <button key="dis" className="bv-tag fx" title="Tap to remove" onClick={() => p.patchVol(side, { disabled: undefined })}>
          Disabled: {p.vol[side].disabled}
        </button>,
      );
    const ch = p.vol[side].charging;
    if (ch)
      tags.push(
        <button key="charging" className="bv-tag fx" title={`${ch} lands next turn. Tap to remove`} onClick={() => p.patchVol(side, { charging: undefined, charge_turn: undefined })}>
          {CHARGE_MOVES[ch] ?? 'Charging'} ({ch})
        </button>,
      );
    for (const [k, l] of VOL_FX)
      if (p.vol[side][k])
        tags.push(
          <button key={k} className="bv-tag fx" title="Tap to remove" onClick={() => p.patchVol(side, { [k]: false })}>
            {l}
            {tm(`v${side}:${k}`)}
          </button>,
        );
    if (p.vol[side].encore)
      tags.push(
        <button key="enc" className="bv-tag fx" title="Tap to remove" onClick={() => p.patchVol(side, { encore: undefined })}>
          Encore: {p.vol[side].encore}
          {tm(`v${side}:encore`)}
        </button>,
      );
    return (
      <div className={`bv-stat ${side ? 'opp' : 'me'}${menu.endsWith(`-${side}`) ? ' raised' : ''}`}>
        <div className="bv-name">
          <strong>{s.species}</strong>
          <span className="bv-flags">
            <button className={'bv-flag' + (m.mega ? ' on' : '')} title="It has Mega Evolved" onClick={() => p.setMark(side, s, { mega: !m.mega })}>
              Mega
            </button>
            <button className={'bv-flag' + (m.gone ? ' on' : '')} title="Its item is gone (berry eaten, knocked off…)" onClick={() => p.setMark(side, s, { gone: !m.gone })}>
              Item gone
            </button>
            <button className={'bv-flag ko' + (m.ko ? ' on' : '')} title="It fainted" onClick={() => p.setMark(side, s, { ko: !m.ko })}>
              Fainted
            </button>
          </span>
        </div>
        <div className="bv-hprow">
          <HpBar pct={pct} onSet={(n) => p.patchSet(side, s, { hpPercent: n })} />
          {max ? (
            <span className="bv-hptext">
              <NumBox label="HP" value={Math.max(0, Math.round((pct * max) / 100))} max={max} onSet={(n) => p.patchSet(side, s, { hpPercent: (n / max) * 100 })} />/{max}
            </span>
          ) : (
            <span className="bv-hptext">
              <NumBox label="HP percent" value={Math.round(pct)} max={100} onSet={(n) => p.patchSet(side, s, { hpPercent: n })} />%
            </span>
          )}
        </div>
        <div className="bv-tags">
          <span className="bv-anchor">
            <button className={`bv-tag status bv-open ${st[0] || 'none'}`} title="Status" onClick={() => toggle(`status-${side}`)}>
              {st[0] ? st[1] : 'Status'}
            </button>
            {menu === `status-${side}` && (
              <div className="bv-menu">
                {STATUS.map(([v, , l]) => (
                  <button
                    key={v || 'none'}
                    className={v === s.status ? 'on' : ''}
                    onClick={() => {
                      p.patchSet(side, s, { status: v });
                      setMenu('');
                    }}
                  >
                    {l || 'Healthy'}
                  </button>
                ))}
              </div>
            )}
          </span>
          <span className="bv-anchor">
            <button className="bv-tag boost bv-open" title="Stat stages" onClick={() => toggle(`boosts-${side}`)}>
              {boosts.length ? boosts.map(([k, l]) => `${boostLabel(s.boosts[k])} ${l}`).join(' ') : 'Stats ±'}
            </button>
            {menu === `boosts-${side}` && (
              <div className="bv-menu bv-boosts">
                {STATS.map(([k, l]) => (
                  <div key={k} className="bv-boost">
                    <span>{l}</span>
                    <button onClick={() => p.patchSet(side, s, { boosts: { ...s.boosts, [k]: Math.max(-6, s.boosts[k] - 1) } })}>−</button>
                    <b className={s.boosts[k] > 0 ? 'up' : s.boosts[k] < 0 ? 'down' : ''}>{boostLabel(s.boosts[k])}</b>
                    <button onClick={() => p.patchSet(side, s, { boosts: { ...s.boosts, [k]: Math.min(6, s.boosts[k] + 1) } })}>+</button>
                  </div>
                ))}
                <button className="bv-reset" onClick={() => p.patchSet(side, s, { boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })}>
                  Reset
                </button>
              </div>
            )}
          </span>
          {tags}
          <span className="bv-anchor">
            <button className="bv-tag add bv-open" title="Add an effect" onClick={() => toggle(`fx-${side}`)}>
              + effect
            </button>
            {menu === `fx-${side}` && (
              <div className="bv-menu">
                {SIDE_FX.map(([k, l]) => (
                  <button key={k} className={sideState[k] ? 'on' : ''} onClick={() => setSide(side, k, !sideState[k])}>
                    {l}
                  </button>
                ))}
                {LAYERS.map(([k, l, max]) => (
                  <button key={k} className={layers(side, k) ? 'on' : ''} title="Each tap adds a layer" onClick={() => setSide(side, k, (layers(side, k) + 1) % (max + 1))}>
                    {l}
                    {layers(side, k) ? ` ×${layers(side, k)}` : ''}
                  </button>
                ))}
                {VOL_FX.map(([k, l]) => (
                  <button key={k} className={p.vol[side][k] ? 'on' : ''} onClick={() => p.patchVol(side, { [k]: !p.vol[side][k] })}>
                    {l}
                  </button>
                ))}
                <button
                  className={p.vol[side].disabled ? 'on' : ''}
                  disabled={!p.vol[side].disabled && !p.vol[side].last_move}
                  title={p.vol[side].last_move ? `${p.vol[side].last_move} can't be used for a few turns` : 'Pick its last move below first'}
                  onClick={() => p.patchVol(side, { disabled: p.vol[side].disabled ? undefined : p.vol[side].last_move })}
                >
                  Disable{p.vol[side].last_move ? ` (${p.vol[side].last_move})` : ''}
                </button>
                <button
                  className={p.vol[side].encore ? 'on' : ''}
                  disabled={!p.vol[side].encore && !p.vol[side].last_move}
                  title={p.vol[side].last_move ? `Encored into ${p.vol[side].last_move}` : 'Pick its last move below first'}
                  onClick={() => p.patchVol(side, { encore: p.vol[side].encore ? undefined : p.vol[side].last_move })}
                >
                  Encore{p.vol[side].last_move ? ` (${p.vol[side].last_move})` : ''}
                </button>
              </div>
            )}
          </span>
        </div>
        {moves(side, s)}
      </div>
    );
  };

  /** Team icons: tap the one that comes in. Theirs that have not appeared are faded. */
  const party = (side: 0 | 1, list: PokemonSet[], out: PokemonSet | undefined) => (
    <div className={`bv-party ${side ? 'opp' : 'me'}`}>
      {list.map((s) => {
        const m = p.mark(side, s);
        const isOut = !!out && baseName(s) === baseName(out);
        const unseen = side === 1 && !isOut && !p.isAppeared(s);
        return (
          <button
            key={baseName(s)}
            className={'bv-icon' + (isOut ? ' out' : '') + (m.ko ? ' ko' : '') + (unseen ? ' unseen' : '')}
            title={`${s.species}${m.ko ? ' (fainted)' : ''}: tap when it comes in`}
            onClick={() => p.sendOut(side, s)}
          >
            <Sprite species={s.species} size={30} />
            <span>{m.ko ? 'KO' : `${Math.round(s.hpPercent)}%`}</span>
          </button>
        );
      })}
    </div>
  );

  /** "Last move": tap the move it just used (theirs also counts as seen). */
  const moves = (side: 0 | 1, s: PokemonSet | undefined) => {
    if (!s) return null;
    const last = p.vol[side].last_move;
    const m = p.mark(side, s);
    return (
      <div className="bv-moves">
        <span className="hint">
          Last move{p.vol[side].first_move && p.vol[side].first_move !== last ? ` (first: ${p.vol[side].first_move})` : ''}
        </span>
        {s.moves.map((mv, k) =>
          mv ? (
            <button
              key={k}
              className={'bv-move' + (last === mv ? ' on' : '') + (last === mv && p.vol[side].last_move_turn !== p.turn ? ' old' : '') + (side === 1 && m.moves[k] ? ' seen' : '')}
              title={last === mv && p.vol[side].last_move_turn !== p.turn ? 'Used on an earlier turn: tap if it used it again' : side === 1 && m.moves[k] ? 'Seen' : 'Tap if it just used this'}
              onClick={() => {
                // tapped again this turn: a mis-tap, clear it; on a later turn: it used the same move again
                const same = last === mv && p.vol[side].last_move_turn === p.turn;
                p.patchVol(side, { last_move: same ? undefined : mv });
                if (side === 1 && !same && !m.moves[k]) p.setMark(1, s, { moves: m.moves.map((x, j) => (j === k ? true : x)) });
              }}
            >
              {mv}
            </button>
          ) : null,
        )}
      </div>
    );
  };

  const f = p.field;
  const fieldBits: ReactNode[] = [];
  if (f.weather)
    fieldBits.push(
      <span key="w">
        {f.weather}
        {tm('weather')}
      </span>,
    );
  if (f.terrain)
    fieldBits.push(
      <span key="t">
        {f.terrain} Terrain{tm('terrain')}
      </span>,
    );
  if (f.isTrickRoom)
    fieldBits.push(
      <span key="r">
        Trick Room{tm('tr')}
      </span>,
    );
  /** What is on each side of the field, drawn: rocks, screens, wind. */
  const sideArt = (side: 0 | 1) => {
    const sd = f[sideKey(side)];
    const at = side ? 'opp' : 'me';
    return (
      <>
        {sd.isSR && (
          <div className={`bv-rocks ${at}`} aria-hidden>
            {['rock1', 'rock2', 'rock1', 'rock2'].map((r, i) => (
              <img key={i} src={`${FX}/${r}.png`} alt="" />
            ))}
          </div>
        )}
        {(sd.spikes || 0) > 0 && (
          <div className={`bv-spikes ${at}`} aria-hidden>
            {Array.from({ length: sd.spikes }, (_, i) => (
              <img key={i} src={`${FX}/caltrop.png`} alt="" />
            ))}
          </div>
        )}
        {(sd.toxicSpikes || 0) > 0 && (
          <div className={`bv-spikes toxic ${at}`} aria-hidden>
            {Array.from({ length: sd.toxicSpikes || 0 }, (_, i) => (
              <img key={i} src={`${FX}/poisoncaltrop.png`} alt="" />
            ))}
          </div>
        )}
        {sd.isReflect && <div className={`bv-screen reflect ${at}`} aria-hidden />}
        {sd.isLightScreen && <div className={`bv-screen light ${at}`} aria-hidden />}
        {sd.isAuroraVeil && <div className={`bv-screen veil ${at}`} aria-hidden />}
        {sd.isTailwind && <div className={`bv-wind ${at}`} aria-hidden />}
      </>
    );
  };

  return (
    <div className="bv-wrap" ref={root}>
      <div className="bv">
        {f.terrain && <div className={`bv-terrain ${f.terrain.toLowerCase()}`} aria-hidden />}
        {f.weather && <div className={`bv-weather ${f.weather.toLowerCase().split(' ')[0]}`} aria-hidden />}
        {f.isTrickRoom && <div className="bv-tr" aria-hidden />}
        {sideArt(1)}
        {sideArt(0)}
        <div className="bv-field">
          <span className="bv-anchor">
            <button className="bv-tag bv-open" onClick={() => toggle('field')} title="Weather, terrain, Trick Room">
              {fieldBits.length ? fieldBits : '+ field'}
            </button>
            {menu === 'field' && (
              <div className="bv-menu bv-fieldmenu">
                <div className="hint">Weather</div>
                {WEATHERS.map((w) => (
                  <button key={w || 'none'} className={f.weather === w ? 'on' : ''} onClick={() => p.setField((o) => ({ ...o, weather: w }))}>
                    {w || 'None'}
                  </button>
                ))}
                <div className="hint">Terrain</div>
                {TERRAINS.map((t) => (
                  <button key={t || 'none'} className={f.terrain === t ? 'on' : ''} onClick={() => p.setField((o) => ({ ...o, terrain: t }))}>
                    {t || 'None'}
                  </button>
                ))}
                <button className={f.isTrickRoom ? 'on' : ''} onClick={() => p.setField((o) => ({ ...o, isTrickRoom: !o.isTrickRoom }))}>
                  Trick Room
                </button>
              </div>
            )}
          </span>
        </div>
        {party(1, p.theirs, p.theirActive)}
        {statBox(1, p.theirActive)}
        <div className="bv-pad opp" />
        <div className="bv-mon opp">{p.theirActive && <FrontSprite species={p.theirActive.species} size={110} />}</div>
        <div className="bv-pad me" />
        <div className="bv-mon me">{p.mineActive && <BackSprite species={p.mineActive.species} size={140} />}</div>
        {statBox(0, p.mineActive)}
        {party(0, p.mine, p.mineActive)}
      </div>
    </div>
  );
}
