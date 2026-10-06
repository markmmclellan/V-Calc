import { useEffect, useRef, useState } from 'react';

const SRC = 'https://play.pokemonshowdown.com/sprites/gen5ani/shaymin.gif';
const KEY = 'vcalc.mascot';

interface Pos {
  x: number;
  y: number;
}

const loadPos = (): Pos | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null;
  } catch {
    return null;
  }
};

/** Bigger on wide screens, smaller on narrow ones. */
const scaleFor = (width: number) => (width >= 1500 ? 5 : width >= 1100 ? 3 : 2);

/**
 * Shaymin, bottom right by default. Drag her anywhere out of the way (the spot is remembered); double-click sends her
 * back to the corner.
 */
export default function Mascot() {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(() => scaleFor(window.innerWidth));
  const [pos, setPos] = useState<Pos | null>(loadPos);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const box = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const onResize = () => setScale(scaleFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const w = natural ? natural.w * scale : undefined;
  const h = natural ? natural.h * scale : undefined;
  const clamp = (p: Pos): Pos => ({
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - (w ?? 0))),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - (h ?? 0))),
  });
  const shown = pos ? clamp(pos) : null; // also pulls her back on screen if the window shrank

  const save = (p: Pos | null) => {
    setPos(p);
    try {
      if (p) localStorage.setItem(KEY, JSON.stringify(p));
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode: just don't remember it */
    }
  };

  return (
    <img
      ref={box}
      className={`mascot${drag.current ? ' dragging' : ''}`}
      src={SRC}
      alt="Shaymin"
      title="Shaymin! Drag me out of the way (double-click to put me back)"
      draggable={false}
      width={w}
      height={h}
      style={shown ? { left: shown.x, top: shown.y, right: 'auto', bottom: 'auto' } : undefined}
      onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        save(pos ? clamp(pos) : null);
      }}
      onDoubleClick={() => save(null)}
    />
  );
}
