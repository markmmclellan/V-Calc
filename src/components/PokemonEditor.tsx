import { useState } from 'react';
import { toID } from '@smogon/calc';
import { metaFor, type BattleFormat, type Meta } from '../lib/data';
import {
  baseStatsOf,
  calcStats,
  gen,
  natureMods,
  natureNames,
  SP_MAX,
  SP_TOTAL,
  spTotal,
  STAT_KEYS,
  STAT_LABEL,
  type BoostTable,
  type PokemonSet,
  type Status,
  type StatKey,
} from '../lib/model';
import { abilitiesOf } from '../lib/abilities';
import { baseForMega, megaFor } from '../lib/showdown';
import { smogonUrl } from '../lib/smogon';
import PresetBar from './PresetBar';
import TypeBadges from './TypeBadges';
import Sprite from './Sprite';
import UsagePanel from './UsagePanel';

interface Props {
  set: PokemonSet;
  onChange: (s: PokemonSet) => void;
  meta: Meta | null;
  format: BattleFormat;
}

const STATUSES: [Status, string][] = [
  ['', 'Healthy'],
  ['brn', 'Burned'],
  ['par', 'Paralyzed'],
  ['psn', 'Poisoned'],
  ['tox', 'Badly poisoned'],
  ['slp', 'Asleep'],
  ['frz', 'Frozen'],
];
const BOOST_KEYS: (keyof BoostTable)[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/** Number input that lets you clear and retype; commits each valid value, and resets its draft on blur. */
function NumInput({ value, min, max, onCommit, className }: { value: number; min: number; max: number; onCommit: (n: number) => void; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      className={className}
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export default function PokemonEditor({ set, onChange, meta, format }: Props) {
  const species = gen.species.get(toID(set.species));
  const stats = calcStats(set.species, set.nature, set.sp);
  const base = baseStatsOf(set.species);
  const { plus, minus } = natureMods(set.nature);
  const total = spTotal(set.sp);
  const abilities = abilitiesOf(set.species);
  const entry = meta ? metaFor(meta, set.species) : undefined;

  const maxHP = stats?.hp ?? 1;
  const curHP = Math.max(1, Math.round((maxHP * set.hpPercent) / 100));
  const hpColor = set.hpPercent > 50 ? 'var(--good)' : set.hpPercent > 20 ? 'var(--warn)' : 'var(--bad)';

  const patch = (p: Partial<PokemonSet>) => onChange({ ...set, ...p });

  const setSpecies = (name: string) => {
    const s = gen.species.get(toID(name));
    if (!s) return patch({ species: name }); // let the user keep typing
    const abs = abilitiesOf(s.name);
    patch({ species: s.name, ability: abs.includes(set.ability) ? set.ability : abs[0] ?? '' });
  };

  /** Mirror Showdown: holding a Mega Stone switches to (or from) the Mega form. */
  const setItem = (item: string) => {
    const canon = gen.items.get(toID(item))?.name ?? item;
    let next = set.species;
    const current = baseForMega(set.species);
    const base = current?.base ?? set.species;
    const mega = megaFor(base, canon);
    if (mega && gen.species.get(toID(mega))) next = mega;
    else if (current) next = current.base;
    if (next === set.species) return patch({ item });
    const abs = abilitiesOf(next);
    patch({ item, species: next, ability: mega ? abs[0] ?? set.ability : abs.includes(set.ability) ? set.ability : abs[0] ?? '' });
  };

  /** Holding a Mega Stone lets the user choose whether the Pokemon has Mega Evolved yet. */
  const megaState = (() => {
    const cur = baseForMega(set.species);
    const baseName = cur?.base ?? set.species;
    const megaName = set.item ? megaFor(baseName, set.item) : undefined;
    if (!megaName || !gen.species.get(toID(megaName))) return null;
    return { baseName, megaName, isMega: !!cur };
  })();

  const toggleMega = (on: boolean) => {
    if (!megaState) return;
    const next = on ? megaState.megaName : megaState.baseName;
    const abs = abilitiesOf(next);
    patch({ species: next, ability: on ? abs[0] ?? set.ability : abs.includes(set.ability) ? set.ability : abs[0] ?? '' });
  };

  const setSP = (k: StatKey, raw: number) => {
    const others = total - set.sp[k];
    const v = Math.max(0, Math.min(SP_MAX, SP_TOTAL - others, Number.isFinite(raw) ? Math.floor(raw) : 0));
    patch({ sp: { ...set.sp, [k]: v } });
  };

  return (
    <section className="panel editor">
      <header className="ed-head">
        <Sprite species={set.species} size={48} />
        <div className="ed-title">
          <div className="name-row">
            <input
              className="species-input"
              list="dl-species"
              value={set.species}
              onChange={(e) => setSpecies(e.target.value)}
              spellCheck={false}
            />
            {species && (
              <a
                className="dex-link"
                href={smogonUrl(set.species)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open the Smogon Champions analysis for ${set.species}`}
              >
                Smogon ↗
              </a>
            )}
            {megaState && (
              <button
                type="button"
                className={'mega-btn' + (megaState.isMega ? ' on' : '')}
                aria-pressed={megaState.isMega}
                onClick={() => toggleMega(!megaState.isMega)}
                title={megaState.isMega ? 'Mega Evolved (click to revert to base form)' : 'Not Mega Evolved yet (click to Mega Evolve)'}
              >
                <img src="https://play.pokemonshowdown.com/sprites/misc/mega.png" width={16} height={16} alt="Mega" />
              </button>
            )}
          </div>
          <div className="types-row">
            <TypeBadges types={species?.types as string[] | undefined} />
            <PresetBar set={set} onChange={onChange} />
          </div>
        </div>
      </header>

      <div className="grid2">
        <label>
          Item
          <input list="dl-items" value={set.item} onChange={(e) => setItem(e.target.value)} spellCheck={false} />
        </label>
        <label>
          Ability
          <select value={set.ability} onChange={(e) => patch({ ability: e.target.value })}>
            {!abilities.includes(set.ability) && <option value={set.ability}>{set.ability || '—'}</option>}
            {abilities.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Nature
          <select value={set.nature} onChange={(e) => patch({ nature: e.target.value })}>
            {natureNames.map((n) => {
              const m = natureMods(n);
              return (
                <option key={n} value={n}>
                  {n}
                  {m.plus ? ` +${STAT_LABEL[m.plus]} −${STAT_LABEL[m.minus!]}` : ''}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Status
          <select value={set.status} onChange={(e) => patch({ status: e.target.value as Status })}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3>
        Stat Points{' '}
        <span className={'sp-total' + (total > SP_TOTAL ? ' over' : '')}>
          {total}/{SP_TOTAL}
        </span>
      </h3>
      <div className="sp-table">
        {STAT_KEYS.map((k) => (
          <div key={k} className="sp-row">
            <span className={'sp-label' + (plus === k ? ' plus' : minus === k ? ' minus' : '')}>
              {STAT_LABEL[k]}
              {plus === k ? '+' : minus === k ? '−' : ''}
            </span>
            <span className="base">{base?.[k] ?? '–'}</span>
            <input
              type="range"
              min={0}
              max={SP_MAX}
              value={set.sp[k]}
              onChange={(e) => setSP(k, +e.target.value)}
            />
            <input
              type="number"
              min={0}
              max={SP_MAX}
              value={set.sp[k]}
              onChange={(e) => setSP(k, +e.target.value)}
            />
            <span className="final">{stats?.[k] ?? '–'}</span>
          </div>
        ))}
      </div>

      <h3>Moves</h3>
      <div className="moves">
        {set.moves.map((m, i) => {
          const mv = m ? gen.moves.get(toID(m)) : undefined;
          return (
            <div key={i} className="move-row">
              <input
                list="dl-moves"
                value={m}
                placeholder={`Move ${i + 1}`}
                spellCheck={false}
                onChange={(e) => {
                  const moves = [...set.moves];
                  moves[i] = e.target.value;
                  patch({ moves });
                }}
              />
              {mv && (
                <span className={`type t-${mv.type.toLowerCase()}`} title={mv.category}>
                  {mv.type}
                </span>
              )}
              {mv && mv.category !== 'Status' && <span className="bp">{mv.basePower || '—'}</span>}
              <label className="crit" title="Calculate as a critical hit">
                <input
                  type="checkbox"
                  checked={set.critMoves[i] ?? false}
                  onChange={(e) => {
                    const critMoves = [...set.critMoves];
                    critMoves[i] = e.target.checked;
                    patch({ critMoves });
                  }}
                />
                Crit
              </label>
            </div>
          );
        })}
      </div>

      <h3>Battle state</h3>
      <div className="boosts">
        {BOOST_KEYS.map((k) => (
          <label key={k}>
            {STAT_LABEL[k]}
            <select value={set.boosts[k]} onChange={(e) => patch({ boosts: { ...set.boosts, [k]: +e.target.value } })}>
              {Array.from({ length: 13 }, (_, i) => 6 - i).map((v) => (
                <option key={v} value={v}>
                  {v > 0 ? `+${v}` : v}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="check" title="For abilities that need to be active (e.g. Flash Fire, Protosynthesis)">
          <input type="checkbox" checked={set.abilityOn} onChange={(e) => patch({ abilityOn: e.target.checked })} />
          Ability active
        </label>
        {set.ability === 'Supreme Overlord' && (
          <label className="inline" title="Supreme Overlord: +10% power per fainted ally (up to 5)">
            Fainted allies
            <select value={set.alliesFainted ?? 0} onChange={(e) => patch({ alliesFainted: +e.target.value })}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="hp-row">
        <span className="hp-label">HP</span>
        <input
          type="range"
          className="hp-slider"
          aria-label="Current HP"
          min={1}
          max={maxHP}
          step={1}
          value={curHP}
          style={{ '--fill': `${set.hpPercent}%`, '--hp-color': hpColor } as React.CSSProperties}
          onChange={(e) => patch({ hpPercent: (+e.target.value / maxHP) * 100 })}
        />
        <span className="hp-edit">
          <NumInput
            className="hp-cur"
            value={curHP}
            min={1}
            max={maxHP}
            onCommit={(n) => patch({ hpPercent: (Math.round(n) / maxHP) * 100 })}
          />
          <span className="hint">/ {maxHP}</span>
          <NumInput
            className="hp-pct"
            value={Math.round(set.hpPercent)}
            min={1}
            max={100}
            onCommit={(n) => patch({ hpPercent: Math.round(n) })}
          />
          <span className="hint">%</span>
        </span>
      </div>

      <UsagePanel entry={entry} format={format} set={set} onChange={onChange} setItem={setItem} />
    </section>
  );
}
