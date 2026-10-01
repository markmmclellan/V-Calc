import { useState } from 'react';
import { spriteSources } from '../lib/sprites';

/** Showdown's animated sprite, falling back to its static placeholder; blank if neither exists. */
export default function Sprite({ species, size = 40 }: { species: string; size?: number }) {
  const sources = spriteSources(species);
  const [failed, setFailed] = useState<{ species: string; count: number }>({ species, count: 0 });
  const tried = failed.species === species ? failed.count : 0;
  const src = sources[tried];
  if (!src) return <span className="sprite-ph" style={{ width: size, height: size }} />;
  return (
    <img
      className="sprite"
      src={src}
      width={size}
      height={size}
      alt=""
      draggable={false}
      loading="lazy"
      onError={() => setFailed({ species, count: tried + 1 })}
    />
  );
}
