import { useEffect, useMemo, useRef, useState } from 'react';
import { loadReference, searchEntries, targetLabel, type RefMove, type Reference } from '../lib/reference';

export type LookUpKind = 'moves' | 'items' | 'abilities';

interface Props {
  onClose: () => void;
}

const SHOW_LIMIT = 150;

const KIND_LABEL: Record<LookUpKind, string> = { moves: 'Move', items: 'Item', abilities: 'Ability' };

interface Row {
  name: string;
  description: string;
  kind: LookUpKind;
  move?: RefMove;
}

/** One searchable list of every Champions move, item and ability (Smogon's Champions dex). */
export default function LookUp({ onClose }: Props) {
  const [ref, setRef] = useState<Reference | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
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

  const all = useMemo<Row[]>(
    () =>
      ref
        ? [
            ...ref.moves.map((m): Row => ({ name: m.name, description: m.description, kind: 'moves', move: m })),
            ...ref.items.map((e): Row => ({ name: e.name, description: e.description, kind: 'items' })),
            ...ref.abilities.map((e): Row => ({ name: e.name, description: e.description, kind: 'abilities' })),
          ]
        : [],
    [ref],
  );
  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchEntries(all, query) : []), [all, query, searching]);
  const shown = results.slice(0, SHOW_LIMIT);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal lookup" role="dialog" aria-modal="true" aria-label="Look up moves, items and abilities">
        <header className="modal-head">
          <h2>Look up</h2>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="modal-sub">
          <input
            ref={inputRef}
            value={query}
            placeholder='Search moves, items and abilities, e.g. "intimidate", "lowers speed", "1.5x"…'
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="lookup-count hint">
          {error ? (
            <span className="err">{error}</span>
          ) : !ref ? (
            'Loading…'
          ) : (
            <>
              {!searching
                ? 'Type to search every move, item and ability'
                : `${results.length} ${results.length === 1 ? 'result' : 'results'}${results.length > SHOW_LIMIT ? ` (showing the first ${SHOW_LIMIT}: refine your search)` : ''}`}{' '}
              · Smogon Champions dex
            </>
          )}
        </div>

        <ul className="lookup-rows">
          {shown.map((e) => {
            const m = e.move;
            return (
              <li key={`${e.kind}-${e.name}`}>
                <div className="lu-main">
                  <div className="lu-line">
                    <span className="lu-name">{e.name}</span>
                    <span className={`cat lu-kind lu-kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
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
                  <div className="lu-desc">{e.description || 'No description.'}</div>
                </div>
              </li>
            );
          })}
          {ref && searching && results.length === 0 && <li className="lu-empty hint">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
