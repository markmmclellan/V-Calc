import { useEffect, useRef, useState } from 'react';
import cringeSheet from '../assets/shaymin/cringe.png';
import hopSheet from '../assets/shaymin/hop.png';
import idleSheet from '../assets/shaymin/idle.png';
import sleepSheet from '../assets/shaymin/sleep.png';
import swingSheet from '../assets/shaymin/swing.png';
import wakeSheet from '../assets/shaymin/wake.png';
import walkSheet from '../assets/shaymin/walk.png';

const KEY = 'vcalc.mascot';

type Mode = 'idle' | 'sleep' | 'wake' | 'cringe' | 'walk' | 'hop' | 'swing';

/**
 * The sprite sheets. `w`/`h` is one frame, `ticks` is how long each frame lasts (60 ticks a second, from the sheet's
 * AnimData.xml), `rows` is how many facing directions the sheet has (8, or 1), `loop` is false for one-shot animations,
 * `anchor` says how a frame lines up with her resting spot: its bottom edge, or its centre (the tall hop and wide swing
 * frames are drawn around her centre).
 */
const ANIMS: Record<Mode, { sheet: string; w: number; h: number; ticks: number[]; rows: number; loop: boolean; anchor: 'bottom' | 'center' }> = {
  idle: { sheet: idleSheet, w: 24, h: 24, ticks: [40, 14, 16, 14], rows: 8, loop: true, anchor: 'bottom' },
  walk: { sheet: walkSheet, w: 24, h: 24, ticks: [10, 12, 10, 12], rows: 8, loop: true, anchor: 'bottom' },
  sleep: { sheet: sleepSheet, w: 24, h: 16, ticks: [30, 35], rows: 8, loop: true, anchor: 'bottom' },
  wake: { sheet: wakeSheet, w: 24, h: 24, ticks: [8, 6, 14, 4, 10], rows: 8, loop: false, anchor: 'bottom' },
  cringe: { sheet: cringeSheet, w: 32, h: 40, ticks: [4, 16], rows: 1, loop: false, anchor: 'bottom' }, // the sheet says [2, 8]: slowed 2x so it reads as a reaction
  hop: { sheet: hopSheet, w: 24, h: 72, ticks: [2, 1, 2, 3, 4, 4, 3, 2, 1, 2], rows: 8, loop: false, anchor: 'center' },
  swing: { sheet: swingSheet, w: 72, h: 72, ticks: [2, 1, 2, 2, 3, 2, 2, 1, 1], rows: 8, loop: false, anchor: 'center' },
};
// she is 24x24 sprite pixels; bigger frames are drawn around that box and are allowed to spill out of it
const BASE = 24;

/** While idle she waits this long (seconds, random in the range) and then does something on her own. */
const REST = [3, 9];
/** What she does next, as weights (they don't need to add up to anything). */
const CHOICES: [string, number][] = [
  ['wander', 5],
  ['hop', 2],
  ['swing', 2],
  ['sleep', 0.4],
];
/** Walking speed in sprite pixels per second, and how far one stroll goes (also in sprite pixels). */
const WALK_SPEED = 26;
const WALK_RANGE = [6, 18];

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

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo);

function pick(): string {
  const total = CHOICES.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [name, w] of CHOICES) if ((r -= w) < 0) return name;
  return 'wander';
}

/**
 * Shaymin, bottom right by default. She idles and, every few seconds, does something on her own: strolls around, hops,
 * swings, or dozes off until you click her (she wakes up). Clicking her while she's awake makes her cringe. Drag her
 * anywhere out of the way: she walks while you carry her and the spot is remembered.
 */
export default function Mascot() {
  const [scale, setScale] = useState(() => scaleFor(window.innerWidth));
  const [pos, setPos] = useState<Pos | null>(loadPos);
  const [mode, setMode] = useState<Mode>('idle');
  const [row, setRow] = useState(0);
  const [frame, setFrame] = useState(0);
  const [target, setTarget] = useState<Pos | null>(null); // where she is strolling to, if she is
  const box = useRef<HTMLDivElement>(null);
  const posRef = useRef<Pos | null>(pos);
  posRef.current = pos;
  const drag = useRef<{ dx: number; dy: number; lastX: number; lastY: number; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onResize = () => setScale(scaleFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const size = BASE * scale;
  const clamp = (p: Pos): Pos => ({
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - size)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - size)),
  });
  const here = (): Pos => {
    if (posRef.current) return clamp(posRef.current);
    const r = box.current!.getBoundingClientRect(); // still in the default corner
    return { x: r.left, y: r.top };
  };

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

  // while idle, wait a bit and then decide what to do next
  useEffect(() => {
    if (mode !== 'idle') return;
    const timer = window.setTimeout(() => {
      const choice = pick();
      if (choice === 'sleep') return setMode('sleep');
      if (choice === 'hop' || choice === 'swing') {
        setRow(Math.floor(Math.random() * 8));
        return setMode(choice);
      }
      // wander: pick a spot a short way off, anywhere on screen
      const from = here();
      const angle = Math.random() * Math.PI * 2;
      const dist = between(WALK_RANGE) * scale;
      const to = clamp({ x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist });
      if (Math.hypot(to.x - from.x, to.y - from.y) < size / 2) {
        setRow(Math.floor(Math.random() * 8));
        return setMode('hop'); // cornered: hop instead
      }
      setPos(from);
      setRow(rowFor(to.x - from.x, to.y - from.y));
      setTarget(to);
      setMode('walk');
    }, between(REST) * 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scale]);

  // walk toward the target, then stop and idle. A plain timer rather than requestAnimationFrame: some browsers hold
  // animation frames back (hidden or partly covered windows, power saving) and she would walk on the spot.
  useEffect(() => {
    if (!target) return;
    let last = performance.now();
    let cur = posRef.current ?? target; // tracked here so a slow render can't make her stall
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const dx = target.x - cur.x;
      const dy = target.y - cur.y;
      const dist = Math.hypot(dx, dy);
      const move = WALK_SPEED * scale * dt;
      if (dist <= move) {
        window.clearInterval(timer);
        setPos(target);
        setTarget(null);
        setRow(0);
        setMode('idle');
        return;
      }
      cur = { x: cur.x + (dx / dist) * move, y: cur.y + (dy / dist) * move };
      setPos(cur);
    }, 16);
    return () => window.clearInterval(timer);
  }, [target, scale]);

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
    <div ref={box} className="mascot-box" style={{ width: size, height: size, ...(shown ? { left: shown.x, top: shown.y, right: 'auto', bottom: 'auto' } : {}) }}>
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
          left: '50%',
          ...(a.anchor === 'bottom' ? { bottom: 0, transform: 'translateX(-50%)' } : { top: '50%', transform: 'translate(-50%, -50%)' }),
        }}
        onPointerDown={(e) => {
          const r = box.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
          setTarget(null); // picking her up stops a stroll
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
            if (posRef.current) save(clamp(posRef.current));
          } else if (mode === 'sleep') setMode('wake');
          else if (mode !== 'wake' && mode !== 'cringe') {
            setRow(0);
            setMode('cringe'); // poked while up and about
          }
        }}
      />
    </div>
  );
}
