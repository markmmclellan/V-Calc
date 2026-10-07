import { useEffect, useRef, useState } from 'react';
import cringeSheet from '../assets/shaymin/cringe.png';
import idleSheet from '../assets/shaymin/idle.png';
import sleepSheet from '../assets/shaymin/sleep.png';
import wakeSheet from '../assets/shaymin/wake.png';
import walkSheet from '../assets/shaymin/walk.png';

const KEY = 'vcalc.mascot';

type Mode = 'idle' | 'sleep' | 'wake' | 'cringe' | 'walk';

/**
 * The sprite sheets. `w`/`h` is one frame, `ticks` is how long each frame lasts (60 ticks a second, from the sheet's
 * AnimData.xml), `rows` is how many facing directions the sheet has (8, or 1), `loop` is false for one-shot animations.
 */
const ANIMS: Record<Mode, { sheet: string; w: number; h: number; ticks: number[]; rows: number; loop: boolean }> = {
  idle: { sheet: idleSheet, w: 24, h: 24, ticks: [40, 14, 16, 14], rows: 8, loop: true },
  walk: { sheet: walkSheet, w: 24, h: 24, ticks: [10, 12, 10, 12], rows: 8, loop: true },
  sleep: { sheet: sleepSheet, w: 24, h: 16, ticks: [30, 35], rows: 8, loop: true },
  wake: { sheet: wakeSheet, w: 24, h: 24, ticks: [8, 6, 14, 4, 10], rows: 8, loop: false },
  cringe: { sheet: cringeSheet, w: 32, h: 40, ticks: [4, 16], rows: 1, loop: false }, // the sheet says [2, 8]: slowed 2x so it reads as a reaction
};
// the box she lives in is as big as the biggest frame; every animation is drawn bottom-centre in it
const BOX_W = 32;
const BOX_H = 40;

/** She dozes off after this long without being touched (random in this range, in seconds). */
const NAP_AFTER = [20, 60];

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
 * Shaymin, bottom right by default. She idles, and now and then falls asleep until you click her (she wakes up). Clicking
 * her while she is awake makes her cringe. Drag her anywhere out of the way: she walks while you carry her and the spot
 * is remembered.
 */
export default function Mascot() {
  const [scale, setScale] = useState(() => scaleFor(window.innerWidth));
  const [pos, setPos] = useState<Pos | null>(loadPos);
  const [mode, setMode] = useState<Mode>('idle');
  const [row, setRow] = useState(0);
  const [frame, setFrame] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; lastX: number; lastY: number; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onResize = () => setScale(scaleFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // step through the frames, each held for its own length; one-shot animations hand back to idling when they finish
  useEffect(() => {
    setFrame(0);
    const { ticks, loop } = ANIMS[mode];
    let i = 0;
    let timer: number;
    const next = () => {
      timer = window.setTimeout(() => {
        if (i + 1 >= ticks.length && !loop) {
          setMode('idle');
          return;
        }
        i = (i + 1) % ticks.length;
        setFrame(i);
        next();
      }, (ticks[i] * 1000) / 60);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [mode]);

  // after a while of idling, doze off
  useEffect(() => {
    if (mode !== 'idle') return;
    const wait = (NAP_AFTER[0] + Math.random() * (NAP_AFTER[1] - NAP_AFTER[0])) * 1000;
    const timer = window.setTimeout(() => setMode('sleep'), wait);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const boxW = BOX_W * scale;
  const boxH = BOX_H * scale;
  const clamp = (p: Pos): Pos => ({
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - boxW)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - boxH)),
  });
  const shown = pos ? clamp(pos) : null; // also pulls her back on screen if the window shrank

  const save = (p: Pos) => {
    setPos(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* private mode: just don't remember it */
    }
  };

  const a = ANIMS[mode];
  const dir = a.rows === 1 ? 0 : row;
  return (
    <div
      ref={box}
      className="mascot-box"
      style={{ width: boxW, height: boxH, ...(shown ? { left: shown.x, top: shown.y, right: 'auto', bottom: 'auto' } : {}) }}
    >
      <div
        className={`mascot${drag.current?.moved ? ' dragging' : ''}`}
        role="img"
        aria-label="Shaymin"
        title="Shaymin! Click her, or drag her out of the way"
        style={{
          width: a.w * scale,
          height: a.h * scale,
          backgroundImage: `url(${a.sheet})`,
          backgroundSize: `${a.w * a.ticks.length * scale}px ${a.h * a.rows * scale}px`,
          backgroundPosition: `${-frame * a.w * scale}px ${-dir * a.h * scale}px`,
        }}
        onPointerDown={(e) => {
          const r = box.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved) {
            if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return; // still just a click
            d.moved = true;
            setMode('walk'); // being carried wakes her up
          }
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
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (d.moved) {
            setRow(0); // back to facing the front
            setMode('idle');
            if (pos) save(clamp(pos));
          } else if (mode === 'sleep') setMode('wake');
          else if (mode === 'idle') setMode('cringe');
        }}
      />
    </div>
  );
}
