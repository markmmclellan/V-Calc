import { useEffect, useMemo, useRef, useState } from 'react';
import type { BattleFormat, Meta, MetaEntry } from '../lib/data';
import { gen } from '../lib/model';
import { toID } from '@smogon/calc';
import Sprite from './Sprite';

interface Props {
  meta: Meta;
  /** Which ranking to show first (the app's current Singles/Doubles mode). */
  format: BattleFormat;
  /** Pokémon counts so full teams can disable their add button. */
  teamSizes: [number, number];
  onAdd: (side: 0 | 1, entry: MetaEntry) => void;
  onClose: () => void;
}

const typesOf = (species: string): string[] => (gen.species.get(toID(species))?.types as string[] | undefined) ?? [];

/** op.gg's "tier" ranking of the most used Pokémon, with one-click add to either team. */
export default function MetaList({ meta, format, teamSizes, onAdd, onClose }: Props) {
  const [fmt, setFmt] = useState<BattleFormat>(format);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ranked = useMemo(
    () =>
      meta.entries
        .filter((e) => e.rank[fmt] != null)
        .sort((a, b) => (a.rank[fmt] as number) - (b.rank[fmt] as number)),
    [meta, fmt],
  );

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((e) => e.displayName.toLowerCase().includes(q) || typesOf(e.species).some((t) => t.toLowerCase().startsWith(q)));
  }, [ranked, filter]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal meta-list" role="dialog" aria-modal="true" aria-label="Most used Pokémon">
        <header className="modal-head">
          <h2>Most used Pokémon</h2>
          <div className="seg" role="group" aria-label="Ranking format">
            <button className={fmt === 'single' ? 'on' : ''} onClick={() => setFmt('single')}>
              Singles
            </button>
            <button className={fmt === 'double' ? 'on' : ''} onClick={() => setFmt('double')}>
              Doubles
            </button>
          </div>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>
        <div className="modal-sub">
          <input
            ref={inputRef}
            value={filter}
            placeholder="Filter by name or type…"
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="hint">
            {rows.length === ranked.length ? `${ranked.length} ranked` : `${rows.length} of ${ranked.length}`} · op.gg rank
            {meta.opggUpdatedAt ? ` · updated ${meta.opggUpdatedAt}` : ''}
          </span>
        </div>

        <ol className="meta-rows">
          {rows.map((e) => (
            <li key={e.key}>
              <span className="mr-rank">#{e.rank[fmt]}</span>
              <Sprite species={e.species} size={30} />
              <span className="mr-name" title={e.displayName}>
                {e.displayName}
              </span>
              <span className="mr-types">
                {typesOf(e.species).map((t) => (
                  <span key={t} className={`type t-${t.toLowerCase()}`}>
                    {t}
                  </span>
                ))}
              </span>
              <span className="mr-add">
                <button
                  disabled={teamSizes[0] >= 6}
                  onClick={() => onAdd(0, e)}
                  title={teamSizes[0] >= 6 ? 'Your team is full (6)' : `Add ${e.displayName} to your team`}
                >
                  + You
                </button>
                <button
                  disabled={teamSizes[1] >= 6}
                  onClick={() => onAdd(1, e)}
                  title={teamSizes[1] >= 6 ? "The opponent's team is full (6)" : `Add ${e.displayName} to the opponent's team`}
                >
                  + Opp
                </button>
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className="mr-empty hint">No Pokémon match “{filter}”.</li>}
        </ol>
      </div>
    </div>
  );
}
