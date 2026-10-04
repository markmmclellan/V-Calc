import { useMemo } from 'react';
import type { FieldState } from '../lib/calc';
import { compareSpeed, effectiveSpeed, movePriority, type PriorityInfo } from '../lib/speed';
import type { PokemonSet } from '../lib/model';
import Sprite from './Sprite';
import type { Team } from './TeamSide';

interface Props {
  teams: [Team, Team];
  field: FieldState;
  onSelect: (team: 0 | 1, index: number) => void;
  onTrickRoom: (on: boolean) => void;
  onTailwind: (team: 0 | 1, on: boolean) => void;
}

interface Row {
  team: 0 | 1;
  index: number;
  set: PokemonSet;
  speed: number;
  raw: number;
  notes: string[];
  active: boolean;
}

const SIDE_NAME = ['You', 'Opp'] as const;

function priorityMoves(set: PokemonSet, field: FieldState): PriorityInfo[] {
  return set.moves
    .map((m) => movePriority(set, m, field))
    .filter((p): p is PriorityInfo => !!p && p.priority !== 0)
    .sort((x, y) => y.priority - x.priority);
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export default function TurnOrder({ teams, field, onSelect, onTrickRoom, onTailwind }: Props) {
  const tr = !!field.isTrickRoom;

  const rows = useMemo(() => {
    const out: Row[] = [];
    teams.forEach((t, team) => {
      const side = team === 0 ? field.attackerSide : field.defenderSide;
      t.sets.forEach((set, index) => {
        const info = effectiveSpeed(set, field, side);
        if (info) out.push({ team: team as 0 | 1, index, set, ...info, active: index === t.active });
      });
    });
    // Fastest first (slowest first under Trick Room). Stable sort keeps "You" ahead on ties.
    return out.sort((x, y) => (tr ? x.speed - y.speed : y.speed - x.speed));
  }, [teams, field, tr]);

  const a = rows.find((r) => r.team === 0 && r.active);
  const b = rows.find((r) => r.team === 1 && r.active);

  const summary = useMemo(() => {
    if (!a || !b) return null;
    const who = compareSpeed(a.speed, b.speed, tr);
    const first = who === 'a' ? a : b;
    const second = who === 'a' ? b : a;
    const pa = priorityMoves(a.set, field);
    const pb = priorityMoves(b.set, field);
    return { who, first, second, pa, pb };
  }, [a, b, field, tr]);

  return (
    <section className="panel turn-order">
      <div className="to-head">
        <h2
          title="Includes stat stages, Choice Scarf, Tailwind, paralysis, weather/terrain speed abilities and Trick Room. Quick Claw, Custap Berry and move-specific effects aren't modeled."
        >
          Turn order
        </h2>
        <div className="to-toggles">
          <label className="chip" title="Slower Pokémon move first">
            <input type="checkbox" checked={tr} onChange={(e) => onTrickRoom(e.target.checked)} />
            Trick Room
          </label>
          <label className="chip" title="Doubles your side's Speed">
            <input type="checkbox" checked={field.attackerSide.isTailwind} onChange={(e) => onTailwind(0, e.target.checked)} />
            Your Tailwind
          </label>
          <label className="chip" title="Doubles the opponent's Speed">
            <input type="checkbox" checked={field.defenderSide.isTailwind} onChange={(e) => onTailwind(1, e.target.checked)} />
            Opp Tailwind
          </label>
        </div>
      </div>

      {summary && a && b && (
        <div className={'to-summary ' + (summary.who === 'tie' ? 'tie' : summary.who === 'a' ? 'you' : 'opp')}>
          {summary.who === 'tie' ? (
            <strong>Speed tie: {a.speed} each (50/50)</strong>
          ) : (
            <>
              <strong>
                {summary.first.set.species} moves first
                {tr ? ' (Trick Room)' : ''}
              </strong>
              <span className="hint">
                {' '}
                {summary.first.speed} vs {summary.second.speed} Speed
              </span>
            </>
          )}
          {(summary.pa.length > 0 || summary.pb.length > 0) && (
            <div className="to-prio" title="A higher priority bracket moves first regardless of Speed.">
              {[
                [a, summary.pa],
                [b, summary.pb],
              ].map(([r, list]) =>
                (list as PriorityInfo[]).length ? (
                  <div key={(r as Row).team}>
                    <span className="hint">{(r as Row).set.species}: </span>
                    {(list as PriorityInfo[]).map((p) => (
                      <span key={p.move} className={'prio ' + (p.priority > 0 ? 'pos' : 'neg')} title={p.note}>
                        {p.move} {signed(p.priority)}
                        {p.note ? ` (${p.note})` : ''}
                      </span>
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="hint">Add Pokémon to see speed order.</p>
      ) : (
        <ol className="to-list">
          {rows.map((r, i) => (
            <li
              key={`${r.team}-${r.index}`}
              className={`side${r.team}` + (r.active ? ' active' : '')}
              onClick={() => onSelect(r.team, r.index)}
              title={r.notes.length ? `${r.notes.join(', ')} (click to select)` : 'Click to select'}
            >
              <span className="pos">{i + 1}</span>
              <Sprite species={r.set.species} size={20} />
              <span className="nm">
                {r.set.nickname || r.set.species}
                <span className="side-tag">{SIDE_NAME[r.team]}</span>
              </span>
              <span className="notes">{r.notes.join(', ')}</span>
              <span className="spd">{r.speed}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
