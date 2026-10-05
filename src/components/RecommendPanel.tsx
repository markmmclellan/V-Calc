import { useEffect, useMemo, useState } from 'react';
import type { FieldState } from '../lib/calc';
import { calcStats, type PokemonSet } from '../lib/model';
import { loadReference } from '../lib/reference';
import { recommendDoubles, recommendSingles, SITUATIONAL, type AccuracyOf, type DoublesOption, type Plan } from '../lib/recommend';
import Sprite from './Sprite';

interface Props {
  /** Your active Pokémon (and your Doubles partner when one is picked). */
  mine: PokemonSet[];
  /** The opponent's active Pokémon (and partner). */
  theirs: PokemonSet[];
  field: FieldState;
  doubles: boolean;
  onClose: () => void;
}

const label = (s: PokemonSet) => s.nickname || s.species;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const STATUS: Record<string, string> = { brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'asleep', frz: 'frozen' };

/** "62% HP (126/203), burned, +2 Atk" so you can check the panel is using the state you set. */
function stateLine(s: PokemonSet): string {
  const max = calcStats(s.species, s.nature, s.sp)?.hp ?? 0;
  const cur = Math.max(1, Math.round((max * s.hpPercent) / 100));
  const parts = [`${Math.round(s.hpPercent)}% HP${max ? ` (${cur}/${max})` : ''}`];
  if (s.status) parts.push(STATUS[s.status] ?? s.status);
  const names: Record<string, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
  for (const [k, v] of Object.entries(s.boosts)) if (v) parts.push(`${v > 0 ? '+' : ''}${v} ${names[k]}`);
  return parts.join(' · ');
}

function fieldLine(f: FieldState): string {
  const on: string[] = [];
  if (f.weather) on.push(f.weather);
  if (f.terrain) on.push(`${f.terrain} Terrain`);
  if (f.isTrickRoom) on.push('Trick Room');
  if (f.isGravity) on.push('Gravity');
  if (f.attackerSide.isTailwind) on.push('your Tailwind');
  if (f.defenderSide.isTailwind) on.push("their Tailwind");
  return on.length ? on.join(', ') : 'no weather, terrain or room';
}

function orderText(first: 'me' | 'them' | 'tie'): string {
  return first === 'me' ? 'you move first' : first === 'them' ? 'they move first' : 'speed tie';
}

