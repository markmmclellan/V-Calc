import { useMemo, useState } from 'react';
import { typeMatchups } from '../lib/typeChart';

const chip = (t: string) => (
  <span key={t} className={`type t-${t.toLowerCase()}`}>
    {t}
  </span>
);

/**
 * A Pokémon's type badges. Hovering (or focusing / tapping) them shows what it takes extra or reduced damage from,
 * grouped by multiplier like Smogon's dex. Type chart only: abilities and items are not included.
 */
export default function TypeBadges({ types }: { types: string[] | undefined }) {
  const [open, setOpen] = useState(false);
  const key = types?.join('/') ?? '';
  const m = useMemo(() => (types?.length ? typeMatchups(types) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!types) return <div className="types"><span className="err">Unknown Pokémon</span></div>;

  const rows: [string, string[], string][] = m
    ? [
        ['4×', m.x4, 'weak'],
        ['2×', m.x2, 'weak'],
        ['½×', m.half, 'resist'],
        ['¼×', m.quarter, 'resist'],
        ['0×', m.immune, 'immune'],
      ]
    : [];

  return (
    <div
      className="types has-pop"
      tabIndex={0}
      aria-label={`${types.join(' / ')} type. Show type matchups.`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      {types.map(chip)}
      {open && m && (
        <div className="type-pop" role="tooltip">
          <div className="type-pop-title">Damage taken · {types.join(' / ')}</div>
          {rows
            .filter(([, list]) => list.length)
            .map(([label, list, kind]) => (
              <div key={label} className={`type-pop-row ${kind}`}>
                <span className="mult">{label}</span>
                <span className="list">{list.map(chip)}</span>
              </div>
            ))}
          <div className="type-pop-note">Types only. Abilities and items can change these.</div>
        </div>
      )}
    </div>
  );
}
