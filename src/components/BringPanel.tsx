import { useEffect, useMemo } from 'react';
import { analyze, BRING_COUNT, pokemonLabel, type Cell, type Format, type Verdict } from '../lib/bring';
import type { PokemonSet } from '../lib/model';
import Sprite from './Sprite';

interface Props {
  mine: PokemonSet[];
  theirs: PokemonSet[];
  format: Format;
  /** Put the recommended Pokémon at the front of your team and select the leads. */
  onApply: (bring: number[], leads: number[]) => void;
  onClose: () => void;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  strong: 'Strong win',
  favored: 'Favored',
  even: 'Even',
  unfavored: 'Unfavored',
  loses: 'Loses',
};

const hko = (turns: number) => (isFinite(turns) ? `${turns}HKO` : '—');

function cellTitle(me: PokemonSet, them: PokemonSet, c: Cell): string {
  const mine = c.mine.move ? `${c.mine.move} ${Math.round(c.mine.pct)}% (${hko(c.mine.turns)})` : 'no damaging move that works';
  const theirs = c.theirs.move ? `${c.theirs.move} ${Math.round(c.theirs.pct)}% (${hko(c.theirs.turns)})` : 'no damaging move that works';
  const speed = c.first === 'me' ? `${pokemonLabel(me)} moves first` : c.first === 'them' ? `${pokemonLabel(them)} moves first` : 'speed tie';
  return `${pokemonLabel(me)}: ${mine}\n${pokemonLabel(them)}: ${theirs}\n${speed}\nVerdict: ${VERDICT_TEXT[c.verdict]}`;
}