export default function RecommendPanel({ mine, theirs, field, doubles, onClose }: Props) {
  const [acc, setAcc] = useState<AccuracyOf | null>(null);
  const [accError, setAccError] = useState(false);

  useEffect(() => {
    loadReference().then(
      (ref) => {
        const m = new Map(ref.moves.map((x) => [x.name, x.accuracy > 0 ? x.accuracy / 100 : 1]));
        setAcc(() => (move: string) => m.get(move) ?? 1);
      },
      () => {
        setAccError(true);
        setAcc(() => () => 1);
      },
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const singles = useMemo(() => (acc && !doubles && mine[0] && theirs[0] ? recommendSingles(mine[0], theirs[0], field, acc) : null), [acc, doubles, mine, theirs, field]);
  const dbl = useMemo(() => (acc && doubles ? recommendDoubles(mine, theirs, field, acc) : null), [acc, doubles, mine, theirs, field]);

  const targetText = (a: DoublesOption): string =>
    a.target === 'spread' ? (a.spread === 'all' ? 'everything adjacent' : a.hits.length > 1 ? 'both opponents' : label(theirs[a.hits[0].foe])) : label(theirs[a.target]);
  const planLine = (p: Plan) => p.actions.map((a) => `${label(mine[a.actor])}: ${a.move} → ${targetText(a)}`).join('   ·   ');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal recommend" role="dialog" aria-modal="true" aria-label="Best move">
        <header className="modal-head">
          <h2>
            Best move <span className="hint">· {doubles ? 'Doubles' : 'Singles'}</span>
          </h2>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="rec-body">
          <section className="rec-state">
            <h3>State used</h3>
            <div className="rec-sides">
              <div>
                <h4>Yours</h4>
                {mine.map((m, i) => (
                  <div key={i} className="rec-mon">
                    <Sprite species={m.species} size={26} />
                    <strong>{label(m)}</strong> <span className="hint">{stateLine(m)}</span>
                  </div>
                ))}
              </div>
              <div>
                <h4>Opponent's</h4>
                {theirs.map((m, i) => (
                  <div key={i} className="rec-mon">
                    <Sprite species={m.species} size={26} />
                    <strong>{label(m)}</strong> <span className="hint">{stateLine(m)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="hint rec-field">Field: {fieldLine(field)}. Set HP, boosts and status in each Pokémon's editor first; change the field in the Field panel.</p>
          </section>

          {!acc && <p className="hint">Loading move data…</p>}
          {accError && <p className="bring-note">Couldn't load move accuracies, so every move is treated as 100% accurate.</p>}

          {singles && (
            <>
              {singles.options[0] ? (
                <section className="rec-top">
                  <div className="rec-pick">
                    <span className="rec-label">Use</span>
                    <strong className="rec-move">{singles.options[0].move}</strong>
                    <span className="rec-win">{pct(singles.options[0].win)} to win this matchup</span>
                  </div>
                  <p className="rec-why">
                    {singles.options[0].first === 'me'
                      ? `${label(mine[0])} moves first with it.`
                      : singles.options[0].first === 'them'
                        ? `${label(theirs[0])} moves first.`
                        : 'It is a speed tie.'}{' '}
                    {singles.options[0].koNow >= 0.02 ? `${pct(singles.options[0].koNow)} to KO ${label(theirs[0])} right away, ` : `Can't KO ${label(theirs[0])} this turn; `}
                    {pct(singles.options[0].koBy[1])} within 2 turns and {pct(singles.options[0].koBy[2])} within 3.
                    {singles.options[0].replyMove ? ` Their most damaging answer is ${singles.options[0].replyMove}.` : ''}
                  </p>
                </section>
              ) : (
                <section className="rec-top rec-none">
                  <strong>No damaging move to recommend.</strong>
                </section>
              )}

              {singles.warnings.map((w) => (
                <p key={w} className="bring-note">
                  {w}
                </p>
              ))}

              {singles.options.length > 0 && (
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>Move</th>
                      <th title="Chance to win the 1v1 if both keep attacking (up to 5 turns)">Win</th>
                      <th title="Chance this move KOs on its own, including accuracy">KO now</th>
                      <th>By turn 2</th>
                      <th>By turn 3</th>
                      <th title="Average damage as a share of their current HP">Damage</th>
                      <th>Order</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {singles.options.map((o, i) => (
                      <tr key={o.move} className={i === 0 ? 'best' : ''}>
                        <td className="mv">{i === 0 && <span className="star">★</span>} {o.move}</td>
                        <td>
                          <div className="winbar" title={`Win ${pct(o.win)} · lose ${pct(o.lose)} · unresolved ${pct(o.draw)}`}>
                            <span className="w" style={{ width: `${o.win * 100}%` }} />
                            <span className="l" style={{ width: `${o.lose * 100}%` }} />
                          </div>
                          {pct(o.win)}
                        </td>
                        <td>{pct(o.koNow)}</td>
                        <td>{pct(o.koBy[1])}</td>
                        <td>{pct(o.koBy[2])}</td>
                        <td>{Math.round(o.avgPct)}%</td>
                        <td>{orderText(o.first)}</td>
                        <td className="hint">{o.notes.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {singles.replies.length > 0 && (
                <section>
                  <h3>Their strongest moves against you</h3>
                  <ul className="rec-replies">
                    {singles.replies.slice(0, 3).map((r) => (
                      <li key={r.move}>
                        <strong>{r.move}</strong> · {Math.round(r.avgPctOfMine * 100) / 100 > 0 ? `${Math.round(r.avgPctOfMine)}%` : '0%'} of your current HP
                        {r.accuracy < 1 ? ` (${Math.round(r.accuracy * 100)}% accurate)` : ''} · KO chance {pct(r.koChance)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="hint rec-skipped">
                {singles.mine.blocked.length > 0 && <>No effect on {label(theirs[0])}: {singles.mine.blocked.map((b) => `${b.move} (${b.reason})`).join(', ')}. </>}
                {singles.mine.status.length > 0 && <>Not scored (status moves): {singles.mine.status.join(', ')}. </>}
                {singles.mine.situational.length > 0 && <>Not scored: {singles.mine.situational.map((x) => `${x.move} (${x.why})`).join(', ')}.</>}
              </p>
            </>
          )}

          {dbl && (
            <>
              {dbl.plans[0] ? (
                <section className="rec-top">
                  <div className="rec-pick">
                    <span className="rec-label">Best plan this turn</span>
                  </div>
                  <ul className="rec-actions">
                    {dbl.plans[0].actions.map((a) => (
                      <li key={a.actor}>
                        <Sprite species={mine[a.actor].species} size={26} />
                        <strong>{label(mine[a.actor])}</strong> uses <strong className="rec-move">{a.move}</strong> → {targetText(a)}
                        {a.spread === 'all' && a.ally && <span className="rec-ff"> (also hits your partner for about {Math.round(a.ally.avgPct)}%)</span>}
                      </li>
                    ))}
                  </ul>
                  <ul className="rec-outcomes">
                    {dbl.plans[0].outcomes.map((o) => (
                      <li key={o.foe}>
                        <strong>{label(theirs[o.foe])}</strong>: {pct(o.ko)} to KO · about {Math.round(o.avgPct)}% of its HP removed
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <section className="rec-top rec-none">
                  <strong>No damaging plan to recommend.</strong>
                </section>
              )}

              {dbl.warnings.map((w) => (
                <p key={w} className="bring-note">
                  {w}
                </p>
              ))}

              {dbl.plans.length > 1 && (
                <section>
                  <h3>Other plans</h3>
                  <ol className="rec-plans">
                    {dbl.plans.slice(1, 6).map((p, i) => (
                      <li key={i}>
                        <div>{planLine(p)}</div>
                        <div className="hint">
                          {p.outcomes.map((o) => `${label(theirs[o.foe])} ${pct(o.ko)} KO`).join(' · ')}
                          {p.ally && p.ally.avgPct > 0 ? ` · hits your partner ~${Math.round(p.ally.avgPct)}%` : ''}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section>
                <h3>What they can do to you</h3>
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>Opponent</th>
                      <th>Target</th>
                      <th>Best move</th>
                      <th>Damage</th>
                      <th>KO chance</th>
                      <th>Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbl.threats.map((t) => (
                      <tr key={`${t.foe}-${t.target}`}>
                        <td>{label(theirs[t.foe])}</td>
                        <td>{label(mine[t.target])}</td>
                        <td>{t.move}</td>
                        <td>{Math.round(t.avgPct)}%</td>
                        <td>{pct(t.koChance)}</td>
                        <td>{orderText(t.first)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <p className="hint rec-skipped">
                {dbl.classified.map((c, i) => (c.status.length ? `${label(mine[i])} not scored (status): ${c.status.join(', ')}. ` : '')).join('')}
                {dbl.classified.flatMap((c, i) => c.situational.map((x) => `${label(mine[i])}'s ${x.move} (${x.why}) is not scored. `)).join('')}
              </p>
            </>
          )}

          <p className="hint bring-foot">
            {doubles
              ? "Doubles: scores each combined plan for this turn by KO chance and damage, counting focus fire, spread-move reduction and friendly fire. It doesn't know what the opponent will do, Protect, switching, or who they'll target."
              : "Singles: simulates both sides repeating their move for up to 5 turns and assumes they use whichever of their damaging moves is worst for you. Accounts for accuracy, current HP, boosts, speed and priority, Disguise, recharge and charge turns, and stat drops from moves like Draco Meteor. It doesn't know about switching, Protect, status moves, items like Sitrus Berry (Focus Sash and Sturdy at full HP are handled), residual damage, or speed changes."}{' '}
            Moves that only matter situationally ({Object.keys(SITUATIONAL).slice(0, 3).join(', ')}…) are listed but not scored.
          </p>
        </div>
      </div>
    </div>
  );
}
