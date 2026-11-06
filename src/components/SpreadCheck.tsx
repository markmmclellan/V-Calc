import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { FieldState } from '../lib/calc';
import { metaFor, type BattleFormat, type Meta } from '../lib/data';
import { moveInfo, STAT_LABEL, type PokemonSet, type StatTable } from '../lib/model';
import { checkSpread, spreadText, type CheckMode } from '../lib/spreadcheck';
import Sprite from './Sprite';

interface Props {
  /** Your Pokémon on the field (one, or two in Doubles). */
  yours: PokemonSet[];
  /** The opponent's Pokémon on the field. */
  theirs: PokemonSet[];
  field: FieldState;
  meta: Meta | null;
  format: BattleFormat;
  /** Give the opponent's Pokémon `target` this spread, nature and item. */
  onApply: (target: PokemonSet, patch: { sp: StatTable; nature: string; item: string }) => void;
  onClose: () => void;
}

interface HitRow {
  move: string;
  crit: boolean;
  value: string;
  mine: number; // index into `yours`
}

const label = (s: PokemonSet) => s.nickname || s.species;
const damaging = (moves: string[]) => moves.filter((m) => m && moveInfo(m) && moveInfo(m)!.category !== 'Status');

/** Work out an opponent's spread from the damage you saw. */
export default function SpreadCheck({ yours, theirs, field, meta, format, onApply, onClose }: Props) {
  const [mode, setMode] = useState<CheckMode>('attack');
  const [who, setWho] = useState(0);
  const [tryItems, setTryItems] = useState(false);
  const target = theirs[Math.min(who, theirs.length - 1)];
  const attackerMoves = (m: CheckMode, mine: PokemonSet | undefined) => damaging((m === 'attack' ? target : mine)?.moves ?? []);
  const blankHit = (m: CheckMode, mine = 0): HitRow => ({ move: attackerMoves(m, yours[mine])[0] ?? '', crit: false, value: '', mine });
  const [hits, setHits] = useState<HitRow[]>(() => [blankHit('attack')]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const switchMode = (m: CheckMode) => {
    setMode(m);
    setHits([blankHit(m)]);
  };
  const switchWho = (i: number) => {
    setWho(i);
    if (mode === 'attack') setHits([{ ...blankHit('attack'), move: damaging(theirs[i]?.moves ?? [])[0] ?? '' }]);
  };
  const edit = (i: number, patch: Partial<HitRow>) => setHits((old) => old.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const entry = meta && target ? metaFor(meta, target.species) : undefined;
  const now = useMemo(() => ({ mode, target, hits, tryItems }), [mode, target, hits, tryItems]);
  const input = useDeferredValue(now); // typing stays smooth while the checks run
  const result = useMemo(() => {
    const { mode: m, target: t, hits: hs, tryItems: ti } = input;
    if (!t) return null;
    const list = hs
      .filter((h) => h.value.trim() !== '')
      .map((h) => ({ move: h.move.trim(), crit: h.crit, observed: Number(h.value), mine: yours[h.mine] ?? yours[0] }));
    if (!list.length) return null;
    return checkSpread({ mode: m, theirs: t, hits: list, field, entry, format, tryItems: ti });
  }, [input, yours, field, entry, format]);

  const best = result?.matches[0];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal spread" role="dialog" aria-modal="true" aria-label="Spread check">
        <header className="modal-head">
          <h2>
            Spread check <span className="hint">· find their spread from the damage you saw</span>
          </h2>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="rec-body">
          <div className="sc-controls">
            <div className="seg" role="group" aria-label="Which hit">
              <button className={mode === 'attack' ? 'on' : ''} onClick={() => switchMode('attack')} title="Their move hit your Pokémon: tells their Atk / SpA">
                They hit me
              </button>
              <button className={mode === 'defense' ? 'on' : ''} onClick={() => switchMode('defense')} title="Your move hit their Pokémon: tells their HP and Def / SpD">
                I hit them
              </button>
            </div>
            {theirs.length > 1 ? (
              <select value={who} onChange={(e) => switchWho(+e.target.value)} aria-label="Opponent's Pokémon">
                {theirs.map((t, i) => (
                  <option key={i} value={i}>
                    {label(t)}
                  </option>
                ))}
              </select>
            ) : (
              target && (
                <span className="rec-mon">
                  <Sprite species={target.species} size={24} />
                  {label(target)}
                </span>
              )
            )}
            <label className="sc-check" title="The item you set may be a guess. This also tries their 10 most used items.">
              <input type="checkbox" checked={tryItems} onChange={(e) => setTryItems(e.target.checked)} /> Item unknown
            </label>
          </div>

          <table className="rec-table sc-hits">
            <thead>
              <tr>
                {yours.length > 1 && <th>{mode === 'attack' ? 'Hit' : 'Attacker'}</th>}
                <th>{mode === 'attack' ? 'Their move' : 'Your move'}</th>
                <th>Crit</th>
                <th>{mode === 'attack' ? 'HP you lost' : '% of HP they lost'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {hits.map((h, i) => {
                const list = attackerMoves(mode, yours[h.mine]);
                return (
                  <tr key={i}>
                    {yours.length > 1 && (
                      <td>
                        <select value={h.mine} onChange={(e) => edit(i, { mine: +e.target.value, ...(mode === 'defense' ? { move: attackerMoves('defense', yours[+e.target.value])[0] ?? '' } : {}) })}>
                          {yours.map((y, j) => (
                            <option key={j} value={j}>
                              {label(y)}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td>
                      <input list={`sc-moves-${i}`} value={h.move} onChange={(e) => edit(i, { move: e.target.value })} placeholder="Move" />
                      <datalist id={`sc-moves-${i}`}>
                        {list.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </td>
                    <td>
                      <input type="checkbox" checked={h.crit} onChange={(e) => edit(i, { crit: e.target.checked })} aria-label="Critical hit" />
                    </td>
                    <td>
                      <input
                        className="sc-num"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={h.value}
                        onChange={(e) => edit(i, { value: e.target.value })}
                        placeholder={mode === 'attack' ? 'e.g. 87' : 'e.g. 42'}
                        autoFocus={i === hits.length - 1}
                      />
                    </td>
                    <td>
                      {hits.length > 1 && (
                        <button className="icon" onClick={() => setHits((old) => old.filter((_, j) => j !== i))} aria-label="Remove hit" title="Remove this hit">
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div>
            <button onClick={() => setHits((old) => [...old, { ...blankHit(mode, old[old.length - 1]?.mine ?? 0), move: old[old.length - 1]?.move ?? '' }])}>+ Add another hit</button>{' '}
            <span className="hint">Each extra hit narrows it down. Use hits that didn't KO.</span>
          </div>

          {!result ? (
            <p className="hint">
              {mode === 'attack'
                ? 'Enter how much HP your Pokémon lost to their move. Your HP is shown exactly in game.'
                : 'Enter the % of HP their Pokémon lost to your move (the drop on their HP bar).'}{' '}
              It uses the field, boosts, abilities and items as set in the calculator.
            </p>
          ) : result.error ? (
            <p className="err">{result.error}</p>
          ) : (
            <>
              <p className="sc-current">
                As entered now ({spreadText(target.sp)} {target.nature}
                {target.item ? `, ${target.item}` : ''}): {result.current.join(', ')} ·{' '}
                {result.currentMatches ? <span className="rec-win">fits</span> : <span className="err">doesn't fit</span>}
              </p>
              {result.invest.length > 0 && result.investStat && (
                <p className="sc-invest">
                  {STAT_LABEL[result.investStat]} Stat Points that fit:{' '}
                  {result.invest.map((r) => `${r.label} ${r.from === r.to ? r.from : `${r.from}–${r.to}`}`).join(' · ')}
                </p>
              )}
              {best ? (
                <>
                  <section className="rec-top">
                    <div className="rec-pick">
                      <span className="rec-label">Most likely</span>
                      <strong className="rec-move">
                        {spreadText(best.sp)} {best.nature}
                      </strong>
                      {tryItems && best.item && <span>{best.item}</span>}
                      <span className="hint">
                        {best.stats} · {Math.round(best.share * 100)}% of matching usage
                      </span>
                      <button className="primary" onClick={() => onApply(target, { sp: best.sp, nature: best.nature, item: best.item })}>
                        Use
                      </button>
                    </div>
                  </section>
                  <table className="rec-table">
                    <thead>
                      <tr>
                        <th title="Stat Points: HP / Atk / Def / SpA / SpD / Spe">Spread (H/A/B/C/D/S)</th>
                        <th>Nature</th>
                        {tryItems && <th>Item</th>}
                        <th>Stats</th>
                        <th>Damage</th>
                        <th title="Share of the usage of all matching spreads on op.gg">Likely</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {result.matches.slice(0, 12).map((c, i) => (
                        <tr key={i} className={i === 0 ? 'best' : ''}>
                          <td className="mv">{spreadText(c.sp)}</td>
                          <td>{c.nature}</td>
                          {tryItems && <td>{c.item || '—'}</td>}
                          <td>{c.stats}</td>
                          <td>{c.ranges.join(', ')}</td>
                          <td>{Math.max(1, Math.round(c.share * 100))}%</td>
                          <td>
                            <button onClick={() => onApply(target, { sp: c.sp, nature: c.nature, item: c.item })}>Use</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.matches.length > 12 && <p className="hint">and {result.matches.length - 12} less likely ones.</p>}
                </>
              ) : (
                <p className="rec-none rec-top">
                  None of the {result.tested} op.gg spread and nature combinations {entry ? '' : '(no op.gg data for this Pokémon) '}fit. Check the move, crit, boosts,
                  ability{tryItems ? '' : ', item (try "Item unknown")'} and field. Screens, weather and Helping Hand change damage too.
                </p>
              )}
            </>
          )}
          <p className="hint">
            Tries every spread and nature on {target ? label(target) : 'their'}'s op.gg page, ranked by how often they're used.
            {mode === 'defense' && ' Their HP bar only shows whole percentages, so it allows 1% either way.'}
          </p>
        </div>
      </div>
    </div>
  );
}
