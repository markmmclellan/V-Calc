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
  /** Doubles: the second Pokémon out on each side (the right slot) */
  doubles?: boolean;
  minePartner?: PokemonSet;
  theirPartner?: PokemonSet;
  /** Their Pokémon is really their Zoroark (Illusion): swaps it in place; given when their six include one not out */
  onIllusion?: (s: PokemonSet) => void;
  /** Doubles drawn as Showdown does: small name / HP bars over the sprites (tap one to edit it), the teams at the sides */
  showdown?: boolean;
  mark: (side: 0 | 1, s: PokemonSet) => Marks;
  setMark: (side: 0 | 1, s: PokemonSet, patch: Partial<Marks>) => void;
  isAppeared: (s: PokemonSet) => boolean;
  vol: [Vol, Vol];
  /** the panel's turn number: tapping the last move again on a later turn records it again instead of clearing it */
  turn: number;
  patchVol: (side: 0 | 1, patch: Partial<Vol>) => void;
  /** Doubles: the effects on this Pokémon (else p.vol[side]) */
  volOf?: (side: 0 | 1, s: PokemonSet) => Vol;
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
  // every sprite scaled by the same factor, so sizes stay true to each other (Ditto small, Hippowdon big)
  const [dim, setDim] = useState<{ src: string; w: number; h: number } | null>(null);
  const k = 1.6;
  const d = dim && dim.src === src ? dim : null;
  const scale = d ? Math.min(k, (size * 1.8) / d.w, (size * 1.5) / d.h) : 1;
  return (
    <img
      className="bv-sprite"
      src={src}
      alt=""
      draggable={false}
      style={d ? { width: d.w * scale, height: d.h * scale } : { visibility: 'hidden' }}
      onLoad={(e) => setDim({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onError={onError}
    />
  );
}

/** What is on the field: the Mega form only once it has Mega Evolved (V-Calc's set may show the Mega for the worst case). */
const shown = (s: PokemonSet, mega: boolean) =>
  baseName(s) === 'Mimikyu' && s.ability === 'Disguise' && s.abilityOn ? 'Mimikyu-Busted' : mega ? s.species : baseName(s);

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
  // Showdown view: whose full box (HP, status, stats, effects, last move) is open over the field
  const [edit, setEdit] = useState('');
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

  // effects on one Pokémon (doubles keeps them per Pokémon; singles one per side)
  const vv = (side: 0 | 1, s?: PokemonSet): Vol => (s && p.volOf ? p.volOf(side, s) : p.vol[side]);
  // doubles: Leech Seed and binding are on one Pokémon, not the side
  const sideFx = p.volOf ? SIDE_FX.filter(([k]) => k !== 'isSeeded' && k !== 'isBound') : SIDE_FX;
  const volFx: [keyof Vol, string][] = p.volOf ? [...VOL_FX, ['leech_seed', 'Leech Seed'], ['bound', 'Bound']] : VOL_FX;
  const pv = (side: 0 | 1, s: PokemonSet | undefined, patch: Partial<Vol>) => p.patchVol(side, s ? { ...patch, who: baseName(s) } : patch);
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
  /** HP as the game shows it: yours in points ("146/207"), theirs as a percent. */
  const hpText = (side: 0 | 1, s: PokemonSet, pct: number): string => {
    if (side === 1) return `${Math.round(pct)}%`;
    const max = maxHpOf(s);
    if (!max) return `${Math.round(pct)}%`;
    const hp = pct > 0 ? Math.max(1, Math.round((pct * max) / 100)) : 0;
    return `${hp}/${max}`;
  };
  const statBox = (side: 0 | 1, s: PokemonSet | undefined, slot = 0) => {
    const id = slot ? `${side}b` : `${side}`;
    if (!s) return <div className={`bv-stat ${side ? 'opp' : 'me'}`}>{side ? 'Tap the one they send out' : 'Tap your Pokémon that is out'}</div>;
    const m = p.mark(side, s);
    const max = side === 0 ? maxHpOf(s) : undefined;
    const pct = m.ko ? 0 : s.hpPercent;
    const st = STATUS.find((x) => x[0] === s.status) ?? STATUS[0];
    const boosts = STATS.filter(([k]) => s.boosts[k]);
    const sideState = p.field[sideKey(side)];
    const tags: ReactNode[] = [];
    for (const [k, l] of sideFx)
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
    if (vv(side, s).transformed)
      tags.push(
        <span key="tf" className="bv-tag fx" title="Transform / Imposter: it copied this Pokémon (types, stats, moves)">
          Transformed: {vv(side, s).transformed}
        </span>,
      );
    if (vv(side, s).disabled && (!vv(side, s).who || vv(side, s).who === baseName(s)))
      tags.push(
        <button key="dis" className="bv-tag fx" title="Tap to remove" onClick={() => pv(side, s, { disabled: undefined })}>
          Disabled: {vv(side, s).disabled}
        </button>,
      );
    const ch = vv(side, s).charging;
    if (ch)
      tags.push(
        <button key="charging" className="bv-tag fx" title={`${ch} lands next turn. Tap to remove`} onClick={() => pv(side, s, { charging: undefined, charge_turn: undefined })}>
          {CHARGE_MOVES[ch] ?? 'Charging'} ({ch})
        </button>,
      );
    for (const [k, l] of volFx)
      if (vv(side, s)[k])
        tags.push(
          <button key={k} className="bv-tag fx" title="Tap to remove" onClick={() => pv(side, s, { [k]: false })}>
            {l}
            {tm(`v${side}:${k}`)}
          </button>,
        );
    if (vv(side, s).encore)
      tags.push(
        <button key="enc" className="bv-tag fx" title="Tap to remove" onClick={() => pv(side, s, { encore: undefined })}>
          Encore: {vv(side, s).encore}
          {tm(`v${side}:encore`)}
        </button>,
      );
    return (
      <div className={`bv-stat ${side ? 'opp' : 'me'}${menu.endsWith(`-${id}`) ? ' raised' : ''}`}>
        <div className="bv-name">
          <strong>{shown(s, m.mega)}</strong>
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
            {side === 1 && p.onIllusion && !baseName(s).startsWith('Zoroark') && (
              <button className="bv-flag" title="It was their Zoroark in disguise (Illusion): put Zoroark here instead, with this HP, status and stat changes" onClick={() => p.onIllusion!(s)}>
                Zoroark!
              </button>
            )}
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
            <button className={`bv-tag status bv-open ${st[0] || 'none'}`} title="Status" onClick={() => toggle(`status-${id}`)}>
              {st[0] ? st[1] : 'Status'}
            </button>
            {menu === `status-${id}` && (
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
            <button className="bv-tag boost bv-open" title="Stat stages" onClick={() => toggle(`boosts-${id}`)}>
              {boosts.length ? boosts.map(([k, l]) => `${boostLabel(s.boosts[k])} ${l}`).join(' ') : 'Stats ±'}
            </button>
            {menu === `boosts-${id}` && (
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
            <button className="bv-tag add bv-open" title="Add an effect" onClick={() => toggle(`fx-${id}`)}>
              + effect
            </button>
            {menu === `fx-${id}` && (
              <div className="bv-menu">
                {sideFx.map(([k, l]) => (
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
                {volFx.map(([k, l]) => (
                  <button key={k} className={vv(side, s)[k] ? 'on' : ''} onClick={() => pv(side, s, { [k]: !vv(side, s)[k] })}>
                    {l}
                  </button>
                ))}
                <button
                  className={vv(side, s).disabled ? 'on' : ''}
                  disabled={!vv(side, s).disabled && !vv(side, s).last_move}
                  title={vv(side, s).last_move ? `${vv(side, s).last_move} can't be used for a few turns` : 'Pick its last move below first'}
                  onClick={() => pv(side, s, { disabled: vv(side, s).disabled ? undefined : vv(side, s).last_move })}
                >
                  Disable{vv(side, s).last_move ? ` (${vv(side, s).last_move})` : ''}
                </button>
                <button
                  className={vv(side, s).encore ? 'on' : ''}
                  disabled={!vv(side, s).encore && !vv(side, s).last_move}
                  title={vv(side, s).last_move ? `Encored into ${vv(side, s).last_move}` : 'Pick its last move below first'}
                  onClick={() => pv(side, s, { encore: vv(side, s).encore ? undefined : vv(side, s).last_move })}
                >
                  Encore{vv(side, s).last_move ? ` (${vv(side, s).last_move})` : ''}
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
  const party = (side: 0 | 1, list: PokemonSet[], out: PokemonSet | undefined, out2?: PokemonSet) => (
    <div className={`bv-party ${side ? 'opp' : 'me'}`}>
      {list.map((s) => {
        const m = p.mark(side, s);
        const isOut = (!!out && baseName(s) === baseName(out)) || (!!out2 && baseName(s) === baseName(out2));
        const unseen = side === 1 && !isOut && !p.isAppeared(s);
        return (
          <button
            key={baseName(s)}
            className={'bv-icon' + (isOut ? ' out' : '') + (m.ko ? ' ko' : '') + (unseen ? ' unseen' : '')}
            title={`${s.species}${m.ko ? ' (fainted)' : ''}: tap when it comes in`}
            onClick={() => p.sendOut(side, s)}
          >
            <Sprite species={s.species} size={30} />
            <span>{m.ko ? 'KO' : hpText(side, s, s.hpPercent)}</span>
          </button>
        );
      })}
    </div>
  );

  /** "Last move": tap the move it just used (theirs also counts as seen). */
  const moves = (side: 0 | 1, s: PokemonSet | undefined) => {
    if (!s) return null;
    const last = vv(side, s).last_move;
    const m = p.mark(side, s);
    return (
      <div className="bv-moves">
        <span className="hint">
          Last move{vv(side, s).first_move && vv(side, s).first_move !== last ? ` (first: ${vv(side, s).first_move})` : ''}
        </span>
        {s.moves.map((mv, k) =>
          mv ? (
            <button
              key={k}
              className={'bv-move' + (last === mv ? ' on' : '') + (last === mv && vv(side, s).last_move_turn !== p.turn ? ' old' : '') + (side === 1 && m.moves[k] ? ' seen' : '')}
              title={last === mv && vv(side, s).last_move_turn !== p.turn ? 'Used on an earlier turn: tap if it used it again' : side === 1 && m.moves[k] ? 'Seen' : 'Tap if it just used this'}
              onClick={() => {
                // tapped again this turn: a mis-tap, clear it; on a later turn: it used the same move again
                const same = last === mv && vv(side, s).last_move_turn === p.turn;
                pv(side, s, { last_move: same ? undefined : mv });
                if (side === 1 && !same && !m.moves[k]) p.setMark(1, s, { moves: m.moves.map((x, j) => (j === k ? true : x)) });
              }}
            >
              {mv}
              {m.pp?.[mv] && m.pp[mv][0] < m.pp[mv][1] ? <span className={'bv-pp' + (m.pp[mv][0] === 0 ? ' out' : '')}> {m.pp[mv][0]}/{m.pp[mv][1]}</span> : null}
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

  /** Showdown's bar over a Pokémon: name, level, HP bar and %, status; tap it to edit that Pokémon. */
  const sdBar = (side: 0 | 1, s: PokemonSet, id: string) => {
    const m = p.mark(side, s);
    const pct = m.ko ? 0 : s.hpPercent;
    const st = STATUS.find((x) => x[0] === s.status) ?? STATUS[0];
    const boosts = STATS.filter(([k]) => s.boosts[k]);
    return (
      <button className={'sdf-bar' + (edit === id ? ' on' : '')} title="Tap to edit HP, status, stats, effects" onClick={() => setEdit((e) => (e === id ? '' : id))}>
        <span className="sdf-name">
          {shown(s, m.mega)}
          {m.mega ? <span className="sdf-tag mega">Mega</span> : null}
          <span className="sdf-lv">L50</span>
        </span>
        <span className="sdf-hp">
          <span className={'sdf-hpfill' + (pct <= 20 ? ' red' : pct <= 50 ? ' yellow' : '')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
        <span className="sdf-pct">{m.ko ? 'KO' : hpText(side, s, pct)}</span>
        <span className="sdf-tags">
          {st[0] && <span className={`sdf-tag st ${st[0]}`}>{st[1]}</span>}
          {boosts.map(([k, l]) => (
            <span key={k} className={'sdf-tag ' + (s.boosts[k] > 0 ? 'up' : 'down')}>
              {boostLabel(s.boosts[k])} {l}
            </span>
          ))}
        </span>
      </button>
    );
  };
  /** A side's team, in a column at its edge (Showdown's trainer side): tap the one that comes in. */
  const sdParty = (side: 0 | 1, list: PokemonSet[], outs: (PokemonSet | undefined)[]) => (
    <div className={`sdf-party ${side ? 'opp' : 'me'}`}>
      {list.map((s) => {
        const m = p.mark(side, s);
        const isOut = outs.some((o) => !!o && baseName(o) === baseName(s));
        const unseen = side === 1 && !isOut && !p.isAppeared(s);
        return (
          <button
            key={baseName(s)}
            className={'bv-icon' + (isOut ? ' out' : '') + (m.ko ? ' ko' : '') + (unseen ? ' unseen' : '')}
            title={`${s.species}${m.ko ? ' (fainted)' : ''}: tap when it comes in`}
            onClick={() => p.sendOut(side, s)}
          >
            <Sprite species={s.species} size={30} />
            <span>{m.ko ? 'KO' : hpText(side, s, s.hpPercent)}</span>
          </button>
        );
      })}
    </div>
  );
  if (p.showdown) {
    // singles: one a side
    const opp = p.doubles ? [p.theirActive, p.theirPartner] : [p.theirActive];
    const me = p.doubles ? [p.mineActive, p.minePartner] : [p.mineActive];
    const openSide = edit.startsWith('1') ? 1 : 0;
    const openSlot = edit.endsWith('b') ? 1 : 0;
    const openMon = edit ? (openSide ? opp : me)[openSlot] : undefined;
    return (
      <div className="bv-wrap" ref={root}>
        <div className="sdf-wrap">
          {sdParty(0, p.mine, me)}
          <div className={'bv sdf' + (p.doubles ? '' : ' solo')}>
            {f.terrain && <div className={`bv-terrain ${f.terrain.toLowerCase()}`} aria-hidden />}
            {f.weather && <div className={`bv-weather ${f.weather.toLowerCase().split(' ')[0]}`} aria-hidden />}
            {f.isTrickRoom && <div className="bv-tr" aria-hidden />}
            {sideArt(1)}
            {sideArt(0)}
            <div className="sdf-turn">Turn {p.turn}</div>
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
            {opp.map((s, i) => (
              <div key={'o' + i} className={`sdf-mon opp s${i}`}>
                {s ? sdBar(1, s, i ? '1b' : '1') : <span className="sdf-empty">Tap the one they send out</span>}
                {s && <FrontSprite species={shown(s, p.mark(1, s).mega)} size={96} />}
              </div>
            ))}
            {me.map((s, i) => (
              <div key={'m' + i} className={`sdf-mon me s${i}`}>
                {s ? sdBar(0, s, i ? '0b' : '0') : <span className="sdf-empty">Tap your Pokémon that is out</span>}
                {s && <BackSprite species={shown(s, p.mark(0, s).mega)} size={120} />}
              </div>
            ))}
            {openMon && (
              <div className="sdf-edit">
                <button className="icon close sdf-close" onClick={() => setEdit('')} aria-label="Close">
                  ✕
                </button>
                {statBox(openSide as 0 | 1, openMon, openSlot)}
              </div>
            )}
          </div>
          {sdParty(1, p.theirs, opp)}
        </div>
      </div>
    );
  }

  return (
    <div className="bv-wrap" ref={root}>
      <div className={'bv' + (p.doubles ? ' duo' : '')}>
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
        {p.doubles ? (
          <>
            {party(1, p.theirs, p.theirActive, p.theirPartner)}
            <div className="bv-stats opp">
              {statBox(1, p.theirActive, 0)}
              {statBox(1, p.theirPartner, 1)}
            </div>
            <div className="bv-pad opp" />
            <div className="bv-mon opp">
              {[p.theirActive, p.theirPartner].map((s, i) => (s ? <FrontSprite key={i} species={shown(s, p.mark(1, s).mega)} size={96} /> : null))}
            </div>
            <div className="bv-pad me" />
            <div className="bv-mon me">
              {[p.mineActive, p.minePartner].map((s, i) => (s ? <BackSprite key={i} species={shown(s, p.mark(0, s).mega)} size={120} /> : null))}
            </div>
            <div className="bv-stats me">
              {statBox(0, p.mineActive, 0)}
              {statBox(0, p.minePartner, 1)}
            </div>
            {party(0, p.mine, p.mineActive, p.minePartner)}
          </>
        ) : (
          <>
            {party(1, p.theirs, p.theirActive)}
            {statBox(1, p.theirActive)}
            <div className="bv-pad opp" />
            <div className="bv-mon opp">{p.theirActive && <FrontSprite species={shown(p.theirActive, p.mark(1, p.theirActive).mega)} size={110} />}</div>
            <div className="bv-pad me" />
            <div className="bv-mon me">{p.mineActive && <BackSprite species={shown(p.mineActive, p.mark(0, p.mineActive).mega)} size={140} />}</div>
            {statBox(0, p.mineActive)}
            {party(0, p.mine, p.mineActive)}
          </>
        )}
      </div>
    </div>
  );
}
