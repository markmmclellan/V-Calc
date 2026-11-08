import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldState } from '../lib/calc';
import {
  askBringCheck,
  askCheck,
  askQuick,
  askReplace,
  askPlayTurn,
  askSendIn,
  askLikelySets,
  askLeads,
  logBoard,
  oppSetsJson,
  maxHpOf,
  type LikelySets,
  type PlayHit,
  type SeenHit,
  askSolve,
  sendReport,
  appeared,
  baseName,
  CHARGE_MOVES,
  blankMarks,
  buildPosition,
  getBotUrl,
  pingBot,
  type BringCheck,
  type Marks,
  type MoveCheck,
  type Outcome,
  type PlayResult,
  type SolveResult,
  type Vol,
} from '../lib/bot';
import { calcStats, type PokemonSet } from '../lib/model';
import { metaFor, type Meta } from '../lib/data';

/** Abilities that set the weather or terrain when their holder comes in. */
const ON_ENTRY: Record<string, { weather?: string; terrain?: string }> = {
  'Sand Stream': { weather: 'Sand' },
  Drought: { weather: 'Sun' },
  Drizzle: { weather: 'Rain' },
  'Snow Warning': { weather: 'Snow' },
  'Grassy Surge': { terrain: 'Grassy' },
  'Electric Surge': { terrain: 'Electric' },
  'Psychic Surge': { terrain: 'Psychic' },
  'Misty Surge': { terrain: 'Misty' },
};
import type { Team } from './TeamSide';
import BattleView from './BattleView';
import Sprite from './Sprite';

interface Props {
  open: boolean;
  teams: [Team, Team];
  /** Edit the battle from the panel (who is out, HP, status), so the main calc can stay as it is. */
  setTeams: (f: (old: [Team, Team]) => [Team, Team]) => void;
  field: FieldState;
  /** The calc's field (weather, hazards, screens, Leech Seed…), set from the battle view. */
  setField: (f: (old: FieldState) => FieldState) => void;
  skipped: string[]; // species of yours left at home (set by What to bring)
  singles: boolean;
  /** Goes up each time the battle is reset (Reset battle, or the opponent's team cleared): a new game. */
  battleId: number;
  /** Same function What to bring uses: put these first, select the lead. */
  onApplyBring: (bring: number[], leads: number[]) => void;
  onResetBattle: () => void;
  onClose: () => void;
  /** op.gg usage data (the next most likely item for the Item Clause) */
  meta?: Meta | null;
}

const MARKS_KEY = 'champions-calc:ai-marks:v1';
const AUTO_KEY = 'champions-calc:ai-auto:v1';
const SECS_KEY = 'champions-calc:ai-seconds:v1';
const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};


const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Turns left, counting the turn it started, when a timed effect starts (core-series lengths; not yet checked in Champions).
 * Taunt, Encore and Yawn count from the turn after (Yawn: asleep at the end of the next turn). */
const TIMED: Record<string, number> = { weather: 5, terrain: 5, tr: 5, isTailwind: 4, isReflect: 5, isLightScreen: 5, isAuroraVeil: 5, taunt: 4, encore: 4, yawn: 2 };
const timerStart = (key: string) => TIMED[key.split(':').pop()!] ?? 5;
/** " + Mega" after one of their moves when the bot expects them to Mega Evolve with it ("+ Mega 60%" when unsure). */
const megaNote = (m?: number) => (m == null || m < 0.05 ? '' : m >= 0.95 ? ' + Mega' : ` + Mega ${Math.round(m * 100)}%`);
/** Options this close (win chance against their likely play) are a toss-up: the simulation cannot tell them apart. */
const CLOSE = 0.02;
const Bar = ({ v }: { v: number }) => (
  <div className="ai-bar">
    <span style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
  </div>
);

type Advice = { pSwitch?: number; title: string; rows: { sendIn?: string; label: string; v: number; stay?: number; sw?: number; net?: number; heur?: number; ko?: number; n?: number }[]; quick?: string; note?: string };

/**
 * Advice from the local simulation bot, docked beside the calc. It reads the battle from V-Calc, lets you update the
 * board from here (who is out, HP, status, fainted), keeps track of what it can (who has appeared, the turn number),
 * and re-solves the turn by itself whenever the board changes.
 */
/** Board changes within this long of the last answer are you still entering the same turn. */
const SAME_TURN_MS = 20_000;
/** Time the bring check may take at team preview. */
const BRING_SECS = 20;

