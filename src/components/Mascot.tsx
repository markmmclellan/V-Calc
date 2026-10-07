import { useEffect, useRef, useState } from 'react';
import idleSheet from '../assets/shaymin/idle.png';
import walkSheet from '../assets/shaymin/walk.png';

const KEY = 'vcalc.mascot';
const FRAME = 24; // px per frame in the sprite sheets (4 frames across, 8 facing directions down)

/** Frame lengths in game ticks (60 per second), from the sheet's AnimData.xml. */
const ANIMS = {
  idle: { sheet: idleSheet, ticks: [40, 14, 16, 14] },
  walk: { sheet: walkSheet, ticks: [10, 12, 10, 12] },
};
type Anim = keyof typeof ANIMS;

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

/** Pixels per sprite pixel: bigger on wide screens, smaller on narrow ones. */
const scaleFor = (width: number) => (width >= 1500 ? 6 : width >= 1100 ? 4 : 3);

/** Sheet rows are Down, Down-Right, Right, Up-Right, Up, Up-Left, Left, Down-Left. */
const rowFor = (dx: number, dy: number) => {
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = straight down, 90 = right, 180 = up
  return Math.round(((deg + 360) % 360) / 45) % 8;
};

/**
 * Shaymin, bottom right by default, idling. Drag her anywhere out of the way (she walks while you carry her, and the
 * spot is remembered); double-click sends her back to the corner.
 */
export default function Mascot() {
  const [scale, setScale] = useState(() => scaleFor(window.innerWidth));
  const [pos, setPos] = useState<Pos | null>(loadPos);
  const [anim, setAnim] = useState<Anim>('idle');
  const [row, setRow] = useState(0);
  const [frame, setFrame] = useState(0);
  const drag = useRef<{ dx: number; dy: number; lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    const onResize = () => setScale(scaleFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // step through the frames, each held for its own length
  useEffect(() => {
    setFrame(0);
    const ticks = ANIMS[anim].ticks;
    let i = 0;
    let timer: number;
    const next = () => {
      timer = window.setTimeout(() => {
        i = (i + 1) % ticks.length;
        setFrame(i);
        next();
      }, (ticks[i] * 1000) / 60);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [anim]);

  const size = FRAME * scale;
  const clamp = (p: Pos): Pos => ({
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - size)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - size)),
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

  const sheet = ANIMS[anim].sheet;
  return (
    <div
      className={`mascot${drag.current ? ' dragging' : ''}`}
      role="img"
      aria-label="Shaymin"
      title="Shaymin! Drag me out of the way (double-click to put me back)"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${sheet})`,
        backgroundSize: `${FRAME * 4 * scale}px ${FRAME * 8 * scale}px`,
        backgroundPosition: `${-frame * size}px ${-row * size}px`,
        ...(shown ? { left: shown.x, top: shown.y, right: 'auto', bottom: 'auto' } : {}),
      }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, lastX: e.clientX, lastY: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        setAnim('walk');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const mx = e.clientX - d.lastX;
        const my = e.clientY - d.lastY;
        if (Math.hypot(mx, my) >= 4) {
          setRow(rowFor(mx, my)); // face the way she is being carried
          d.lastX = e.clientX;
          d.lastY = e.clientY;
        }
        setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setAnim('idle');
        setRow(0); // back to facing the front
        save(pos ? clamp(pos) : null);
      }}
      onDoubleClick={() => save(null)}
    />
  );
}