/** Team preview helper: a matchup grid between the two teams plus a recommended group to bring. */
export default function BringPanel({ mine, theirs, format, onApply, onClose }: Props) {
  const count = BRING_COUNT[format];
  const a = useMemo(() => analyze(mine, theirs, format), [mine, theirs, format]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const picked = new Set(a.bring);
  const sets = a.sets;
  const tagFor = (i: number) => a.reasons.find((r) => r.index === i)?.form ?? null;
  const isLead = (i: number) => a.leads.includes(i);
  const lacking = mine.length < count ? `You only have ${mine.length} Pokémon, so all of them come. Add more to get a real choice.` : '';
  const conflict = a.conflict
    ? `Only one Pokémon can Mega Evolve per battle. ${a.mega !== null ? `${pokemonLabel(sets[a.mega])} is assumed to` : 'None is assumed to'}; the other${a.reasons.filter((r) => r.form === 'base').length > 1 ? 's play' : ' plays'} as ${a.reasons
        .filter((r) => r.form === 'base')
        .map((r) => pokemonLabel(sets[r.index]))
        .join(' and ')} (with a Mega Stone that does nothing there).`
    : '';
  const partial = theirs.length < 6 ? `Only ${theirs.length} of the opponent's 6 ${theirs.length === 1 ? 'is' : 'are'} entered. Add the rest in team preview for the best advice.` : '';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal bring" role="dialog" aria-modal="true" aria-label="What to bring">
        <header className="modal-head">
          <h2>
            What to bring <span className="hint">· {format === 'single' ? 'Singles' : 'Doubles'}: pick {count} of 6</span>
          </h2>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="bring-body">
          {(lacking || partial || conflict) && <p className="bring-note">{[lacking, partial, conflict].filter(Boolean).join(' ')}</p>}

          <div className="bring-grid-wrap">
            <table className="bring-grid">
              <thead>
                <tr>
                  <th />
                  {theirs.map((t, j) => (
                    <th key={j} title={pokemonLabel(t)}>
                      <Sprite species={t.species} size={30} />
                      <span className="bg-name">{pokemonLabel(t)}</span>
                      {a.threats.some((x) => x.j === j) && <span className="bg-threat">threat</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sets.map((m, i) => (
                  <tr key={i} className={picked.has(i) ? 'picked' : ''}>
                    <th scope="row">
                      <Sprite species={m.species} size={30} />
                      <span className="bg-name">{pokemonLabel(m)}</span>
                      {picked.has(i) && <span className={'bg-tag' + (isLead(i) ? ' lead' : '')}>{isLead(i) ? 'LEAD' : 'BRING'}</span>}
                      {picked.has(i) && tagFor(i) === 'mega' && <span className="bg-tag mega" title="This is the one Pokémon that Mega Evolves">MEGA</span>}
                      {picked.has(i) && tagFor(i) === 'base' && (
                        <span className="bg-tag nomega" title="Only one Pokémon can Mega Evolve per battle, so this one is judged in its base form">NO MEGA</span>
                      )}
                    </th>
                    {theirs.map((t, j) => {
                      const c = a.cells[i][j];
                      return (
                        <td key={j} className={`v-${c.verdict}`} title={cellTitle(m, t, c)}>
                          <div className="bc-top">
                            {Math.round(c.mine.pct)}% <span className="bc-sep">/</span> {Math.round(c.theirs.pct)}%
                          </div>
                          <div className="bc-bot">
                            {hko(c.mine.turns)} · {hko(c.theirs.turns)}
                            {c.first === 'me' ? ' ⚡' : c.first === 'tie' ? ' ≈' : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint bring-legend">
            Each box: your best move's damage / their best move's damage on you, then hits to KO each way (⚡ you move first, ≈ speed tie).
            Green favors you, red favors them. Hover a box for the moves.
          </p>

          <div className="bring-cols">
            <section className="bring-reco">
              <h3>
                Recommended
                <button className="apply" onClick={() => onApply(a.bring, a.leads)} disabled={!a.bring.length} title="Move these to the front of your team and select the leads">
                  Move to front
                </button>
              </h3>
              {a.bring.length === 0 && <p className="hint">Add Pokémon to both teams.</p>}
              <ol>
                {a.reasons.map((r) => {
                  const m = sets[r.index];
                  return (
                    <li key={r.index}>
                      <div className="rc-head">
                        <Sprite species={m.species} size={26} />
                        <strong>{pokemonLabel(m)}</strong>
                        {isLead(r.index) && <span className="bg-tag lead">LEAD</span>}
                        {r.form === 'mega' && <span className="bg-tag mega">MEGA</span>}
                        {r.form === 'base' && <span className="bg-tag nomega">NO MEGA</span>}
                      </div>
                      {r.beats.length > 0 && (
                        <div className="rc-line good">
                          Beats {r.beats.map((b) => `${pokemonLabel(theirs[b.j])} (${b.note})`).join(', ')}
                        </div>
                      )}
                      {r.form === 'base' && (
                        <div className="rc-line hint">Holds a Mega Stone, but only one Pokémon can Mega Evolve per battle, so it's judged as {pokemonLabel(m)}.</div>
                      )}
                      {r.beats.length === 0 && <div className="rc-line hint">Doesn't clearly beat any of theirs; brought for the best remaining coverage.</div>}
                      {r.struggles.length > 0 && <div className="rc-line bad">Struggles against {r.struggles.map((j) => pokemonLabel(theirs[j])).join(', ')}</div>}
                      {r.synergy.map((s) => (
                        <div key={s} className="rc-line syn">
                          {s}
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="bring-threats">
              <h3>Watch out for</h3>
              {a.threats.length === 0 && a.bring.length > 0 && <p className="hint">Your group has a favorable answer to everything they have.</p>}
              <ul>
                {a.threats.map((t) => (
                  <li key={t.j}>
                    <div className="rc-head">
                      <Sprite species={theirs[t.j].species} size={26} />
                      <strong>{pokemonLabel(theirs[t.j])}</strong>
                      <span className={`bg-verdict v-${t.verdict}`}>{VERDICT_TEXT[t.verdict]}</span>
                    </div>
                    <div className="rc-line">
                      Your best answer is {pokemonLabel(sets[t.answer])}
                      {t.theirMove ? `; it hits back with ${t.theirMove} for about ${t.theirPct}%` : ''}.
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="hint bring-foot">
            Judged 1v1 at full HP with no weather, terrain or boosts, using each Pokémon's current build (the opponent's are op.gg's
            most-used sets, judged as entered, so a stone holder of theirs counts as Mega Evolved). It doesn't model switching, Protect, status moves or Doubles positioning, so treat it as a starting point.
          </p>
        </div>
      </div>
    </div>
  );
}