export default function BotPanel({ open, teams, setTeams, field, setField, skipped, singles, battleId, onApplyBring, onResetBattle, onClose, meta }: Props) {
  const [up, setUp] = useState<boolean | null>(null);
  const [marks, setMarks] = useState<Record<string, Marks>>(() => load(MARKS_KEY, {}));
  const [auto, setAuto] = useState<boolean>(() => load(AUTO_KEY, true));
  const [secs, setSecs] = useState<number>(() => load(SECS_KEY, 8)); // time the bot may think per answer
  const [picked, setPicked] = useState<string[] | null>(null); // base names; null = follow What to bring
  const [turn, setTurnRaw] = useState(1);
  // effects on the two Pokémon that are out (yours, theirs); a side's are cleared when its Pokémon switches out
  const [vol, setVol] = useState<[Vol, Vol]>([{}, {}]);
  // Turns left of timed effects, counted down as the turn number goes up (see TIMED). Keys: 'weather', 'terrain', 'tr',
  // '<side>:<field flag>' (Tailwind, screens), 'v<side>:<effect>' (Taunt, Encore, Yawn).
  const [timers, setTimers] = useState<Record<string, number>>({});
  const patchVol = (side: 0 | 1, patch: Partial<Vol>) =>
    setVol((old) => {
      const next: [Vol, Vol] = [old[0], old[1]];
      next[side] = { ...old[side], ...patch, who: outNames[side] || old[side].who };
      // The first move since it came in (Protean / Libero take its type). A pick made while it is still on its first
      // turn out replaces it, so fixing a wrong tap works; after that it stays.
      if ('last_move' in patch) {
        next[side].last_move_turn = patch.last_move ? turn : undefined;
        const out = outFor.current;
        const name = side === 0 ? (mineActive ? baseName(mineActive) : '') : theirActive ? baseName(theirActive) : '';
        const firstTurn = out.names[side] !== name || out.n[side] === 0;
        if (patch.last_move && (firstTurn || !old[side].first_move)) next[side].first_move = patch.last_move;
        else if (!patch.last_move && firstTurn) next[side].first_move = undefined;
        // a two-turn move: tapped the turn it started, it is charging (and lands next turn); tapped again, it landed
        const m = patch.last_move;
        if (m && CHARGE_MOVES[m] && old[side].charging !== m) Object.assign(next[side], { charging: m, charge_turn: turn });
        else if (old[side].charging && (!m || old[side].charging === m || !CHARGE_MOVES[m])) Object.assign(next[side], { charging: undefined, charge_turn: undefined });
      }
      return next;
    });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [bring, setBring] = useState<BringCheck | null>(null);
  const [solved, setSolved] = useState<(SolveResult & { key: string }) | null>(null);
  const [advice, setAdvice] = useState<(Advice & { key: string }) | null>(null);
  // the last call to the bot: its board and turn, to tell a new turn from the same one
  // this game's turns go through Play turn: the turn number then only moves with it, never guessed from edits
  const playsTurns = useRef(false);
  const last = useRef<{ key: string; turnKey: string; hpKey: string; bring: string; turn: number; kind: 'solve' | 'replace'; at: number } | null>(null);
  // one id per game, sent with each question so the bot's log (runs/gui_log.jsonl) can tell games apart
  const gameId = useRef(new Date().toISOString());

  useEffect(() => {
    if (open) pingBot().then(setUp);
  }, [open]);
  // opening the panel brings it into view (it sits under the calc)
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) window.setTimeout(() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [open]);
  useEffect(() => save(MARKS_KEY, marks), [marks]);
  useEffect(() => save(AUTO_KEY, auto), [auto]);
  useEffect(() => save(SECS_KEY, secs), [secs]);

  // A new game: forget the last one's marks, results and turn count.
  const firstBattle = useRef(battleId);
  useEffect(() => {
    if (battleId === firstBattle.current) return;
    setMarks({});
    setTurnRaw(1);
    setNext('solve');
    setShowSetup(false);
    setLeadsDone(false);
    setPlayed(null);
    setSolved(null);
    setAdvice(null);
    setBring(null);
    setPicked(null);
    setError('');
    setLive(false);
    setVol([{}, {}]);
    setTimers({});
    outFor.current = { names: ['', ''], n: [0, 0] };
    last.current = null;
    playsTurns.current = false;
    gameId.current = new Date().toISOString();
  }, [battleId]);

  const setTurn = (n: number) => {
    setTurnRaw(Math.max(1, Math.min(60, n)));
    last.current = null; // you set it yourself: don't count on from the last call
  };

  const mineAll = teams[0].sets.filter((s) => s.species);
  const theirs = teams[1].sets.filter((s) => s.species);
  const defaultBrought = useMemo(() => {
    const kept = mineAll.filter((s) => !skipped.includes(s.species));
    return (kept.length === 3 ? kept : mineAll.slice(0, 3)).map(baseName);
  }, [mineAll, skipped]);
  const brought = picked ?? defaultBrought;
  const mine = brought.map((n) => mineAll.find((s) => baseName(s) === n)).filter((s): s is PokemonSet => !!s);
  const mineActive = teams[0].sets[teams[0].active];
  const theirActive = teams[1].sets[teams[1].active];
  // A Pokémon that switches out loses its effects, and frees the other side from its trap.
  const outNames = [mineActive ? baseName(mineActive) : '', theirActive ? baseName(theirActive) : ''];
  const prevItems = useRef<Record<string, string>>({});
  const itemsSig = teams[1].sets.map((s) => `${s.species}@${s.item}`).join('|');
  useEffect(() => {
    const before = prevItems.current;
    prevItems.current = Object.fromEntries(teams[1].sets.filter((s) => s.species).map((s) => [baseName(s), s.item]));
    if (!meta) return;
    const holders = new Map<string, PokemonSet[]>();
    for (const s of teams[1].sets) if (s.species && s.item) holders.set(s.item, [...(holders.get(s.item) ?? []), s]);
    for (const [item, list] of holders) {
      if (list.length < 2) continue;
      // keep the one that just got this item (or one whose item has been seen); move the others
      const keep = list.find((s) => before[baseName(s)] !== item) ?? list.find((s) => mark(1, s).item) ?? list[0];
      for (const s of list) {
        if (s === keep || mark(1, s).item) continue;
        const d = metaFor(meta, baseName(s))?.data.single;
        const used = new Set(teams[1].sets.map((x) => x.item));
        const next = d?.items.find((i) => !used.has(i.name))?.name;
        if (next) patchSet(1, s, { item: next });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSig, meta]);
  // a played turn sets everything itself: the reactions to a switch / a new turn are skipped once
  // the names out right after a played turn / undo: that one change keeps the effects it set; any later switch resets
  const skipVolReset = useRef<string | null>(null);
  const pendingTimers = useRef<((old: Record<string, number>) => Record<string, number>) | null>(null);
  const playedTurn = useRef<number | null>(null);
  const prevOut = useRef(outNames);
  useEffect(() => {
    const [a, b] = prevOut.current;
    prevOut.current = outNames;
    const changed = [a !== outNames[0], b !== outNames[1]];
    if (!changed[0] && !changed[1]) return;
    const skip = skipVolReset.current;
    skipVolReset.current = null;
    if (skip !== null && skip === outNames.join('|')) return; // a played turn: the engine already did all of this
    // weather / terrain abilities of the ones that just came in (both at once: the slower one's lands last and stays)
    const entering = ([0, 1] as const)
      .filter((sd) => changed[sd])
      .map((sd) => (sd === 0 ? mineActive : theirActive))
      // a Mega Stone holder that has not Mega Evolved has its normal ability (the set lists the Mega's, e.g. Drought)
      .filter((x): x is PokemonSet => !!x?.species && baseName(x) === x.species && !!ON_ENTRY[x.ability] && !/ite( [XYZ])?$/.test(x.item))
      .map((x) => ({ fx: ON_ENTRY[x.ability], spe: calcStats(x.species, x.nature, x.sp)?.spe ?? 0 }))
      .sort((a, b) => b.spe - a.spe);
    if (entering.length)
      setField((f) => {
        let g = f;
        for (const e of entering) g = { ...g, ...(e.fx.weather ? { weather: e.fx.weather as FieldState['weather'] } : {}), ...(e.fx.terrain ? { terrain: e.fx.terrain as FieldState['terrain'] } : {}) };
        return g;
      });
    setVol((old) => {
      const next: [Vol, Vol] = [old[0], old[1]];
      for (const sd of [0, 1] as const) {
        if (changed[sd]) next[sd] = {};
        else if (changed[1 - sd]) next[sd] = { ...old[sd], bound: false, trapped: false };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outNames[0], outNames[1]]);

  const mark = (side: 0 | 1, s: PokemonSet): Marks => marks[`${side}:${baseName(s)}`] ?? blankMarks();
  const setMark = (side: 0 | 1, s: PokemonSet, patch: Partial<Marks>) =>
    setMarks((old) => {
      const k = `${side}:${baseName(s)}`;
      return { ...old, [k]: { ...(old[k] ?? blankMarks()), ...patch } };
    });
  const toggleBrought = (name: string) =>
    setPicked((old) => {
      const cur = old ?? defaultBrought;
      return cur.includes(name) ? cur.filter((n) => n !== name) : cur.length >= 3 ? cur : [...cur, name];
    });

  // The game is under way once you tap who is out or ask for a turn. Until then (team preview, entering their six, looking
  // at calcs) selecting a Pokémon proves nothing, so auto-solve waits and nothing is marked as having appeared.
  const [live, setLive] = useState(false);
  /** Once one of theirs has been out, it has appeared for the rest of the game (even back at full HP on the bench). */
  const markAppeared = (s: PokemonSet | undefined) => {
    if (!s?.species) return;
    const k = `1:${baseName(s)}`;
    setMarks((old) => (old[k]?.seen ? old : { ...old, [k]: { ...(old[k] ?? blankMarks()), seen: true } }));
  };

  /** Make this Pokémon the one that is out. */
  /** Change one Pokémon's battle state (side 0 yours, 1 theirs): V-Calc's own HP, status and stat stages. */
  const patchSet = (side: 0 | 1, s: PokemonSet, patch: Partial<PokemonSet>) =>
    setTeams((old) => {
      const next: [Team, Team] = [old[0], old[1]];
      next[side] = { ...old[side], sets: old[side].sets.map((x) => (x === s ? { ...x, ...patch } : x)) };
      return next;
    });
  const sendOut = (side: 0 | 1, s: PokemonSet) => {
    // a replacement after a faint: through the engine, so Stealth Rock, Spikes, Intimidate and the like apply
    const out = side === 0 ? mineActive : theirActive;
    if (out && out.species && baseName(out) !== baseName(s) && mark(side, out).ko && rawBoard && ready) {
      doSendIn(side, s);
      return;
    }
    setLive(true);
    if (side === 1) markAppeared(s);
    setTeams((old) => {
      const i = old[side].sets.indexOf(s);
      if (i < 0 || i === old[side].active) return old;
      const next: [Team, Team] = [old[0], old[1]];
      next[side] = { ...old[side], active: i, partner: undefined };
      return next;
    });
  };

  const ready = up === true && singles;

  /** The battle as the bot sees it, after checking that V-Calc has what it needs. Throws a plain-language reason. */
  // ---- timed effects: start when turned on (from here or the calc), count down with the turn number, end at 0 ----
  const timedNow = (): Record<string, string> => {
    const out: Record<string, string> = {};
    if (field.weather) out.weather = field.weather;
    if (field.terrain) out.terrain = field.terrain;
    if (field.isTrickRoom) out.tr = 'on';
    ([0, 1] as const).forEach((sd) => {
      const fs = sd === 0 ? field.attackerSide : field.defenderSide;
      for (const k of ['isTailwind', 'isReflect', 'isLightScreen', 'isAuroraVeil'] as const) if (fs[k]) out[`${sd}:${k}`] = 'on';
      if (vol[sd].taunt) out[`v${sd}:taunt`] = 'on';
      if (vol[sd].encore) out[`v${sd}:encore`] = vol[sd].encore!;
      if (vol[sd].yawn) out[`v${sd}:yawn`] = 'on';
    });
    return out;
  };
  const timed = timedNow();
  const timedSig = JSON.stringify(timed);
  const prevTimed = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevTimed.current;
    prevTimed.current = timed;
    setTimers((old) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(timed)) next[k] = prev[k] === v && old[k] !== undefined ? old[k] : timerStart(k);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedSig]);
  // the turn number went up: count down, and end what ran out (a drowsy Pokemon falls asleep)
  const prevTurn = useRef(turn);
  useEffect(() => {
    const d = turn - prevTurn.current;
    prevTurn.current = turn;
    if (!d) return;
    if (pendingTimers.current) {
      const f = pendingTimers.current;
      pendingTimers.current = null;
      setTimers(f);
      return;
    }
    const ended = d > 0 ? Object.keys(timers).filter((k) => timers[k] - d <= 0) : [];
    setTimers((old) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(old)) if (!ended.includes(k)) next[k] = Math.max(1, v - d);
      return next;
    });
    window.setTimeout(() => {
      if (!ended.length) return;
      setField((f) => {
        const g = { ...f, attackerSide: { ...f.attackerSide }, defenderSide: { ...f.defenderSide } };
        for (const k of ended) {
          if (k === 'weather') g.weather = '';
          else if (k === 'terrain') g.terrain = '';
          else if (k === 'tr') g.isTrickRoom = false;
          else if (/^[01]:/.test(k)) {
            const [sd, flag] = k.split(':');
            (sd === '0' ? g.attackerSide : g.defenderSide)[flag as 'isTailwind'] = false;
          }
        }
        return g;
      });
      for (const k of ended) {
        const m = /^v([01]):(\w+)$/.exec(k);
        if (!m) continue;
        const sd = +m[1] as 0 | 1;
        patchVol(sd, { [m[2]]: undefined });
        const out = sd === 0 ? mineActive : theirActive;
        if (m[2] === 'yawn' && out && !out.status) patchSet(sd, out, { status: 'slp' });
      }
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);
  /** Tap a timer: one turn less (wraps from 1 to 8, for Light Clay, Damp Rock and the like). */
  const tapTimer = (k: string) => setTimers((old) => (old[k] === undefined ? old : { ...old, [k]: old[k] <= 1 ? 8 : old[k] - 1 }));
  /** Turns left as the bot reads them, `ahead` turns from now. */
  // read when a solve actually runs (auto-solve is scheduled a moment earlier, possibly before a new timer exists)
  const timersNow = useRef(timers);
  timersNow.current = timers;
  const turnsFor = (ahead: number) => {
    const t = (k: string) => Math.max(0, (timersNow.current[k] ?? 0) - ahead);
    const pair = (k: string) => [t(`0:${k}`), t(`1:${k}`)];
    return {
      field: { weather: t('weather'), terrain: t('terrain'), trick_room: t('tr'), tailwind: pair('isTailwind'), reflect: pair('isReflect'), light_screen: pair('isLightScreen'), aurora_veil: pair('isAuroraVeil') },
      vol: [0, 1].map((sd) => ({ taunt_turns: t(`v${sd}:taunt`), encore_turns: t(`v${sd}:encore`) })),
    };
  };
  /** The board as sent: with turns left of timed effects (kept out of `key`, so counting down does not re-solve). */
  // How long each Pokémon that is out has been out, counted at each solve: the same one as at the last solve gets the
  // turns that went by since then (by turn number, so turns fixed with - / + count too); a new one starts at 0 (First
  // Impression and Fake Out only work then; a Choice Scarf locks after).
  const outFor = useRef<{ names: [string, string]; n: [number, number]; turn?: number }>({ names: ['', ''], n: [0, 0] });
  const countOut = (tNow: number): [number, number] => {
    const names: [string, string] = [mineActive ? baseName(mineActive) : '', theirActive ? baseName(theirActive) : ''];
    const o = outFor.current;
    const passed = o.turn === undefined ? 0 : Math.max(0, tNow - o.turn);
    const n: [number, number] = [0, 1].map((sd) => (o.names[sd] === names[sd] ? o.n[sd] + passed : 0)) as [number, number];
    outFor.current = { names, n, turn: tNow };
    return n;
  };
  // a Pokémon with a last move has acted since it came in (the effects are cleared when it switches): not its first turn
  const outAtLeast = (n: number, v: Vol) => Math.max(n, v.last_move ? 1 : 0);
  /** A charge started on turn N matters for turn N+1 only (it lands then). */
  const chargeNow = <V extends Vol & { turns_out?: number }>(v: V, ahead: number): V => {
    const { charge_turn, ...rest } = v;
    if (!v.charging) return rest as V;
    return (charge_turn !== undefined && turn + ahead === charge_turn + 1 ? rest : { ...rest, charging: undefined }) as V;
  };
  const withTimers = <B extends NonNullable<typeof board>>(b: B, ahead: number, out: [number, number] = [0, 0]) => {
    const tt = turnsFor(ahead);
    return {
      ...b,
      field: { ...b.field, turns: tt.field },
      me: { ...b.me, volatile: chargeNow({ ...b.me.volatile, ...tt.vol[0], turns_out: outAtLeast(out[0], b.me.volatile ?? {}) }, ahead) },
      opp: b.opp.map((o) => (o.active ? { ...o, volatile: chargeNow({ ...o.volatile, ...tt.vol[1], turns_out: outAtLeast(out[1], o.volatile ?? {}) }, ahead) } : o)),
    };
  };

  const position = (allowTheirKo = false) => {
    if (mine.length !== 3) throw new Error('Tick the three Pokémon you brought (Setup, below).');
    if (!mineActive || !mine.some((s) => baseName(s) === baseName(mineActive))) throw new Error('Pick which of your three is out.');
    if (!theirActive) throw new Error("Add the opposing Pokémon that is out and pick it.");
    // both fainted (double KO): you pick blind, so the bot solves that guess; otherwise theirs must be replaced first
    if (!allowTheirKo && mark(1, theirActive).ko && !mark(0, mineActive).ko) throw new Error('Their Pokémon is marked fainted: pick the one they sent out.');
    return buildPosition({ mine, mineActive: baseName(mineActive), theirs, theirActive: baseName(theirActive), marks, field, turn, vol });
  };
  let board: ReturnType<typeof buildPosition> | null = null;
  let boardProblem = '';
  try {
    board = position();
  } catch (e) {
    boardProblem = e instanceof Error ? e.message : String(e);
  }
  // the board as it is, a fainted Pokémon still out included (for sending in its replacement through the engine)
  let rawBoard: ReturnType<typeof buildPosition> | null = board;
  if (!rawBoard)
    try {
      rawBoard = position(true);
    } catch {
      rawBoard = null;
    }
  const theirKo = !!theirActive && mark(1, theirActive).ko;
  const myKo = !!mineActive && mark(0, mineActive).ko;
  const coreKey = board
    ? JSON.stringify({ ...board, turn: 0, opp: board.opp.map(({ seen: _s, hits: _h, ...o }) => o) }) + (myKo ? '|replace' : '')
    : '';
  // the board without the turn number: a change here means something happened
  const key = board ? JSON.stringify({ ...board, turn: 0 }) + (myKo ? '|replace' : '') : '';
  // Only what a turn changes: who is out, HP, status, boosts, the field, and the moves used and their effects (a turn of
  // Yawn into Dive, Protect or Taunt changes nothing else). Revealed moves, items and Mega marks are facts you learn,
  // not a turn going by.
  const hpKey = board ? JSON.stringify([board.me.active, board.me.hp, board.me.status, board.opp.map((o) => [o.species, o.hp, o.status, o.active])]) : '';
  const turnKey = board
    ? JSON.stringify({
        me: [board.me.active, board.me.hp, board.me.status, board.me.boosts],
        opp: board.opp.map((o) => [o.species, o.hp, o.status, o.boosts, o.active]),
        field: board.field,
        vol,
      })
    : '';

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  // ---- Play turn: both sides' choices run through the engine, the board fills itself in ----
  const [playChoice, setPlayChoice] = useState<[string, string]>(['', '']);
  // Spread reading: the last played turn's hits (engine's average roll), turned into measured hits once you have set the
  // HP the game showed (at the next Solve / Play), then the likely builds of their Pokémon
  const pendingHits = useRef<{ hits: PlayHit[]; me: Record<string, number>; opp: Record<string, number> } | null>(null);
  const [likely, setLikely] = useState<LikelySets>({});
  const finalizeHits = () => {
    const p = pendingHits.current;
    pendingHits.current = null;
    if (!p || !p.hits.length) return;
    const toObj = (a: number[]) => ({ atk: a[0], def: a[1], spa: a[2], spd: a[3], spe: a[4] });
    // one hit on a Pokémon in the turn: its HP change is that hit's (two would be ambiguous)
    const per: Record<string, number> = {};
    for (const h of p.hits) per[h.attacker + h.mine + h.theirs] = (per[h.attacker + h.mine + h.theirs] ?? 0) + 1;
    const add: Record<string, SeenHit[]> = {};
    for (const h of p.hits) {
      if (h.hits !== 1 || per[h.attacker + h.mine + h.theirs] !== 1) continue;
      const base = {
        move: h.move, other: h.mine, crit: h.crit, opp_boosts: toObj(h.opp_boosts), my_boosts: toObj(h.my_boosts), opp_status: h.opp_status,
        my_status: h.my_status, opp_mega: h.opp_mega, my_mega: h.my_mega, weather: h.weather, terrain: h.terrain, def_screens: h.def_screens,
      };
      if (h.attacker === 'opp') {
        const s = mine.find((x) => baseName(x) === h.mine);
        const max = s ? maxHpOf(s) : undefined;
        if (!s || !max || p.me[h.mine] === undefined) continue;
        const ko = mark(0, s).ko;
        const cur = ko ? 0 : Math.round((max * s.hpPercent) / 100);
        const dmg = ko ? h.before : h.dmg + (p.me[h.mine] - cur); // the engine's number, moved by your correction
        if (dmg <= 0) continue;
        (add[h.theirs] ??= []).push({ ...base, dealt_by_opp: true, dmg, my_hp_before: h.before, ko });
      } else {
        const s = teams[1].sets.find((x) => x.species && baseName(x) === h.theirs);
        if (!s || p.opp[h.theirs] === undefined) continue;
        const ko = mark(1, s).ko;
        const cur = ko ? 0 : s.hpPercent;
        const from = (100 * h.before) / h.max_hp;
        const to = ko ? 0 : Math.max(0, (100 * (h.before - h.dmg)) / h.max_hp + (cur - p.opp[h.theirs]));
        if (from - to <= 0) continue;
        (add[h.theirs] ??= []).push({ ...base, dealt_by_opp: false, pct_from: from, pct_to: to, ko });
      }
    }
    if (!Object.keys(add).length) return;
    setMarks((old) => {
      const out = { ...old };
      for (const [sp, hs] of Object.entries(add)) {
        const k = `1:${sp}`;
        const cur = out[k] ?? blankMarks();
        out[k] = { ...cur, hits: [...(cur.hits ?? []), ...hs] };
      }
      return out;
    });
  };
  // which button is next, highlighted: ask the bot, then play the turn, then ask again...
  const [next, setNext] = useState<'solve' | 'play' | 'sendin'>('solve');
  const [showSetup, setShowSetup] = useState(false);
  // what happened that luck decides: [yours, theirs]
  const [outcome, setOutcome] = useState<[Outcome, Outcome]>([{}, {}]);
  const toggleOutcome = (sd: 0 | 1, k: keyof Outcome) =>
    setOutcome((o) => {
      const n: [Outcome, Outcome] = [{ ...o[0] }, { ...o[1] }];
      n[sd][k] = !n[sd][k];
      if (k === 'first' && n[sd].first) n[(1 - sd) as 0 | 1].first = false; // only one side can go first
      return n;
    });
  const [needPivot, setNeedPivot] = useState<{ side: 'me' | 'opp'; options: string[]; chosen: Record<string, string>; kind?: 'revive' } | null>(null);
  type Snapshot = { teams: [Team, Team]; field: FieldState; vol: [Vol, Vol]; marks: Record<string, Marks>; turn: number; timers: Record<string, number> };
  // Report: one tap saves the board, the last answer and the last played turn for fixing later
  const [reported, setReported] = useState('');
  const doReport = () => {
    if (!board) return;
    const pos = { ...withTimers(board, 0, outFor.current.n), turn, game: gameId.current };
    sendReport(mineAll, pos, { solved, played: played ? { turn: played.turn, events: played.events } : null, warnings: botWarn, error, opp_sets: teams[1].sets })
      .then(() => setReported('Saved'))
      .catch((e) => setReported('Could not save: ' + (e instanceof Error ? e.message : String(e))));
    window.setTimeout(() => setReported(''), 2500);
  };
  // what the bot left out of the last answer because it did not understand it (it answers anyway)
  const [botWarn, setBotWarn] = useState<string[]>([]);
  const [played, setPlayed] = useState<{ turn: number; events: string[]; undo: Snapshot; sent?: boolean; leads?: boolean } | null>(null);
  // turn 1: the leads' entry abilities (Intimidate, weather, terrain...) run through the engine once both leads are out
  const [leadsDone, setLeadsDone] = useState(false);
  const strip = (a: string) => a.replace(/ -> .*$/, '');
  const freshSolve = solved && solved.key === coreKey ? solved : null;
  const playOpts: [string[], string[]] = (() => {
    const myOpts: string[] = [];
    const add = (arr: string[], x: string) => {
      if (x && !arr.includes(x)) arr.push(x);
    };
    for (const r of freshSolve?.mine ?? []) add(myOpts, strip(r.action));
    if (mineActive) for (const m of mineActive.moves) add(myOpts, m);
    for (const s of mine) if (mineActive && baseName(s) !== baseName(mineActive) && !mark(0, s).ko) add(myOpts, 'Switch to ' + baseName(s));
    const theirOpts: string[] = [];
    for (const r of freshSolve?.theirs ?? []) if (r.their_action !== 'Switch out') add(theirOpts, r.their_action);
    if (theirActive) for (const m of theirActive.moves) add(theirOpts, m);
    // their Mega Evolution: a Mega form or Mega Stone in their set, not evolved yet, and no Mega used by their team
    const theirMega =
      !!theirActive &&
      !mark(1, theirActive).mega &&
      !teams[1].sets.some((s) => s.species && mark(1, s).mega) &&
      (baseName(theirActive) !== theirActive.species || /ite( [XYZ])?$/.test(theirActive.item));
    if (theirActive && theirMega) for (const m of theirActive.moves) if (m) add(theirOpts, `${m} + Mega Evolve`);
    for (const s of teams[1].sets) if (theirActive && s.species && baseName(s) !== baseName(theirActive) && !mark(1, s).ko) add(theirOpts, 'Switch to ' + baseName(s));
    return [myOpts, theirOpts];
  })();
  // their top move, with Mega Evolution when the bot expects it
  const theirTop = freshSolve && [...freshSolve.theirs].sort((a, b) => b.prob - a.prob).find((t) => t.their_action !== 'Switch out');
  const theirTopLabel = theirTop && (theirTop.mega ?? 0) >= 0.5 && playOpts[1].includes(`${theirTop.their_action} + Mega Evolve`) ? `${theirTop.their_action} + Mega Evolve` : theirTop?.their_action;
  const defaultPlay: [string, string] = [
    (freshSolve && strip([...freshSolve.mine].sort((a, b) => b.mix - a.mix)[0]?.action ?? '')) || playOpts[0][0] || '',
    theirTopLabel || playOpts[1][0] || '',
  ];
  // a new board to choose for: back to the bot's suggestions
  useEffect(() => setPlayChoice(['', '']), [solved?.key]);

  /** advance: a played turn moves the turn number on; a replacement sent in between turns does not. */
  const applyPlay = (r: PlayResult, snap: Snapshot, advance = true) => {
    const t0 = turn;
    const sides = [r.me, r.opp] as const;
    // their moves as V-Calc keeps them: a move they showed that the set lacks takes the place of one not seen yet
    const theirMoves = new Map<PokemonSet, string[]>();
    for (const s of teams[1].sets) {
      const m = s.species ? r.opp.mons[baseName(s)] : undefined;
      if (!m) continue;
      const moves = [...s.moves];
      const seen = [...mark(1, s).moves];
      for (const mv of m.revealed_moves ?? []) {
        if (moves.includes(mv)) continue;
        const free = moves.findIndex((x, i) => !seen[i] && !(m.revealed_moves ?? []).includes(x));
        if (free >= 0) {
          moves[free] = mv;
          seen[free] = true;
        }
      }
      theirMoves.set(s, moves);
    }
    setTeams((old) => {
      const next: [Team, Team] = [old[0], old[1]];
      for (const sd of [0, 1] as const) {
        const ps = sides[sd];
        const sets = old[sd].sets.map((s) => {
          const m = s.species ? ps.mons[baseName(s)] : undefined;
          if (!m) return s;
          const patch: Partial<PokemonSet> = {
            hpPercent: m.fainted ? 1 : Math.max(1, m.hp_pct),
            status: (m.fainted ? '' : m.status) as PokemonSet['status'],
            boosts: m.active ? m.boosts : { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          };
          if (sd === 1 && theirMoves.has(s)) patch.moves = theirMoves.get(s);
          if (m.disguise_broken && s.ability === 'Disguise') patch.abilityOn = true; // V-Calc's "Disguise broken"
          if (sd === 1 && m.revealed_item) patch.item = m.revealed_item;
          if (sd === 1 && m.revealed_ability) patch.ability = m.revealed_ability;
          return { ...s, ...patch };
        });
        const ai = sets.findIndex((s) => s.species && baseName(s) === ps.active);
        next[sd] = { ...old[sd], sets, active: ai >= 0 ? ai : old[sd].active, partner: undefined };
      }
      return next;
    });
    setMarks((old) => {
      const out = { ...old };
      for (const sd of [0, 1] as const) {
        for (const s of teams[sd].sets) {
          if (!s.species) continue;
          const m = sides[sd].mons[baseName(s)];
          if (!m) continue;
          const k = `${sd}:${baseName(s)}`;
          const cur = out[k] ?? blankMarks();
          const moves = [...cur.moves];
          if (sd === 1)
            for (const mv of m.revealed_moves ?? []) {
              const i = (theirMoves.get(s) ?? s.moves).indexOf(mv);
              if (i >= 0) moves[i] = true;
            }
          out[k] = {
            ...cur,
            ko: m.fainted,
            mega: cur.mega || m.mega,
            gone: cur.gone || (!!s.item && m.item_gone && !m.mega),
            moves,
            item: cur.item || (sd === 1 && !!m.revealed_item),
            ability: cur.ability || (sd === 1 && !!m.revealed_ability),
            // PP left: yours all, theirs only of moves they were seen using
            pp: m.pp ? Object.fromEntries(Object.entries(m.pp).filter(([mv]) => sd === 0 || (m.revealed_moves ?? []).includes(mv))) : cur.pp,
            seen: sd === 1 ? cur.seen || m.active || m.fainted || m.hp_pct < 100 : cur.seen,
          };
        }
      }
      return out;
    });
    const f = r.field;
    const sideOf = (x: PlaySideFieldT, old: FieldState['attackerSide']) => ({
      ...old,
      isSR: x.stealth_rock,
      spikes: x.spikes,
      toxicSpikes: x.toxic_spikes,
      isTailwind: x.tailwind,
      isReflect: x.reflect,
      isLightScreen: x.light_screen,
      isAuroraVeil: x.aurora_veil,
      isSeeded: x.leech_seed,
      isBound: x.bound,
    });
    setField((old) => ({
      ...old,
      weather: f.weather as FieldState['weather'],
      terrain: f.terrain as FieldState['terrain'],
      isTrickRoom: f.trick_room,
      attackerSide: sideOf(f.sides[0], old.attackerSide),
      defenderSide: sideOf(f.sides[1], old.defenderSide),
    }));
    const volOf = (v: PlayResult['me']['vol']): Vol => ({
      yawn: v.yawn || undefined,
      taunt: v.taunt || undefined,
      encore: v.encore ?? undefined,
      substitute: v.substitute || undefined,
      trapped: v.trapped || undefined,
      confused: v.confused || undefined,
      last_move: v.last_move ?? undefined,
      last_move_turn: v.last_move ? t0 : undefined,
      first_move: v.first_move ?? undefined,
      charging: v.charging ?? undefined,
      charge_turn: v.charging ? t0 : undefined,
      disabled: v.disabled ?? undefined,
      transformed: v.transformed ?? undefined,
    });
    setVol([{ ...volOf(r.me.vol), who: r.me.active }, { ...volOf(r.opp.vol), who: r.opp.active }]);
    skipVolReset.current = `${r.me.active}|${r.opp.active}`;
    setNext('solve');
    if (!advance) {
      setPlayed({ turn: t0, events: r.events, undo: snap, sent: true });
      return;
    }
    // timers: the usual count-down, with what the engine knows (weather, terrain, Trick Room, Tailwind, screens) on top
    const tt = f.turns;
    pendingTimers.current = (old) => {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(old)) next[k] = Math.max(1, v - 1);
      const put = (k: string, n: number) => {
        if (n > 0 && next[k] !== undefined) next[k] = n;
      };
      put('weather', tt.weather);
      put('terrain', tt.terrain);
      put('tr', tt.trick_room);
      ([0, 1] as const).forEach((sd) => {
        put(`${sd}:isTailwind`, tt.tailwind[sd]);
        (['isReflect', 'isLightScreen', 'isAuroraVeil'] as const).forEach((k, i) => put(`${sd}:${k}`, tt.screens[sd][i]));
      });
      return next;
    };
    playedTurn.current = t0 + 1;
    playsTurns.current = true;
    setTurnRaw(t0 + 1);
    setPlayed({ turn: t0, events: r.events, undo: snap });
    pendingHits.current = {
      hits: r.hits ?? [],
      me: Object.fromEntries(Object.entries(r.me.mons).map(([k, m]) => [k, m.fainted ? 0 : m.hp])),
      opp: Object.fromEntries(Object.entries(r.opp.mons).map(([k, m]) => [k, m.fainted ? 0 : m.hp_pct])),
    };
    setPlayChoice(['', '']);
    setOutcome([{}, {}]);
  };
  type PlaySideFieldT = PlayResult['field']['sides'][0];
  /** Toggles for what luck decided this turn on one side: its move missed, it crit, it did not move. */
  const outcomeChips = (sd: 0 | 1) => (
    <span className="ai-outcome">
      {(
        [
          ['first', 'First', 'It moved first (a speed tie, or the bot has the speed wrong)'],
          ['miss', 'Missed', 'Its move missed'],
          ['crit', 'Crit', 'Its hit was a critical hit'],
          ['no_move', "Didn't move", 'Flinched, fully paralysed, asleep... it did not move this turn'],
        ] as [keyof Outcome, string, string][]
      ).map(([k, l, t]) => (
        <button key={k} className={'bv-tag' + (outcome[sd][k] ? ' on' : '')} title={t} onClick={() => toggleOutcome(sd, k)}>
          {l}
        </button>
      ))}
    </span>
  );

  const [playBusy, setPlayBusy] = useState(false);
  const runPlay = async (fn: () => Promise<void>) => {
    setPlayBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayBusy(false);
    }
  };
  const hitsSig = JSON.stringify(Object.fromEntries(Object.entries(marks).filter(([k, m]) => k.startsWith('1:') && m.hits?.length).map(([k, m]) => [k, m.hits!.length])));
  useEffect(() => {
    if (hitsSig === '{}' || !board) {
      setLikely({});
      return;
    }
    const pos = { ...withTimers(board, 0, outFor.current.n), turn, game: gameId.current };
    askLikelySets(mineAll, { ...pos, opp_sets: oppSetsJson(teams[1].sets) } as typeof pos)
      .then((r) => {
        setLikely(r);
        for (const [sp, l] of Object.entries(r)) {
          const b = l.builds[0];
          const s = teams[1].sets.find((x) => x.species && baseName(x) === sp);
          if (!b || !s || l.entered_fits !== false) continue;
          const spread = { hp: b.sp[0], atk: b.sp[1], def: b.sp[2], spa: b.sp[3], spd: b.sp[4], spe: b.sp[5] };
          const itemFree = b.item && !mark(1, s).item && !teams[1].sets.some((x) => x !== s && x.item === b.item);
          patchSet(1, s, { nature: b.nature, sp: spread, ...(itemFree ? { item: b.item } : {}) });
        }
      })
      .catch(() => setLikely({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitsSig]);
  const doPlay = (pivot: Record<string, string> = {}) =>
    runPlay(async () => {
      if (!board) throw new Error(boardProblem);
      finalizeHits();
      setLive(true);
      const mine = needPivot ? needPivot.chosen.__mine : playChoice[0] || defaultPlay[0];
      const theirs = needPivot ? needPivot.chosen.__theirs : playChoice[1] || defaultPlay[1];
      if (!mine || !theirs) throw new Error('Pick what both sides did.');
      const snap: Snapshot = { teams, field, vol, marks, turn, timers };
      const pos = { ...withTimers(board, 0, outFor.current.n), turn, game: gameId.current };
      const { __mine, __theirs, ...piv } = { __mine: '', __theirs: '', ...pivot };
      void __mine;
      void __theirs;
      const r = await askPlayTurn(mineAll, pos, mine, theirs, piv, teams[1].sets, { me: outcome[0], opp: outcome[1] });
      setBotWarn(r.warnings ?? []);
      if (r.need_pivot) {
        setNeedPivot({ side: r.need_pivot.side, options: r.need_pivot.options, kind: r.need_pivot.kind, chosen: { ...piv, __mine: mine, __theirs: theirs } });
        return;
      }
      setNeedPivot(null);
      applyPlay(r, snap);
    });
  const doSendIn = (side: 0 | 1, s: PokemonSet) =>
    runPlay(async () => {
      if (!rawBoard) throw new Error(boardProblem);
      setLive(true);
      if (side === 1) markAppeared(s);
      const snap: Snapshot = { teams, field, vol, marks, turn, timers };
      const pos = { ...withTimers(rawBoard, 0, outFor.current.n), turn, game: gameId.current };
      const r = await askSendIn(mineAll, pos, side === 0 ? 'me' : 'opp', baseName(s), teams[1].sets);
      setBotWarn(r.warnings ?? []);
      applyPlay(r, snap, false);
    });
  // after a played turn, the board you correct by hand is logged a few seconds after you stop (once per change)
  const loggedKey = useRef('');
  useEffect(() => {
    if (!played || played.sent || !board || !coreKey || loggedKey.current === coreKey) return;
    const t = window.setTimeout(() => {
      loggedKey.current = coreKey;
      const pos = { ...withTimers(board, 0, outFor.current.n), turn, game: gameId.current };
      logBoard(mineAll, pos).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreKey, played]);
  const noBoosts = (s?: PokemonSet) => !s || Object.values(s.boosts).every((v) => !v);
  const needLeads = turn === 1 && !leadsDone && !!rawBoard && !!mineActive?.species && !!theirActive?.species && !played && noBoosts(mineActive) && noBoosts(theirActive); // (weather alone is no sign: V-Calc sets it itself for Sand Stream, Drought...)
  const doLeads = () =>
    runPlay(async () => {
      if (!rawBoard) return;
      const snap: Snapshot = { teams, field, vol, marks, turn, timers };
      const pos = { ...withTimers(rawBoard, 0, outFor.current.n), turn, game: gameId.current };
      const r = await askLeads(mineAll, pos, teams[1].sets);
      setLeadsDone(true);
      if (!r.events.length) return; // no entry abilities: nothing to show
      applyPlay(r, snap, false);
      setPlayed({ turn, events: ['Leads come in:', ...r.events], undo: snap, sent: true, leads: true });
    });
  useEffect(() => {
    if (!open || !ready || !live || !needLeads || playBusy) return;
    const t = window.setTimeout(doLeads, 1500); // after you finish picking the leads
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, live, needLeads, mineActive?.species, theirActive?.species]);
  const undoPlay = () => {
    if (!played) return;
    if (played.leads) setLeadsDone(false);
    const s = played.undo;
    const nm = (t: Team) => (t.sets[t.active]?.species ? baseName(t.sets[t.active]) : '');
    skipVolReset.current = `${nm(s.teams[0])}|${nm(s.teams[1])}`;
    if (!played.sent) pendingTimers.current = () => s.timers; // a send-in did not move the turn on
    playedTurn.current = null;
    setTeams(() => s.teams);
    setField(() => s.field);
    setVol(s.vol);
    setMarks(s.marks);
    setTurnRaw(s.turn);
    setPlayed(null);
  };

  /** Ask the bot about the current board: the replacement if yours fainted, otherwise the turn as a guessing game. */
  const solveNow = () => {
    if (!board) {
      setError(boardProblem);
      return;
    }
    if (needLeads) {
      setLive(true);
      doLeads();
      return;
    }
    finalizeHits();
    setLive(true);
    markAppeared(theirActive);
    // The board changed since the last answer for this turn number: a turn has gone by. (A replacement after a faint
    // belongs to the turn that follows, so the turn after a replacement is not counted again.)
    // Not counted: edits soon after the last answer (you are still entering this turn: your HP, then theirs, then a
    // fix), a change of the three brought (setup), and changes that are only revealed info. A switch with no damage
    // still counts. The - / + buttons put it right if it still goes wrong.
    const now = Date.now();
    const bringKey = board.bring.join(',');
    let t = turn;
    const l = last.current;
    if (playedTurn.current === turn) playedTurn.current = null; // Play turn already counted this one
    // (turn 1: only damage, a status or a switch means a turn went by, not a stat stage or weather put right by hand)
    else if (!playsTurns.current && l && l.kind === 'solve' && l.turn === turn && l.turnKey !== turnKey && (turn > 1 || l.hpKey !== hpKey) && l.bring === bringKey && now - l.at > SAME_TURN_MS) t = turn + 1;
    if (t !== turn) setTurnRaw(t);
    const pos = { ...withTimers(board, t - turn, countOut(t)), turn: t, game: gameId.current };
    const kind = myKo ? 'replace' : 'solve';
    last.current = { key, turnKey, hpKey, bring: bringKey, turn: t, kind, at: now };
    const k = coreKey;
    if (kind === 'replace')
      return run('Picking your replacement…', async () => {
        const r = await askReplace(mineAll, pos);
        setBotWarn(r.warnings ?? []);
        setNext('sendin');
        setSolved(null);
        const dko = !!r.double_ko;
        setAdvice({
          key: k,
          title: dko ? 'Double KO: pick blind' : 'Best replacement',
          rows: r.replace.map((x) => ({
            sendIn: x.action.replace(/^Send in /, ''),
            label: dko && x.mix !== undefined && x.mix >= 0.05 ? `${x.action} (pick ${pct(x.mix)})` : x.action,
            v: x.win,
            n: x.games,
          })),
          note: !r.replace.length
            ? r.note
            : dko
              ? `You both pick at the same time. Their likely pick: ${(r.theirs ?? [])
                  .filter((t) => t.prob >= 0.05)
                  .map((t) => `${t.their_action.replace('Send in ', '')} ${pct(t.prob)}`)
                  .join(' · ')}. ` +
                r.replace.map((x) => `${x.action.replace('Send in ', '')}: worst ${pct(x.worst ?? x.win)}`).join(' · ')
              : 'Each replacement is played out from the new board.',
        });
      });
    return run(`Solving this turn (about ${secs} s)…`, async () => {
      const r = await askSolve(mineAll, pos, secs);
      setBotWarn(r.warnings ?? []);
      setAdvice(null);
      setSolved({ ...r, key: k });
      setNext('play');
    });
  };

  // Auto: re-solve shortly after the board stops changing.
  useEffect(() => {
    if (!open || !auto || !live || !ready || busy || !key || last.current?.key === key || needLeads) return;
    const t = window.setTimeout(solveNow, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, auto, live, ready, busy, key]);

  const doBring = () =>
    run(`Simulating every bring (about ${BRING_SECS} s)…`, async () => {
      if (theirs.length < 6) throw new Error(`Enter all six of the opponent's Pokémon first (${theirs.length} so far).`);
      if (mineAll.length < 6) throw new Error(`The bot picks 3 from your six; you have ${mineAll.length} entered.`);
      setBring(await askBringCheck(mineAll, theirs, BRING_SECS));
    });
  // Start the bring check by itself as soon as their six are in (team preview), so it is ready when you look; once per
  // pair of teams
  const bringSig = turn === 1 && theirs.length >= 6 && mineAll.length >= 6 ? [...mineAll, ...theirs].map((s) => baseName(s)).join(',') : '';
  const bringAsked = useRef('');
  useEffect(() => {
    if (!open || !ready || !bringSig || busy || bring || bringAsked.current === bringSig) return;
    const t = window.setTimeout(() => {
      bringAsked.current = bringSig;
      doBring();
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, bringSig, busy, bring]);

  const useBring = (o: { bring: string[] }) => {
    const idx = o.bring.map((n) => mineAll.findIndex((s) => baseName(s) === n)).filter((i) => i >= 0);
    onApplyBring(idx, [0]);
    setPicked(null);
  };

  /** The slower check: each option forced, then the rest of the game simulated (against a stay-in and a switch). */
  const doSimulate = () =>
    run('Simulating each option…', async () => {
      if (!board) throw new Error(boardProblem);
      if (myKo) return solveNow();
      const pos = { ...withTimers(board, 0, outFor.current.n), turn, game: gameId.current };
      const c = await askCheck(mineAll, pos);
      let quick = '';
      try {
        const q = await askQuick(mineAll, pos);
        const t = q.actions[0];
        if (t) quick = `${t.action} (${pct(t.p)} sure)`;
      } catch {
        /* the table is the answer; the quick read is optional */
      }
      setAdvice({ key, title: 'Each option simulated to the end', pSwitch: c.checked[0]?.p_switch, rows: c.checked.map((x: MoveCheck) => ({ label: x.action, v: x.win, stay: x.win_stay, sw: x.win_switch, net: x.win_net, heur: x.win_heur, ko: x.ko_now, n: x.games })), quick });
    });

  const newGame = () => {
    onResetBattle(); // resets HP, boosts, status and the field; battleId then clears the marks here
  };

  if (!open) return null;

  const seenChips = (s: PokemonSet) => {
    const m = mark(1, s);
    const chips: ReactNode[] = [];
    s.moves.forEach((mv, i) => {
      if (!mv) return;
      chips.push(
        <button key={'m' + i} className={'ai-toggle' + (m.moves[i] ? ' on' : '')} title="Tick moves you have seen it use" onClick={() => setMark(1, s, { moves: m.moves.map((x, j) => (j === i ? !x : x)) })}>
          {mv}
        </button>,
      );
    });
    if (s.item)
      chips.push(
        <button key="item" className={'ai-toggle' + (m.item ? ' on' : '')} title="You know it holds this item" onClick={() => setMark(1, s, { item: !m.item })}>
          {s.item}
        </button>,
      );
    if (s.ability)
      chips.push(
        <button key="ab" className={'ai-toggle' + (m.ability ? ' on' : '')} title="You know this is its ability" onClick={() => setMark(1, s, { ability: !m.ability })}>
          {s.ability}
        </button>,
      );
    return chips;
  };

  const resultStale = (k: string) => k !== coreKey;
  /** Options the bot left out of its pick that do almost as well (within CLOSE) against their likely play. (The options
   * inside a mixed pick always score the same against it: that is what makes it a mix.) */
  const closeCall = (r: SolveResult) => r.mine.filter((x) => x.mix < 0.05 && x.vs_their_play >= r.value - CLOSE);
  const headline = (r: SolveResult) => {
    const picks = r.mine.filter((x) => x.mix >= 0.05).sort((a, b) => b.mix - a.mix);
    if (!picks.length) return '';
    if (picks[0].mix >= 0.9) return picks[0].action;
    return picks.map((x) => `${x.action} ${pct(x.mix)}`).join(' · ');
  };
  const theirSeen = theirs.filter((s) => appeared(s, mark(1, s), !!theirActive && baseName(s) === baseName(theirActive)));

  return (
    <section className="ai-wide" aria-label="AI advice" ref={rootRef}>
      <header className="ai-dock-head">
        <h2>AI advice</h2>
        <label className="check ai-auto" title="Solve again by itself a moment after you change the board">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto
        </label>
        <span className="ai-turn" title="Turn number. It counts up by itself when the board changes after an answer.">
          Turn
          <button onClick={() => setTurn(turn - 1)} aria-label="Previous turn">
            −
          </button>
          <b>{turn}</b>
          <button onClick={() => setTurn(turn + 1)} aria-label="Next turn">
            +
          </button>
        </span>
        <select className="ai-secs" value={secs} onChange={(e) => setSecs(+e.target.value)} title="How long the bot may think per answer. Longer is a little sharper.">
          {[4, 8, 15, 30].map((v) => (
            <option key={v} value={v}>
              {v} s
            </option>
          ))}
        </select>
        <a className="ai-review" href={getBotUrl() + '/review'} target="_blank" rel="noreferrer" title="Your games turn by turn: the board, what the bot said, and how the win chance moved">
          Review
        </a>
        <button onClick={newGame} title="New game: resets HP, boosts, status, the field and the marks here (same as Reset battle)">
          New game
        </button>
        <button className="icon close" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </header>

      <div className="ai-body">
        {!singles && <p className="ai-warn">The bot plays Singles only. Switch V-Calc to Singles.</p>}
        {up === false && (
          <p className="ai-warn">
            The bot is not running. Double-click <b>start_gui.bat</b> in the ChampionsAI folder.
            <button onClick={() => pingBot().then(setUp)}>Check again</button>
          </p>
        )}

        <div className="ai-grid">
        <div className="ai-col">
        <section className="ai-board">
          <BattleView
            mine={mine}
            theirs={theirs}
            mineActive={mine.some((s) => mineActive && baseName(s) === baseName(mineActive)) ? mineActive : undefined}
            theirActive={theirActive?.species ? theirActive : undefined}
            mark={mark}
            setMark={setMark}
            isAppeared={(s) => appeared(s, mark(1, s), !!theirActive && baseName(s) === baseName(theirActive))}
            vol={vol}
            turn={turn}
            patchVol={patchVol}
            patchSet={patchSet}
            sendOut={sendOut}
            field={field}
            setField={setField}
            timers={timers}
            onTimer={tapTimer}
          />
          <p className="hint">
            Tap a team icon when it comes in, drag an HP bar (or type the number), tap the move it just used. Changes here are the calc's own HP,
            status, stats and field.
          </p>
        </section>
        </div>
        <div className="ai-col">

        <section className="ai-answer">
          {ready && board && !myKo && (
            <div className="ai-play grid">
              <span className="hint" title="Pick what both sides did, then Play: the turn runs with average luck (middle damage roll, no crits, chance effects only when likely) and the board updates itself. Fix what luck changed (HP, a crit, a burn) by hand.">
                Play turn
              </span>
              <div className="ai-play-side">
                <label>
                  You
                  <select value={playChoice[0] || defaultPlay[0]} onChange={(e) => setPlayChoice([e.target.value, playChoice[1]])}>
                    {playOpts[0].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                {outcomeChips(0)}
              </div>
              <div className="ai-play-side">
                <label>
                  They
                  <select value={playChoice[1] || defaultPlay[1]} onChange={(e) => setPlayChoice([playChoice[0], e.target.value])}>
                    {playOpts[1].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                {outcomeChips(1)}
              </div>
              <button className={'primary ai-main-btn' + (next === 'play' ? ' ai-next' : '')} onClick={() => doPlay()} disabled={playBusy}>
                {playBusy ? 'Playing…' : 'Play'}
              </button>
            </div>
          )}
          {needPivot && (
            <div className="ai-play">
              <span>
                {needPivot.kind === 'revive'
                  ? needPivot.side === 'me'
                    ? 'Revival Blessing: which of yours comes back?'
                    : 'Revival Blessing: which of theirs comes back?'
                  : needPivot.side === 'me'
                    ? 'Which of yours came in?'
                    : 'Which of theirs came in?'}
              </span>
              {needPivot.options.map((o) => (
                <button key={o} onClick={() => doPlay({ ...needPivot.chosen, [needPivot.side]: o })}>
                  {o}
                </button>
              ))}
              <button onClick={() => setNeedPivot(null)}>Cancel</button>
            </div>
          )}
          {played && (
            <details className="ai-played" open>
              <summary>
                {played.sent ? 'Sent in through the engine (hazards and entry abilities applied).' : `Turn ${played.turn} played with average luck: fix HP, crits or chance effects to match the game.`}{' '}
                <button className="link" onClick={undoPlay}>
                  Undo
                </button>
              </summary>
              <ul>
                {played.events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="ai-actions">
            <button className={'primary ai-main-btn' + (next === 'solve' ? ' ai-next' : '')} onClick={solveNow} disabled={!ready || !!busy}>
              {myKo ? 'Pick my replacement' : 'Solve this turn'}
            </button>
            <button className="ai-report" onClick={doReport} disabled={!board} title="Something looks wrong? Saves this board and what the bot said, to fix later">
              {reported || 'Report'}
            </button>
            {busy ? (
              <span className="hint">{busy}</span>
            ) : theirKo && !myKo && rawBoard ? (
              <span className="ai-theirsend">
                <span className="hint">They sent in:</span>
                {teams[1].sets
                  .filter((x) => x.species && !mark(1, x).ko && baseName(x) !== baseName(theirActive!))
                  .map((x, i) => (
                    <button key={baseName(x)} className={i === 0 ? 'ai-next' : ''} disabled={playBusy} onClick={() => doSendIn(1, x)} title="Sends it in through the engine: Stealth Rock, Spikes and entry abilities apply">
                      {baseName(x)}
                    </button>
                  ))}
              </span>
            ) : boardProblem ? (
              <span className="hint">{boardProblem}</span>
            ) : auto && !live ? (
              <span className="hint">Auto starts once you tap who is out or press Solve.</span>
            ) : null}
          </div>
          {error && <p className="err">{error}</p>}
          {botWarn.length > 0 && (
            <p className="ai-left" title="The bot answered without these; fix them in the calc if they matter">
              ⚠ Left out: {botWarn.join(' · ')}
            </p>
          )}

          {solved && (
            <div className={'ai-result' + (resultStale(solved.key) ? ' stale' : '')}>
              {resultStale(solved.key) && <p className="hint">For the board before your last change{auto ? '; updating…' : '.'}</p>}
              <div className="ai-do">
                <span className="hint">{solved.endgame ? `Endgame, worked out exactly · ` : ''}Do</span>
                <strong>{closeCall(solved).length ? `Close call: ${headline(solved)}` : headline(solved)}</strong>
                <span className="hint">win chance {pct(solved.value)}</span>
                {closeCall(solved).length > 0 && (
                  <span className="hint ai-close">
                    Almost as good (within {pct(CLOSE)}): {closeCall(solved).map((x) => x.action).join(', ')}. The simulation can't separate these, so go
                    with what you know about this player.
                  </span>
                )}
              </div>
              <div className="ai-colhead hint">
                <span />
                <span title="How often to pick this option. A mix means no single choice is best against a smart opponent.">Pick</span>
                <span title="Win chance against their likely play (below)">Vs them</span>
                <span title="Win chance if they make the best reply to this option">Worst</span>
              </div>
              {solved.mine.map((r, i) => (
                <div key={i} className={'ai-opt2' + (i === 0 ? ' top' : '')}>
                  <div className="ai-opt-main">{r.action}</div>
                  <span className="ai-pct">{r.mix >= 0.005 ? pct(r.mix) : '–'}</span>
                  <span className="ai-pct">{pct(r.vs_their_play)}</span>
                  <span className="ai-pct">{pct(r.worst)}</span>
                </div>
              ))}
              <p className="hint">
                <b>Their likely play:</b>{' '}
                {solved.theirs
                  .filter((c) => c.prob >= 0.05)
                  .slice(0, 4)
                  .map((c) => `${c.their_action}${megaNote(c.mega)} ${pct(c.prob)}`)
                  .join(' · ') || '–'}
              </p>
              <p className="hint">
                A split pick means both are fine against a smart player; against a weak one, take the higher <b>Vs them</b>. A high <b>Worst</b> means it is safe without guessing.
                {solved.cut_short ? ' The time limit cut the search short, so treat close numbers as ties.' : ''}
              </p>
            </div>
          )}

          {advice && (
            <div className={'ai-result' + (resultStale(advice.key) ? ' stale' : '')}>
              <h4>{advice.title}</h4>
              {advice.rows.some((r) => r.stay !== undefined) && (
                <div className="ai-colhead hint">
                  <span />
                  <span title="Win rate if the opponent stays in and attacks this turn">Stay</span>
                  <span title="Win rate if the opponent switches out this turn">Switch</span>
                  <span title="Win rate against the simulated opponent's own mix">Mix</span>
                </div>
              )}
              {advice.rows.map((r, i) => (
                <div key={i} className={'ai-opt2' + (i === 0 ? ' top' : '')}>
                  <div className="ai-opt-main">
                    {r.label}
                    {r.sendIn && (
                      <button className={'ai-sendin' + (next === 'sendin' && i === 0 ? ' ai-next' : '')} disabled={playBusy} onClick={() => { const s = mine.find((x) => baseName(x) === r.sendIn); if (s) doSendIn(0, s); }}>
                        Send in
                      </button>
                    )}
                    {r.ko !== undefined && r.ko >= 0.5 && <span className="ai-tag ko">KO {pct(r.ko)}</span>}
                  </div>
                  <span className="ai-pct">{r.stay !== undefined ? pct(r.stay) : ''}</span>
                  <span className="ai-pct">{r.sw !== undefined ? pct(r.sw) : ''}</span>
                  <span className="ai-pct">{pct(r.v)}</span>
                </div>
              ))}
              {advice.note && <p className="hint">{advice.note}</p>}
              {advice.quick && <p className="hint">Quick read: {advice.quick}.</p>}
              {advice.pSwitch !== undefined && <p className="hint">The simulated opponent switched {pct(advice.pSwitch)} of the time here.</p>}
            </div>
          )}
          {!myKo && (
            <p className="hint">
              <button className="linklike" onClick={doSimulate} disabled={!ready || !!busy}>
                Second opinion: simulate each option to the end
              </button>{' '}
              (slower; shows the win rate if they stay in or switch)
            </p>
          )}
        </section>
        {Object.keys(likely).length > 0 && (
          <section className="ai-reads">
            <h3>Spread reads</h3>
            {theirSeen
              .filter((s) => likely[baseName(s)]?.builds[0])
              .map((s) => {
                const l = likely[baseName(s)];
                const b = l.builds[0];
                return (
                  <div key={'l' + baseName(s)} className="ai-likely" title={l.builds.map((x) => `${x.nature} ${x.sp.join('/')}${x.item ? ' @ ' + x.item : ''}: ${pct(x.share)}`).join('\n')}>
                    <Sprite species={s.species} size={24} />
                    <span>
                      <b>{baseName(s)}</b> ({l.hits} hit{l.hits === 1 ? '' : 's'}): {b.nature} {b.sp.join('/')}
                      {b.item ? ` @ ${b.item}` : ''} · {pct(b.share)}
                      {l.entered_fits === false ? <span className="ai-auto"> · set changed to fit the hits</span> : null}
                    </span>
                  </div>
                );
              })}
          </section>
        )}
        {theirSeen.length > 0 && (
          <details className="ai-theirsets">
            <summary>Their sets: what you've seen</summary>
            <p className="hint">Ticked by Play turn as moves, items and abilities show; unticked ones are guessed from usage data.</p>
            {theirSeen.map((s) => (
              <div key={'s' + baseName(s)} className="ai-seenrow">
                <Sprite species={s.species} size={26} />
                <div className="ai-seen">{seenChips(s)}</div>
              </div>
            ))}
          </details>
        )}
        {turn > 1 && !showSetup ? (
          <button className="link ai-setup-link" onClick={() => setShowSetup(true)} title="Team preview, what to bring, the three you brought">
            Team setup…
          </button>
        ) : (
        <details className="ai-setup" open={turn === 1 && !solved && !advice}>
          <summary>Team preview and setup</summary>
          <h4>What should I bring?</h4>
          <p className="hint">Uses your six and their six as entered in the calc.</p>
          <button onClick={doBring} disabled={!ready || !!busy}>
            What should I bring?
          </button>
          {bring && (
            <div className="ai-result">
              {bring.options
                .filter((o, i) => i < 4 || o.rank > 8)
                .map((o, i) => (
                  <div key={i} className={'ai-bring' + (i === 0 ? ' top' : '') + (o.rank > 8 ? ' ai-guess' : '')}>
                    <div className="ai-opt-main">
                      {o.rank > 8 && (
                        <div className="hint">For comparison, the bot's old instant guess (not simulated). Simulated, it ranks #{o.rank} of 60:</div>
                      )}
                      <strong>Lead {o.lead}</strong>
                      <span className="hint"> + {o.bring.filter((n) => n !== o.lead).join(', ')}</span>
                      {o.worst != null && o.worst_vs && (
                        <div className={'hint' + (o.worst < 0.35 ? ' ai-bad' : '')}>
                          Worst: {pct(o.worst)} if they bring {o.worst_vs.join(', ')}
                        </div>
                      )}
                    </div>
                    <Bar v={o.win} />
                    <span className="ai-pct">{pct(o.win)}</span>
                    <button onClick={() => useBring(o)} title="Put these first in your team, select the lead, and mark the rest as not brought">
                      Use this
                    </button>
                  </div>
                ))}
              <p className="hint">
                Win chance from {bring.games.toLocaleString()} simulated games against what they are likely to bring
                {bring.their_likely[0] ? ` (most likely: ${bring.their_likely[0].lead} lead with ${bring.their_likely[0].bring.slice(1).join(' + ')})` : ''}, mixed with
                any other bring so a surprise is covered.
              </p>
            </div>
          )}
          <h4>The three you brought ({brought.length}/3)</h4>
          <div className="ai-flags">
            {mineAll.map((s) => {
              const name = baseName(s);
              return (
                <label key={'b' + name} className="check">
                  <input type="checkbox" checked={brought.includes(name)} onChange={() => toggleBrought(name)} />
                  {name}
                </label>
              );
            })}
          </div>
          <h4>Opposing Pokémon that have appeared</h4>
          <p className="hint">Ticked by itself when one comes in. They bring three of six, so the rest are treated as possible picks.</p>
          <div className="ai-flags">
            {theirs.map((s) => {
              const name = baseName(s);
              return (
                <label key={'a' + name} className="check">
                  <input type="checkbox" checked={appeared(s, mark(1, s), !!theirActive && name === baseName(theirActive))} onChange={(e) => setMark(1, s, { seen: e.target.checked })} />
                  {name}
                </label>
              );
            })}
          </div>
        </details>
        )}
        </div>
        </div>
      </div>
    </section>
  );
}
