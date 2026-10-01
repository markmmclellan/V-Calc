import { useState } from 'react';
import type { BattleFormat, MetaEntry, UsageRow } from '../lib/data';
import { spTotal, STAT_KEYS, STAT_LABEL, type PokemonSet } from '../lib/model';

interface Props {
  entry: MetaEntry | undefined;
  format: BattleFormat;
  set: PokemonSet;
  onChange: (s: PokemonSet) => void;
  setItem: (item: string) => void;
}

function Bars({ rows, selected, onPick }: { rows: UsageRow[]; selected: (n: string) => boolean; onPick: (n: string) => void }) {
  return (
    <ul className="usage-list">
      {rows.map((r) => (
        <li key={r.name} className={selected(r.name) ? 'on' : ''} onClick={() => onPick(r.name)}>
          <span className="bar" style={{ width: `${Math.min(100, r.usage)}%` }} />
          <span className="nm">{r.name}</span>
          <span className="pc">{r.usage}%</span>
        </li>
      ))}
    </ul>
  );
}

export default function UsagePanel({ entry, format, set, onChange, setItem }: Props) {
  const [tab, setTab] = useState<'moves' | 'items' | 'abilities' | 'natures' | 'spreads'>('moves');
  // Which move slot a clicked move goes into: 'auto' = first empty slot (or slot 4 when all are full)
  const [slot, setSlot] = useState<'auto' | 0 | 1 | 2 | 3>('auto');
  const data = entry?.data[format];
  if (!entry || !data) {
    return (
      <div className="usage">
        <h3>op.gg usage</h3>
        <p className="hint">No op.gg data for this Pokémon.</p>
      </div>
    );
  }

  const toggleMove = (name: string) => {
    const moves = [0, 1, 2, 3].map((i) => set.moves[i] ?? '');
    const critMoves = [0, 1, 2, 3].map((i) => set.critMoves?.[i] ?? false);
    const clear = (i: number) => {
      moves[i] = '';
      critMoves[i] = false;
    };
    const at = moves.indexOf(name);
    if (slot === 'auto') {
      if (at >= 0) clear(at);
      else {
        const target = moves.indexOf('') >= 0 ? moves.indexOf('') : 3;
        moves[target] = name;
        critMoves[target] = false;
      }
    } else if (at === slot) {
      clear(slot); // clicking the move already in the chosen slot removes it
    } else {
      if (at >= 0) clear(at); // a move can only be in one slot, so this moves it
      moves[slot] = name;
      critMoves[slot] = false;
    }
    onChange({ ...set, moves, critMoves });
  };

  const tabs = ['moves', 'items', 'abilities', 'natures', 'spreads'] as const;
  return (
    <div className="usage">
      <h3>
        op.gg usage <span className="hint">
          · {format === 'single' ? 'Singles' : 'Doubles'} rank #{entry.rank[format] ?? '–'} · click to apply
        </span>
      </h3>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        {tab === 'moves' && (
          <span className="slot-pick" role="group" aria-label="Move slot to fill">
            <span className="hint">Fill slot</span>
            {(['auto', 0, 1, 2, 3] as const).map((n) => (
              <button
                key={n}
                className={n === slot ? 'on' : ''}
                onClick={() => setSlot(n)}
                title={n === 'auto' ? 'First empty slot (slot 4 when all are full)' : `Slot ${n + 1}: ${set.moves[n] || 'empty'}`}
              >
                {n === 'auto' ? 'Auto' : n + 1}
              </button>
            ))}
          </span>
        )}
      </div>
      {tab === 'moves' && <Bars rows={data.moves} selected={(n) => set.moves.includes(n)} onPick={toggleMove} />}
      {tab === 'items' && <Bars rows={data.items} selected={(n) => n === set.item} onPick={setItem} />}
      {tab === 'abilities' && (
        <Bars rows={data.abilities} selected={(n) => n === set.ability} onPick={(n) => onChange({ ...set, ability: n })} />
      )}
      {tab === 'natures' && (
        <Bars rows={data.natures} selected={(n) => n === set.nature} onPick={(n) => onChange({ ...set, nature: n })} />
      )}
      {tab === 'spreads' && (
        <ul className="usage-list">
          {data.spreads.slice(0, 10).map((s, i) => {
            const on = STAT_KEYS.every((k) => set.sp[k] === s.sp[k]);
            return (
              <li key={i} className={on ? 'on' : ''} onClick={() => onChange({ ...set, sp: { ...s.sp } })}>
                <span className="bar" style={{ width: `${Math.min(100, s.usage * 2)}%` }} />
                <span className="nm">
                  {STAT_KEYS.filter((k) => s.sp[k] > 0)
                    .map((k) => `${s.sp[k]} ${STAT_LABEL[k]}`)
                    .join(' / ') || '—'}
                  <span className="hint"> ({spTotal(s.sp)})</span>
                </span>
                <span className="pc">{s.usage}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
