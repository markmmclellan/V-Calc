import { Fragment, useMemo } from 'react';
import { calcMove, type FieldState, type MoveResult } from '../lib/calc';
import type { PokemonSet } from '../lib/model';
import Sprite from './Sprite';

interface Props {
  /** The Pokémon on the attacking side: one, or two when a Doubles pair is selected. */
  attackers: PokemonSet[];
  /** The Pokémon on the defending side. */
  defenders: PokemonSet[];
  field: FieldState;
  /** true when the attackers belong to the opponent side (so side conditions flip) */
  reversed: boolean;
  /** Heading for the usual one-versus-one view. */
  title: string;
  /** Heading when a side has two Pokémon out. */
  pairTitle: string;
}

function hpClass(pct: number) {
  return pct >= 100 ? 'ko' : pct >= 50 ? 'high' : pct >= 25 ? 'mid' : 'low';
}

const nameOf = (s: PokemonSet) => s.nickname || s.species;

/** One attacker's four moves against one defender. */
function calcAll(att: PokemonSet, def: PokemonSet, field: FieldState, reversed: boolean): MoveResult[] {
  return att.moves.map((m, i) => calcMove(att, def, m, att.critMoves[i] ?? false, field, reversed));
}

function Single({ attacker, defender, field, reversed }: { attacker: PokemonSet; defender: PokemonSet; field: FieldState; reversed: boolean }) {
  const results = useMemo(() => calcAll(attacker, defender, field, reversed), [attacker, defender, field, reversed]);
  return (
    <ul>
      {results.map((r, i) => (
        <li key={i} className={r.ok ? '' : 'nocalc'}>
          <div className="r-head">
            <span className="r-move">{attacker.moves[i] || <em>—</em>}</span>
            {r.ok ? (
              <>
                <span className="r-pct">
                  {r.minPct}% – {r.maxPct}%
                </span>
                <span className="r-dmg">
                  ({r.min}–{r.max} / {r.defenderHP})
                </span>
                <span className="r-ko">{r.ko}</span>
              </>
            ) : (
              <span className="hint">{r.category === 'Status' ? 'Status move' : r.desc || ''}</span>
            )}
          </div>
          {r.ok && (
            <>
              <div className="hpbar">
                <span className={hpClass(r.maxPct)} style={{ width: `${Math.min(100, r.maxPct)}%` }} />
                <span className="min" style={{ width: `${Math.min(100, r.minPct)}%` }} />
              </div>
              <div className="r-desc" title={r.desc}>
                {r.desc}
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Every attacker's damaging moves against every defender: one row per move, one column per defender. */
function Grid({ attackers, defenders, field, reversed }: { attackers: PokemonSet[]; defenders: PokemonSet[]; field: FieldState; reversed: boolean }) {
  const blocks = useMemo(
    () =>
      attackers.map((att) => ({
        att,
        rows: att.moves
          .map((move, i) => ({ move, cells: defenders.map((d) => calcMove(att, d, move, att.critMoves[i] ?? false, field, reversed)) }))
          // status moves and empty slots don't deal damage, so they have nothing to show here
          .filter((r) => r.move && r.cells.some((c) => c.category !== 'Status')),
      })),
    [attackers, defenders, field, reversed],
  );

  return (
    <div className="mx" style={{ '--cols': defenders.length } as React.CSSProperties}>
      <div className="mx-row mx-colhead">
        <span />
        {defenders.map((d, j) => (
          <span key={j} className="mx-col" title={d.species}>
            <Sprite species={d.species} size={20} />
            {nameOf(d)}
          </span>
        ))}
      </div>
      {blocks.map(({ att, rows }, bi) => (
        <Fragment key={bi}>
          <div className="mx-att">
            <Sprite species={att.species} size={22} />
            {nameOf(att)}
          </div>
          {rows.length === 0 && <p className="hint mx-none">No damaging moves.</p>}
          {rows.map((r, ri) => (
            <div key={ri} className="mx-row">
              <span className="mx-move" title={r.move}>
                {r.move}
              </span>
              {r.cells.map((c, j) =>
                c.ok ? (
                  <div key={j} className="mx-cell" title={c.desc}>
                    <div className="mx-top">
                      <span className="r-pct">
                        {c.minPct}–{c.maxPct}%
                      </span>
                      <span className="r-ko">{c.ko}</span>
                    </div>
                    <div className="hpbar">
                      <span className={hpClass(c.maxPct)} style={{ width: `${Math.min(100, c.maxPct)}%` }} />
                      <span className="min" style={{ width: `${Math.min(100, c.minPct)}%` }} />
                    </div>
                  </div>
                ) : (
                  <div key={j} className="mx-cell nocalc" title={c.desc}>
                    <span className="hint">{c.desc || '—'}</span>
                  </div>
                ),
              )}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export default function Results({ attackers, defenders, field, reversed, title, pairTitle }: Props) {
  const multi = attackers.length > 1 || defenders.length > 1;
  return (
    <section className="panel results">
      <h2>{multi && attackers.length && defenders.length ? pairTitle : title}</h2>
      {!attackers.length || !defenders.length ? (
        <p className="hint">Add a Pokémon to both sides.</p>
      ) : multi ? (
        <Grid attackers={attackers} defenders={defenders} field={field} reversed={reversed} />
      ) : (
        <Single attacker={attackers[0]} defender={defenders[0]} field={field} reversed={reversed} />
      )}
    </section>
  );
}
