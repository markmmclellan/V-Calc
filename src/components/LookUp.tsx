import { useEffect, useMemo, useRef, useState } from 'react';
import { loadReference, searchEntries, targetLabel, type RefEntry, type RefMove, type Reference } from '../lib/reference';

export type LookUpKind = 'moves' | 'items' | 'abilities';

interface Props {
  onClose: () => void;
}

const SHOW_LIMIT = 150;
const TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];

const TAB_LABEL: Record<LookUpKind, string> = { moves: 'Moves', items: 'Items', abilities: 'Abilities' };
const SINGULAR: Record<LookUpKind, string> = { moves: 'move', items: 'item', abilities: 'ability' };

/** Searchable move / item / ability reference (Smogon's Champions dex). */
export default function LookUp({ onClose }: Props) {
  const [ref, setRef] = useState<Reference | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<LookUpKind>('moves');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadReference().then(setRef, (e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => inputRef.current?.focus(), [tab]);

  const results = useMemo(() => {
    if (!ref) return [];
    if (tab === 'moves') {
      const filtered = ref.moves.filter((m) => (!type || m.type === type) && (!category || m.category === category));
      return searchEntries(filtered, query);
    }
    return searchEntries(ref[tab], query);
  }, [ref, tab, query, type, category]);

  const shown = results.slice(0, SHOW_LIMIT);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal lookup" role="dialog" aria-modal="true" aria-label="Look up moves, items and abilities">
        <header className="modal-head">
          <h2>Look up</h2>
          <div className="seg" role="tablist" aria-label="What to look up">
            {(['moves', 'items', 'abilities'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => {
                  setTab(k);
                  setQuery(''); // a query for moves makes no sense on the items tab
                }}>
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="modal-sub">
          <input
            ref={inputRef}
            value={query}
            placeholder={
              tab === 'moves' ? 'Search moves, e.g. "lowers speed" or "flinch"…' : tab === 'items' ? 'Search items, e.g. "1.5x" or "berry"…' : 'Search abilities, e.g. "weather" or "contact"…'
            }
            onChange={(e) => setQuery(e.target.value)}
          />
          {tab === 'moves' && (
            <>
              <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
                <option value="">Any type</option>
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
                <option value="">Any category</option>
                <option>Physical</option>
                <option>Special</option>
                <option>Status</option>
              </select>
            </>
          )}
        </div>
        <div className="lookup-count hint">
          {error ? (
            <span className="err">{error}</span>
          ) : !ref ? (
            'Loading…'
          ) : (
            <>
              {results.length} {results.length === 1 ? SINGULAR[tab] : TAB_LABEL[tab].toLowerCase()}
              {results.length > SHOW_LIMIT ? ` (showing the first ${SHOW_LIMIT}: refine your search)` : ''} · Smogon Champions dex
            </>
          )}
        </div>

        <ul className="lookup-rows">
          {shown.map((e) => {
            const m = tab === 'moves' ? (e as RefMove) : null;
            return (
              <li key={e.name}>
                <div className="lu-main">
                  <div className="lu-line">
                    <span className="lu-name">{e.name}</span>
                    {m && (
                      <>
                        <span className={`type t-${m.type.toLowerCase()}`}>{m.type}</span>
                        <span className={`cat cat-${m.category.toLowerCase()}`}>{m.category}</span>
                        <span className="lu-stats">
                          {m.category === 'Status' ? '' : `Pow ${m.power || '—'} · `}Acc {m.accuracy || '—'} · PP {m.pp}
                          {m.priority ? ` · Priority ${m.priority > 0 ? '+' : ''}${m.priority}` : ''} · {targetLabel(m.target)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="lu-desc">{(e as RefEntry).description || 'No description.'}</div>
                </div>
              </li>
            );
          })}
          {ref && results.length === 0 && <li className="lu-empty hint">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
