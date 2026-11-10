import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldState } from '../lib/calc';
import {
  askBringCheck,
  askDoublesBring,
  askDoublesTurn,
  askDoublesOptions,
  askDoublesPlay,
  askDoublesLeads,
  askDoublesSendIn,
  sendDoublesReport,
  type DoublesBring,
  type DoublesTurn,
  type DoublesOptions,
  type DoublesPlay,
  type DoublesHit,
  type DoublesTurns,
  type DoublesPlayMonT,
  type SeenHit,
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
import { calcStats, moveInfo, type PokemonSet } from '../lib/model';
import { metaFor, type Meta } from '../lib/data';
import { megaFor } from '../lib/showdown';

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
/** A two-turn line, said plainly: "Yawn -> Switch to Golisopod" is "Yawn now, then next turn Switch to Golisopod". */
const lineLabel = (a: string) => (a.includes(' -> ') ? a.replace(' -> ', ' now, then next turn ') : a);
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
const D_AUTO_KEY = 'champions-calc:ai-doubles-auto:v1';

/** Illusion copies the last Pokémon picked at team preview: the pick order to follow. */
const zoroarkNote = (as: string) =>
  as ? `Pick in this order: ${as} last, so Zoroark comes in looking like ${as}.` : 'Pick in this order: Zoroark last (it then looks like the Pokémon it switches in for).'

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
  // doubles: effects per Pokémon ('0:Raichu'), since two are out a side
  const [dVolMap, setDVolMap] = useState<Record<string, Vol>>({});
  const patchVol = (side: 0 | 1, patch: Partial<Vol>) =>
    !singles && patch.who
      ? setDVolMap((o) => {
          const k = `${side}:${patch.who}`;
          const next = { ...(o[k] ?? {}), ...patch };
          if ('last_move' in patch) next.last_move_turn = patch.last_move ? turn : undefined;
          return { ...o, [k]: next };
        })
      : setVol((old) => {
      const next: [Vol, Vol] = [old[0], old[1]];
      // the Pokémon it is for: the one tapped (doubles has two a side), else the one out
      next[side] = { ...old[side], ...patch, who: patch.who || outNames[side] || old[side].who };
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
  const [dbring, setDBring] = useState<(DoublesBring & { sig: string }) | null>(null);
  // doubles uses the same turn counter as singles (the header's)
  const dTurn = turn;
  const setDTurn = (f: number | ((t: number) => number)) => setTurnRaw((t) => Math.max(1, Math.min(60, typeof f === 'function' ? f(t) : f)));
  const [dTurnRes, setDTurnRes] = useState<DoublesTurn | null>(null);
  const [dOpts, setDOpts] = useState<DoublesOptions | null>(null);
  const [dPick, setDPick] = useState<{ me: number[]; opp: number[] } | null>(null);
  const [dPlayed, setDPlayed] = useState<DoublesPlay | null>(null);
  const [dReported, setDReported] = useState('');
  // Play turn: what you saw happen to each of the four's moves (First / Missed / Crit / Didn't move), as in singles
  // (a spread move: missed / crit per target, by name)
  type DOut = Outcome & { miss_on?: string[]; crit_on?: string[] };
  const [dOutcome, setDOutcome] = useState<{ me: DOut[]; opp: DOut[] }>({ me: [{}, {}], opp: [{}, {}] });
  const toggleDOn = (side: 'me' | 'opp', k: number, f: 'miss_on' | 'crit_on', who: string) =>
    setDOutcome((o) => {
      const n = { me: o.me.map((x) => ({ ...x })), opp: o.opp.map((x) => ({ ...x })) };
      const cur = n[side][k][f] ?? [];
      n[side][k][f] = cur.includes(who) ? cur.filter((x) => x !== who) : [...cur, who];
      return n;
    });
  const toggleDOutcome = (side: 'me' | 'opp', k: number, f: keyof Outcome) =>
    setDOutcome((o) => {
      const n = { me: o.me.map((x) => ({ ...x })), opp: o.opp.map((x) => ({ ...x })) };
      n[side][k][f] = !n[side][k][f];
      // only one of the four can be the one that went first
      if (f === 'first' && n[side][k].first) for (const sd of ['me', 'opp'] as const) for (const j of [0, 1]) if (sd !== side || j !== k) n[sd][j].first = false;
      return n;
    });
  // the Pokémon a spread move picked for this slot hits ([] for a single-target move): both foes, plus the partner for
  // Earthquake-like moves
  const dSpreadTargets = (side: 'me' | 'opp', k: number): string[] => {
    const label = dOpts?.[side][k].find((o) => o.index === dPick?.[side][k])?.action ?? '';
    const both = label.endsWith('(both foes)');
    const all = label.endsWith('(hits everyone)');
    if (!dOpts || (!both && !all)) return [];
    const foes = dOpts.field[side === 'me' ? 1 : 0].filter(Boolean);
    const partner = dOpts.field[side === 'me' ? 0 : 1][1 - k];
    return all && partner ? [...foes, partner] : foes;
  };
  // Showdown-style choice: a label is "Mega + Move → Target", "Move (both foes)", "Move" or "Switch to X"
  const parseAct = (a: string) => {
    if (a.startsWith('Switch to ')) return { kind: 'switch' as const, mega: false, move: '', target: '', to: a.slice(10) };
    const mega = a.startsWith('Mega + ');
    const rest = mega ? a.slice(7) : a;
    const [mv, tgt] = rest.split(' → ');
    return { kind: 'move' as const, mega, move: mv.replace(/ \((both foes|hits everyone|partner)\)$/, ''), target: tgt ?? '', to: '' };
  };
  const pickIdx = (side: 'me' | 'opp', k: number, want: { kind: 'move' | 'switch'; mega?: boolean; move?: string; target?: string; to?: string }) => {
    const list = dOpts?.[side][k] ?? [];
    const ps = list.map((o) => ({ o, a: parseAct(o.action) }));
    const hit =
      want.kind === 'switch'
        ? ps.find((x) => x.a.kind === 'switch' && x.a.to === want.to)
        : ps.find((x) => x.a.kind === 'move' && x.a.move === want.move && x.a.mega === !!want.mega && (!want.target || x.a.target === want.target)) ??
          ps.find((x) => x.a.kind === 'move' && x.a.move === want.move && x.a.mega === !!want.mega) ??
          ps.find((x) => x.a.kind === 'move' && x.a.move === want.move);
    if (!hit) return;
    dTouched.current = { ...(dTouched.current.turn === turn ? dTouched.current : { turn, picks: {} }) };
    dTouched.current.picks = { ...dTouched.current.picks, [`${side}${k}`]: { who: dOpts?.field[side === 'me' ? 0 : 1][k] ?? '', action: hit.o.action } };
    setDPick((p) => (p ? { ...p, [side]: p[side].map((x, j) => (j === k ? hit.o.index : x)) } : p));
    // another choice: what was ticked for the old one goes
    setDOutcome((o) => ({ ...o, [side]: o[side].map((x, j) => (j === k ? {} : x)) }));
  };
  // Showdown's way: one Pokémon at a time ("What will X do?"), then "Where should X aim <move>?" for a move with a
  // choice of target; yours first, then theirs; then Play. Each starts on the bot's pick.
  const [dStep, setDStep] = useState(0);
  const [dAim, setDAim] = useState<{ move: string; mega: boolean } | null>(null);
  const [dMegaOn, setDMegaOn] = useState<Record<string, boolean>>({});
  // what you picked this turn, slot by slot: kept when the menus or the bot's answer come again (an edited set, a fixed
  // HP), so a change mid-turn does not send you back to the start. A new turn forgets it.
  const dTouched = useRef<{ turn: number; picks: Record<string, { who: string; action: string }> }>({ turn: 0, picks: {} });
  // a slot left empty by a faint is not asked about (its replacement goes in with Send in / They sent in)
  const dSlots = (['me', 'opp'] as const).flatMap((side) =>
    [0, 1].filter((k) => (dOpts?.[side][k].length ?? 0) > 0 && !!dOpts?.field[side === 'me' ? 0 : 1][k]).map((k) => ({ side, k })),
  );
  const setOf = (side: 'me' | 'opp', name: string) => (side === 'me' ? mineAll : theirs).find((x) => baseName(x) === name);
  const choose = (side: 'me' | 'opp', k: number, want: Parameters<typeof pickIdx>[2]) => {
    pickIdx(side, k, want);
    setDAim(null);
    setDStep((i) => i + 1);
  };
  const sdChooser = () => {
    if (!dOpts || !dPick) return null;
    const cur = dSlots[dStep];
    if (!cur) return null;
    const { side, k } = cur;
    const list = dOpts[side][k];
    const acts = list.map((o) => parseAct(o.action));
    const who = dOpts.field[side === 'me' ? 0 : 1][k];
    const whoSet = setOf(side, who);
    const key = `${side}${k}`;
    const canMega = acts.some((a) => a.mega);
    const mega = !!dMegaOn[key] && canMega;
    const moves = [...new Set(acts.filter((a) => a.kind === 'move').map((a) => a.move))];
    const switches = acts.filter((a) => a.kind === 'switch').map((a) => a.to);
    const targetsOf = (m: string) => [...new Set(acts.filter((a) => a.kind === 'move' && a.move === m && a.mega === mega && a.target).map((a) => a.target))];
    const back =
      dStep > 0 || dAim ? (
        <button className="sd-back" onClick={() => (dAim ? setDAim(null) : setDStep((i) => Math.max(0, i - 1)))}>
          ‹ Back
        </button>
      ) : null;
    if (dAim) {
      const targets = targetsOf(dAim.move);
      const foes = dOpts.field[side === 'me' ? 1 : 0];
      const own = dOpts.field[side === 'me' ? 0 : 1];
      const cell = (name: string, mine: boolean) => {
        // the engine names a Mega Evolved target by its Mega form ("Charizard-Mega-Y"); the field by its base name
        const tgt = name ? targets.find((t) => t === name || t.startsWith(name + '-Mega')) : undefined;
        const st = name ? setOf(mine === (side === 'me') ? 'me' : 'opp', name) : undefined;
        return (
          <button key={(mine ? 'o' : 'f') + name} className="sd-target" disabled={!tgt} onClick={() => choose(side, k, { kind: 'move', mega: dAim.mega, move: dAim.move, target: tgt })}>
            {st && <Sprite species={st.species} size={26} />}
            {name || '—'}
          </button>
        );
      };
      return (
        <div className="sd">
          <div className="sd-head">
            {back}
            Where should <b>{who}</b> aim <b>{dAim.move}</b>?
          </div>
          <div className="sd-targets">
            {foes.map((n) => cell(n, false))}
            {own.map((n) => cell(n, true))}
          </div>
        </div>
      );
    }
    return (
      <div className="sd">
        <div className="sd-head">
          {back}
          What will {side === 'opp' ? 'their ' : ''}
          <b>{who}</b> do?
        </div>
        <div className="sd-h">Battle</div>
        <div className="sd-moves">
          {moves.map((m) => {
            const ty = shownType(m, whoSet);
            const mv = dOpts.moves?.[side]?.[k]?.find((x) => x.name === m);
            const counted = whoSet ? mark(side === 'me' ? 0 : 1, whoSet).pp?.[m] : undefined;
            const pp: [number, number] | undefined = counted ?? (mv ? [mv.pp, mv.max] : undefined);
            const picked = parseAct(list.find((o) => o.index === dPick[side][k])?.action ?? '');
            return (
              <button
                key={m}
                className={`sd-move sd-t-${(ty ?? 'Normal').toLowerCase()}` + (picked.kind === 'move' && picked.move === m ? ' on' : '')}
                onClick={() => (targetsOf(m).length > 1 ? setDAim({ move: m, mega }) : choose(side, k, { kind: 'move', mega, move: m, target: targetsOf(m)[0] }))}
              >
                <span className="sd-mname">{m}</span>
                <span className="sd-mtype">{ty ?? ''}</span>
                {pp && (
                  <span className="sd-mpp">
                    {pp[0]}/{pp[1]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {canMega && (
          <label className="check sd-mega">
            <input type="checkbox" checked={mega} onChange={(e) => setDMegaOn((o) => ({ ...o, [key]: e.target.checked }))} />
            Mega Evolve
          </label>
        )}
        {(() => {
          // what the game shows that the bot cannot know by itself: a move Disable / Cursed Body took, a Ghost's Curse
          const vk = `${side}:${who}`;
          const v = dVolNow(side, who);
          const all = [...new Set([...(dOpts.moves?.[side]?.[k]?.map((x) => x.name) ?? []), ...moves, ...(v.disabled ? [v.disabled] : [])])];
          return (
            <div className="sd-vol">
              <label>
                Disabled{' '}
                <select value={v.disabled ?? ''} onChange={(e) => setDManual((o) => ({ ...o, [vk]: { ...o[vk], disabled: e.target.value || null, at: turn } }))}>
                  <option value="">none</option>
                  {all.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={!!v.cursed} onChange={(e) => setDManual((o) => ({ ...o, [vk]: { ...o[vk], cursed: e.target.checked } }))} />
                Cursed
              </label>
            </div>
          );
        })()}
        <div className="sd-h sw">Switch</div>
        <div className="sd-switch">
          {(side === 'me' ? mine.map(baseName) : [...new Set([...dOpts.field[1].filter(Boolean), ...switches])]).map((t) => {
            const st = setOf(side, t);
            return (
              <button key={t} disabled={!switches.includes(t)} onClick={() => choose(side, k, { kind: 'switch', to: t })}>
                {st && <Sprite species={st.species} size={24} />}
                {t}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  // the four choices so far (tap one to change it), with what you saw happen
  const sdSummary = () =>
    !dOpts || !dPick
      ? null
      : dSlots.map(({ side, k }, i) => {
          const label = dOpts[side][k].find((o) => o.index === dPick[side][k])?.action ?? '';
          return (
            <div key={side + k} className={'sd-row' + (i === dStep ? ' now' : '')}>
              <button className="link" onClick={() => (setDStep(i), setDAim(null))} title="Change this one">
                <b>{dOpts.field[side === 'me' ? 0 : 1][k]}</b>: {label}
              </button>
              {dOutcomeChips(side, k)}
            </div>
          );
        });
  const dOutcomeChips = (side: 'me' | 'opp', k: number) => {
    const spread = dSpreadTargets(side, k);
    const one = (f: keyof Outcome, l: string, t: string) => (
      <button key={f} className={'bv-tag' + (dOutcome[side][k][f] ? ' on' : '')} title={t} onClick={() => toggleDOutcome(side, k, f)}>
        {l}
      </button>
    );
    const per = (f: 'miss_on' | 'crit_on', l: string, who: string) => (
      <button
        key={f + who}
        className={'bv-tag' + (dOutcome[side][k][f]?.includes(who) ? ' on' : '')}
        title={f === 'miss_on' ? `It missed ${who} (and hit the others)` : `Its hit on ${who} was a critical hit`}
        onClick={() => toggleDOn(side, k, f, who)}
      >
        {l} {who}
      </button>
    );
    return (
      <span className="ai-outcome">
        {one('first', 'First', 'It moved first in its priority bracket (a speed tie, or the bot has the speed wrong)')}
        {spread.length
          ? [...spread.map((w) => per('miss_on', 'Missed', w)), ...spread.map((w) => per('crit_on', 'Crit', w))]
          : [one('miss', 'Missed', 'Its move missed'), one('crit', 'Crit', 'Its hit was a critical hit')]}
        {one('no_move', "Didn't move", 'Flinched, fully paralysed, asleep... it did not move this turn')}
      </span>
    );
  };
  // Play turn: who comes in after a switching move (Parting Shot, U-turn...) or comes back (Revival Blessing), per side
  const [dPivot, setDPivot] = useState<{ me: string; opp: string }>({ me: '', opp: '' });
  /** The type a move is used as here: Weather Ball takes the weather's (Mega Sol: Fire), Terrain Pulse the terrain's. */
  const shownType = (m: string, who?: PokemonSet): string | undefined => {
    const base = moveInfo(m)?.type;
    if (m === 'Weather Ball') {
      const w = who?.ability === 'Mega Sol' ? 'Sun' : field.weather;
      const t = ({ Sun: 'Fire', 'Harsh Sunshine': 'Fire', Rain: 'Water', 'Heavy Rain': 'Water', Sand: 'Rock', Snow: 'Ice', Hail: 'Ice' } as Record<string, string>)[w ?? ''];
      return t ?? base;
    }
    if (m === 'Terrain Pulse' && field.terrain) {
      const t = ({ Electric: 'Electric', Grassy: 'Grass', Misty: 'Fairy', Psychic: 'Psychic' } as Record<string, string>)[field.terrain];
      return t ?? base;
    }
    return base;
  };
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
  const lastOpp = useRef<string[]>([]);
  useEffect(() => {
    if (battleId === firstBattle.current) return;
    lastOpp.current = theirs.map((x) => baseName(x)); // last game's six: a slot left unchanged gets pointed out
    setMarks({});
    setTurnRaw(1);
    setNext('solve');
    setShowSetup(false);
    setLeadsDone(false);
    setPlayed(null);
    setSolved(null);
    setAdvice(null);
    setBring(null);
    setDBring(null);
    setDTurn(1);
    setDTurnRes(null);
    setDOpts(null);
    setDPlayed(null);
    dPending.current = null;
    setDLeadsDone(false);
    setDVolMap({});
    setDManual({});
    dCarry.current = { turn: -1, me: {}, opp: {} };
    dFresh.current = {};
    dLast.current = null;
    setPhase('preview');
    setPrevSel({ bring: [], leads: [] });
    setPrevOpp([]);
    setOppLeads([]);
    setPicked(null);
    setError('');
    setLive(false);
    setVol([{}, {}]);
    setTimers({});
    setFaints([0, 0]);
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
  // singles: bring 3; doubles: bring 4
  const BRING_N = singles ? 3 : 4;
  // Team preview, as in the game: you pick the ones you bring and your lead(s), start the battle, then tap the lead(s)
  // they sent out. Nothing is taken from whatever happens to be selected in the calc.
  const LEADS_N = singles ? 1 : 2;
  const theirsCount = teams[1].sets.filter((x) => x.species).length;
  const [phase, setPhase] = useState<'preview' | 'battle'>('preview');
  const [prevSel, setPrevSel] = useState<{ bring: string[]; leads: string[] }>({ bring: [], leads: [] });
  // their lead(s), if you mark them in the preview (else you tap them once the battle starts)
  const [prevOpp, setPrevOpp] = useState<string[]>([]);
  const togglePrevOpp = (n: string) => setPrevOpp((o) => (o.includes(n) ? o.filter((x) => x !== n) : o.length >= LEADS_N ? o : [...o, n]));
  const [oppLeads, setOppLeads] = useState<string[]>([]);
  const oppLeadsReady = phase === 'battle' && oppLeads.length >= Math.min(LEADS_N, Math.max(1, theirsCount));
  const togglePrevBring = (n: string) =>
    setPrevSel((o) =>
      o.bring.includes(n)
        ? { bring: o.bring.filter((x) => x !== n), leads: o.leads.filter((x) => x !== n) }
        : o.bring.length >= BRING_N
          ? o
          : { ...o, bring: [...o.bring, n] },
    );
  const togglePrevLead = (n: string) =>
    setPrevSel((o) =>
      o.leads.includes(n)
        ? { ...o, leads: o.leads.filter((x) => x !== n) }
        : o.leads.length >= LEADS_N
          ? o
          : { bring: o.bring.includes(n) || o.bring.length >= BRING_N ? o.bring : [...o.bring, n], leads: o.bring.includes(n) || o.bring.length < BRING_N ? [...o.leads, n] : o.leads },
    );
  // the ones holding their Mega Stone among these (only one can Mega Evolve in a battle)
  const megaHolders = (names: string[]) =>
    names.filter((n) => {
      const x = mineAll.find((m) => baseName(m) === n);
      return !!x && (x.species !== baseName(x) || !!megaFor(baseName(x), x.item));
    });
  const startBattle = () => {
    const { bring: b, leads: l } = prevSel;
    if (b.length !== BRING_N || l.length !== LEADS_N) return setError(`Pick ${BRING_N} to bring and ${LEADS_N === 1 ? 'your lead' : 'your 2 leads'} first.`);
    const order = [...l, ...b.filter((n) => !l.includes(n))];
    const idx = order.map((n) => teams[0].sets.findIndex((x) => x.species && baseName(x) === n));
    if (idx.some((i) => i < 0)) return setError('Could not find those in your team.');
    onApplyBring(idx, idx.slice(0, LEADS_N));
    setPicked(order);
    // their leads marked in the preview: out at once (left, then right), and the battle is under way
    const theirIdx = prevOpp.map((n) => teams[1].sets.findIndex((x) => x.species && baseName(x) === n)).filter((i) => i >= 0);
    if (theirIdx.length === LEADS_N) {
      for (const n of prevOpp) {
        const x = teams[1].sets.find((m) => m.species && baseName(m) === n);
        if (x) markAppeared(x);
      }
      setTeams((old) => {
        const next: [Team, Team] = [old[0], old[1]];
        next[1] = { ...old[1], active: theirIdx[0], partner: LEADS_N > 1 ? theirIdx[1] : undefined };
        return next;
      });
      setOppLeads([...prevOpp]);
      setLive(true);
    } else {
      setOppLeads([]);
      setLive(false);
    }
    setLeadsDone(false);
    setDLeadsDone(false);
    setError('');
    setPhase('battle');
  };
  const defaultBrought = useMemo(() => {
    const kept = mineAll.filter((s) => !skipped.includes(s.species));
    return (kept.length === BRING_N ? kept : mineAll.slice(0, BRING_N)).map(baseName);
  }, [mineAll, skipped, BRING_N]);
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
      return cur.includes(name) ? cur.filter((n) => n !== name) : cur.length >= BRING_N ? cur : [...cur, name];
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
    if (side === 1 && phase === 'battle' && !oppLeadsReady) {
      const name = baseName(s);
      if (oppLeads.includes(name)) return;
      markAppeared(s);
      const k = oppLeads.length;
      setOppLeads((o) => [...o, name]);
      setTeams((old) => {
        const i = old[1].sets.indexOf(s);
        if (i < 0) return old;
        const next: [Team, Team] = [old[0], old[1]];
        next[1] = k === 0 ? { ...old[1], active: i, partner: undefined } : { ...old[1], partner: i };
        return next;
      });
      // all their leads in: the battle is under way (the leads' entry abilities follow by themselves)
      if (k + 1 >= LEADS_N) setLive(true);
      return;
    }
    if (!singles) {
      // a slot whose Pokémon fainted: the replacement comes in through the engine (no turn change)
      {
        const t = teams[side];
        const downAt = (k: number | undefined) => k != null && !!t.sets[k]?.species && (t.sets[k].hpPercent <= 0 || mark(side, t.sets[k]).ko);
        const slot = downAt(t.active) ? 0 : downAt(t.partner) ? 1 : -1;
        const i = t.sets.indexOf(s);
        if (slot >= 0 && i >= 0 && i !== t.active && i !== t.partner && s.hpPercent > 0 && phase === 'battle' && up === true) {
          doDoublesSendIn(side, slot, s);
          return;
        }
      }
      setLive(true);
      if (side === 1) markAppeared(s);
      setTeams((old) => {
        const t = old[side];
        const i = t.sets.indexOf(s);
        if (i < 0 || i === t.active || i === t.partner) return old;
        const down = (k: number | undefined) => k == null || !t.sets[k]?.species || t.sets[k].hpPercent <= 0 || mark(side, t.sets[k]).ko;
        const next: [Team, Team] = [old[0], old[1]];
        // the left slot when it is down; else the right one when it is down or empty; else the left one
        next[side] = down(t.active) ? { ...t, active: i } : down(t.partner) ? { ...t, partner: i } : { ...t, active: i };
        return next;
      });
      return;
    }
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

  const [faints, setFaints] = useState<[number, number]>([0, 0]);
  const position = (allowTheirKo = false) => {
    if (mine.length !== 3) throw new Error('Tick the three Pokémon you brought (Setup, below).');
    if (!mineActive || !mine.some((s) => baseName(s) === baseName(mineActive))) throw new Error('Pick which of your three is out.');
    if (!theirActive) throw new Error("Add the opposing Pokémon that is out and pick it.");
    // both fainted (double KO): you pick blind, so the bot solves that guess; otherwise theirs must be replaced first
    if (!allowTheirKo && mark(1, theirActive).ko && !mark(0, mineActive).ko) throw new Error('Their Pokémon is marked fainted: pick the one they sent out.');
    // faints so far (a Pokémon brought back by Revival Blessing still counts for Last Respects)
    return { ...buildPosition({ mine, mineActive: baseName(mineActive), theirs, theirActive: baseName(theirActive), marks, field, turn, vol }), fainted_count: faints };
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
        // far from the engine's number (under 40% or over 2.5x): a slip in the HP entered or something not modelled
        if (dmg <= 0 || (!ko && (dmg < 0.4 * h.dmg || dmg > 2.5 * h.dmg))) continue;
        (add[h.theirs] ??= []).push({ ...base, dealt_by_opp: true, dmg, my_hp_before: h.before, ko });
      } else {
        const s = teams[1].sets.find((x) => x.species && baseName(x) === h.theirs);
        if (!s || p.opp[h.theirs] === undefined) continue;
        const ko = mark(1, s).ko;
        const cur = ko ? 0 : s.hpPercent;
        const from = (100 * h.before) / h.max_hp;
        const to = ko ? 0 : Math.max(0, (100 * (h.before - h.dmg)) / h.max_hp + (cur - p.opp[h.theirs]));
        const pctEngine = (100 * h.dmg) / h.max_hp;
        if (from - to < 1 || (!ko && (from - to < 0.4 * pctEngine || from - to > 2.5 * pctEngine))) continue;
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
  type Snapshot = { teams: [Team, Team]; field: FieldState; vol: [Vol, Vol]; marks: Record<string, Marks>; turn: number; timers: Record<string, number>; faints?: [number, number] };
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
    const myMega =
      !!mineActive &&
      !mark(0, mineActive).mega &&
      !mine.some((s) => mark(0, s).mega) &&
      (baseName(mineActive) !== mineActive.species || /ite( [XYZ])?$/.test(mineActive.item));
    if (mineActive && myMega) for (const m of mineActive.moves) if (m) add(myOpts, `${m} + Mega Evolve`);
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
  // a new turn or a switch: back to the bot's suggestions (an edit mid-turn keeps what you picked)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPlayChoice(['', '']), [turn, mineActive && baseName(mineActive), theirActive && baseName(theirActive)]);

  // Singles as Showdown: "What will X do?" for yours, then theirs, then Play. Each starts on the bot's pick.
  const [sStep, setSStep] = useState(0);
  const [sMega, setSMega] = useState<[boolean, boolean]>([false, false]);
  useEffect(() => {
    setSStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, mineActive && baseName(mineActive), theirActive && baseName(theirActive)]);
  // the Mega box follows the bot's pick until you choose that side yourself
  useEffect(() => {
    setSMega((v) => [playChoice[0] ? v[0] : defaultPlay[0].endsWith(' + Mega Evolve'), playChoice[1] ? v[1] : defaultPlay[1].endsWith(' + Mega Evolve')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPlay[0], defaultPlay[1], playChoice[0], playChoice[1]]);
  // your pick, while it is still on the menu (an edited set can take a move away)
  const sChosen = (sd: 0 | 1) => (playChoice[sd] && playOpts[sd].includes(playChoice[sd]) ? playChoice[sd] : defaultPlay[sd]);
  const sPick = (sd: 0 | 1, label: string) => {
    setPlayChoice((c) => (sd === 0 ? [label, c[1]] : [c[0], label]));
    setSStep(sd + 1);
  };
  const ssChooser = () => {
    if (sStep > 1) return null;
    const sd = sStep as 0 | 1;
    const who = sd === 0 ? mineActive : theirActive;
    if (!who) return null;
    const opts = playOpts[sd];
    const canMega = opts.some((o) => o.endsWith(' + Mega Evolve'));
    const mega = sMega[sd] && canMega;
    const moves = [...new Set(opts.filter((o) => !o.startsWith('Switch to ')).map((o) => o.replace(/ \+ Mega Evolve$/, '')))];
    const switchable = opts.filter((o) => o.startsWith('Switch to ')).map((o) => o.slice(10));
    const team = sd === 0 ? mine : teams[1].sets.filter((x) => x.species);
    const cur = sChosen(sd);
    return (
      <div className="sd">
        <div className="sd-head">
          {sd > 0 && (
            <button className="sd-back" onClick={() => setSStep(0)}>
              ‹ Back
            </button>
          )}
          What will {sd ? 'their ' : ''}
          <b>{baseName(who)}</b> do?
        </div>
        <div className="sd-h">Battle</div>
        <div className="sd-moves">
          {moves.map((m) => {
            const ty = shownType(m, who);
            const pp = mark(sd, who).pp?.[m];
            const label = mega && opts.includes(`${m} + Mega Evolve`) ? `${m} + Mega Evolve` : m;
            return (
              <button
                key={m}
                className={`sd-move sd-t-${(ty ?? 'Normal').toLowerCase()}` + (cur.replace(/ \+ Mega Evolve$/, '') === m ? ' on' : '')}
                onClick={() => sPick(sd, label)}
              >
                <span className="sd-mname">{m}</span>
                <span className="sd-mtype">{ty ?? ''}</span>
                {pp && (
                  <span className="sd-mpp">
                    {pp[0]}/{pp[1]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {canMega && (
          <label className="check sd-mega">
            <input type="checkbox" checked={mega} onChange={(e) => setSMega((v) => (sd === 0 ? [e.target.checked, v[1]] : [v[0], e.target.checked]))} />
            Mega Evolve
          </label>
        )}
        <div className="sd-h sw">Switch</div>
        <div className="sd-switch">
          {team.map((x) => {
            const n = baseName(x);
            return (
              <button key={n} disabled={!switchable.includes(n)} className={cur === 'Switch to ' + n ? 'on' : ''} onClick={() => sPick(sd, 'Switch to ' + n)}>
                <Sprite species={x.species} size={24} />
                {n}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  const ssSummary = () =>
    ([0, 1] as const).map((sd) => {
      const who = sd === 0 ? mineActive : theirActive;
      return (
        <div key={sd} className={'sd-row' + (sd === sStep ? ' now' : '')}>
          <button className="link" onClick={() => setSStep(sd)} title="Change this one">
            <b>{who ? baseName(who) : ''}</b>: {sChosen(sd)}
          </button>
          {outcomeChips(sd)}
        </div>
      );
    });

  /** advance: a played turn moves the turn number on; a replacement sent in between turns does not. */
  const applyPlay = (r: PlayResult, snap: Snapshot, advance = true) => {
    const t0 = turn;
    if (r.fainted_count) setFaints(r.fainted_count);
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
            // yours exactly (the game shows your HP as a number; a whole percent can be a point off), theirs as shown
            hpPercent: m.fainted ? 1 : sd === 0 && m.max_hp ? Math.max(0.1, (100 * m.hp) / m.max_hp) : Math.max(1, m.hp_pct),
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
          // nature and stat points only: the item stays as you set it (a spread switch never undoes your Leftovers)
          patchSet(1, s, { nature: b.nature, sp: spread });
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
      const mine = needPivot ? needPivot.chosen.__mine : sChosen(0);
      const theirs = needPivot ? needPivot.chosen.__theirs : sChosen(1);
      if (!mine || !theirs) throw new Error('Pick what both sides did.');
      const snap: Snapshot = { teams, field, vol, marks, turn, timers, faints };
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
      const snap: Snapshot = { teams, field, vol, marks, turn, timers, faints };
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
  const needLeads = phase === 'battle' && oppLeadsReady && turn === 1 && !leadsDone && !!rawBoard && !!mineActive?.species && !!theirActive?.species && !played && noBoosts(mineActive) && noBoosts(theirActive); // (weather alone is no sign: V-Calc sets it itself for Sand Stream, Drought...)
  const doLeads = () =>
    runPlay(async () => {
      if (!rawBoard) return;
      const snap: Snapshot = { teams, field, vol, marks, turn, timers, faints };
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
    setFaints(s.faints ?? [0, 0]);
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
    if (phase === 'preview') return setError('Team preview: pick your bring and lead, then Start battle.');
    if (!oppLeadsReady) return setError("Tap the Pokémon they led with (their icons, top right).");
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
      const sig = bringSig;
      setBring(await askBringCheck(mineAll, theirs, BRING_SECS));
      bringFor.current = sig;
    });
  // the two sixes, order aside (a bring answer is for these)
  const dSig = [...mineAll.map(baseName).sort(), '|', ...theirs.map(baseName).sort()].join(',');
  const dSigRef = useRef(dSig);
  dSigRef.current = dSig;
  // Doubles: which 4 and which 2 lead, from simulated games
  const doDoublesBring = () =>
    run(`Simulating every likely bring (about ${BRING_SECS} s)…`, async () => {
      if (theirs.length < 6) throw new Error(`Enter all six of the opponent's Pokémon first (${theirs.length} so far).`);
      if (mineAll.length < 6) throw new Error(`The bot picks 4 from your six; you have ${mineAll.length} entered.`);
      const r = await askDoublesBring(mineAll, theirs, BRING_SECS);
      setDBring({ ...r, sig: dSigRef.current });
    });
  // Doubles: put the picked four first in your team and the two leads out
  const useDoublesBring = (o: { lead: string[]; back: string[] }) => {
    if (phase === 'preview') {
      setPrevSel({ bring: [...o.lead, ...o.back], leads: [...o.lead] });
      return;
    }
    const idx = (n: string) => teams[0].sets.findIndex((s) => s.species && baseName(s) === n);
    const four = [...o.lead, ...o.back].map(idx).filter((i) => i >= 0);
    if (four.length !== 4) return setError('Could not find those four in your team.');
    onApplyBring(four, four.slice(0, 2));
    setPicked([...o.lead, ...o.back]);
    setDTurn(1);
    setDTurnRes(null);
  };
  // Doubles turn advice: the board as the calc has it (left = the selected Pokémon, right = its partner)
  const dSide = (side: 0 | 1) => {
    const t = teams[side];
    const left = t.sets[t.active];
    const right = t.partner != null ? t.sets[t.partner] : undefined;
    return [left, right].map((s) => (s && s.species ? s : undefined));
  };
  // `auto`: asked by itself (the board may not have your HP corrections yet, so the last turn's hits wait)
  const doDoublesTurn = (auto = false) => {
    if (phase === 'preview') return setError('Team preview: pick your bring and leads, then Start battle.');
    if (!oppLeadsReady) return setError('Tap the two Pokémon they led with (their icons, top right).');
    if (needDLeads) {
      setLive(true);
      return doDoublesLeads();
    }
    setLive(true);
    return run(`Simulating this turn (about ${secs} s)…`, async () => {
      const b0 = doublesBoard(auto ? {} : takeDoublesHits());
      const t = dAdvance(b0);
      const b = { ...b0, turn: t, just_in: dMarkFresh(t) };
      dAutoKey.current = boardKey(b0);
      setDTurnRes(await askDoublesTurn(mineAll, b, secs));
    });
  };
  // The turn counts up by itself, as in singles: the board changed (who is out, HP, status, stages, the field) since the
  // last answer for this turn number, more than a moment after it (not you still entering this turn). Play turn counts
  // its own turn.
  const dLast = useRef<{ turnKey: string; hpKey: string; turn: number; at: number } | null>(null);
  const dPlayedTurn = useRef<number | null>(null);
  const dKeysOf = (b: ReturnType<typeof doublesBoard>) => ({
    turnKey: JSON.stringify([b.me.hp, b.me.status, b.me.boosts, b.active_me, b.opp.map((o) => [o.species, o.hp, o.status, o.boosts]), b.active_opp, { ...b.field, turns: undefined }]),
    hpKey: JSON.stringify([b.me.hp, b.opp.map((o) => [o.species, o.hp]), b.active_me, b.active_opp]),
  });
  const dAdvance = (b: ReturnType<typeof doublesBoard>): number => {
    const k = dKeysOf(b);
    const now = Date.now();
    let t = turn;
    const l = dLast.current;
    if (dPlayedTurn.current === turn) dPlayedTurn.current = null;
    else if (l && l.turn === turn && l.turnKey !== k.turnKey && (turn > 1 || l.hpKey !== k.hpKey) && now - l.at > SAME_TURN_MS) t = turn + 1;
    if (t !== turn) setDTurn(t);
    dLast.current = { ...k, turn: t, at: now };
    return t;
  };
  // Who just came in (Fake Out, First Impression work on its first turn out): a Pokémon is fresh on the first turn it is
  // asked about after it came out.
  const dFresh = useRef<Record<string, number>>({});
  const dMarkFresh = (t: number): string[] => {
    const out = [0, 1].flatMap((sd) => dSide(sd as 0 | 1).filter((x): x is PokemonSet => !!x).map((x) => `${sd}:${baseName(x)}`));
    const next: Record<string, number> = {};
    for (const k of out) next[k] = dFresh.current[k] ?? t;
    dFresh.current = next;
    return out.filter((k) => next[k] === t).map((k) => k.slice(2));
  };
  // Spread reading (doubles): the last played turn's hits, measured once you have set the HP the game showed (the next
  // time the board is sent). A target hit once that turn only: two hits on one Pokémon cannot be told apart.
  const dPending = useRef<DoublesHit[] | null>(null);
  const takeDoublesHits = (): Record<string, SeenHit[]> => {
    const hs = dPending.current;
    dPending.current = null;
    if (!hs || !hs.length) return {};
    const toObj = (a: number[]) => ({ atk: a[0], def: a[1], spa: a[2], spd: a[3], spe: a[4] });
    const per: Record<string, number> = {};
    const tkey = (h: DoublesHit) => (h.attacker === 'opp' ? 'me:' + h.mine : 'opp:' + h.theirs);
    for (const h of hs) per[tkey(h)] = (per[tkey(h)] ?? 0) + 1;
    const add: Record<string, SeenHit[]> = {};
    for (const h of hs) {
      if (h.hits !== 1 || h.unmeasured || per[tkey(h)] !== 1) continue;
      const base = {
        move: h.move, other: h.mine, crit: h.crit, opp_boosts: toObj(h.opp_boosts), my_boosts: toObj(h.my_boosts), opp_status: h.opp_status,
        my_status: h.my_status, opp_mega: h.opp_mega, my_mega: h.my_mega, weather: h.weather, terrain: h.terrain, def_screens: h.def_screens,
        spread: h.spread, doubles: true,
      };
      if (h.attacker === 'opp') {
        const s = mineAll.find((x) => baseName(x) === h.mine);
        const max = s ? maxHpOf(s) : undefined;
        if (!s || !max) continue;
        const ko = s.hpPercent <= 0;
        const cur = ko ? 0 : Math.round((max * s.hpPercent) / 100);
        const dmg = ko ? h.before : h.dmg + (h.after - cur); // the engine's number, moved by your correction
        if (dmg <= 0 || (!ko && (dmg < 0.4 * h.dmg || dmg > 2.5 * h.dmg))) continue;
        (add[h.theirs] ??= []).push({ ...base, dealt_by_opp: true, dmg, my_hp_before: h.before, ko });
      } else {
        const s = theirs.find((x) => baseName(x) === h.theirs);
        if (!s) continue;
        const ko = s.hpPercent <= 0;
        const from = (100 * h.before) / h.max_hp;
        const to = ko ? 0 : Math.max(0, (100 * (h.before - h.dmg)) / h.max_hp + (s.hpPercent - (100 * h.after) / h.max_hp));
        const pctEngine = (100 * h.dmg) / h.max_hp;
        if (from - to < 1 || (!ko && (from - to < 0.4 * pctEngine || from - to > 2.5 * pctEngine))) continue;
        (add[h.theirs] ??= []).push({ ...base, dealt_by_opp: false, pct_from: from, pct_to: to, ko });
      }
    }
    if (Object.keys(add).length) {
      setMarks((old) => {
        const out = { ...old };
        for (const [sp, list] of Object.entries(add)) {
          const k = `1:${sp}`;
          const cur = out[k] ?? blankMarks();
          out[k] = { ...cur, hits: [...(cur.hits ?? []), ...list] };
        }
        return out;
      });
    }
    return add;
  };
  // Play turn (doubles): both sides' choices -> the typical result, written into the calc. The menus follow the board
  // on screen and start on the bot's pick and their likely choice, as in singles.
  // the bot's picks, with yours kept where the same Pokémon still has the same choice; `kept` says if any were
  const dMerged = (o: DoublesOptions) => {
    const d = dDefaults(o);
    const t = dTouched.current.turn === turn ? dTouched.current.picks : {};
    let kept = false;
    for (const side of ['me', 'opp'] as const)
      for (const k of [0, 1]) {
        const c = t[`${side}${k}`];
        if (!c || o.field[side === 'me' ? 0 : 1][k] !== c.who) continue;
        const hit = o[side][k].find((x) => x.action === c.action);
        if (hit) {
          d[side][k] = hit.index;
          kept = true;
        }
      }
    return { pick: d, kept };
  };
  const dDefaults = (o: DoublesOptions) => {
    const pickOf = (list: { index: number; action: string }[], want?: string | null): number =>
      (want ? list.find((x) => x.action.trim() === want.trim())?.index : undefined) ?? list[0]?.index ?? -1;
    const best = dTurnRes?.options?.[0];
    const their = dTurnRes?.theirs?.[0]?.action.split('  |  ') ?? [];
    return {
      me: [pickOf(o.me[0], best?.left), pickOf(o.me[1], best?.right)],
      opp: [pickOf(o.opp[0], their[0]), pickOf(o.opp[1], their.length > 1 ? their[1] : their[0])],
    };
  };
  // the moves after which the side picks who comes in (or, Revival Blessing, who comes back)
  const PIVOTS = ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Teleport', 'Shed Tail', 'Baton Pass', 'Chilly Reception', 'Revival Blessing'];
  const dPicked = (side: 'me' | 'opp'): string[] =>
    !dOpts || !dPick
      ? []
      : [0, 1].map((k) => dOpts[side][k].find((o) => o.index === dPick[side][k])?.action ?? '');
  const moveOf = (label: string) => label.replace(/^mega\s*\+\s*/i, '').split(' → ')[0].trim();
  const dPivotNeeded = (side: 'me' | 'opp') => dPicked(side).some((l) => PIVOTS.includes(moveOf(l)));
  const dPivotChoices = (side: 'me' | 'opp'): string[] => {
    const revive = dPicked(side).some((l) => moveOf(l) === 'Revival Blessing');
    const out = dSide(side === 'me' ? 0 : 1).map((s) => (s ? baseName(s) : ''));
    const pool = side === 'me' ? mine : theirs;
    return pool.filter((s) => !out.includes(baseName(s)) && (revive ? s.hpPercent <= 0 : s.hpPercent > 0)).map(baseName);
  };
  const doDoublesPlay = () =>
    run('Playing the turn…', async () => {
      if (!dOpts || !dPick) throw new Error('The menus are still loading.');
      const b = doublesBoard(takeDoublesHits());
      const snap: DSnap = { teams, field, marks, turn, timers };
      const leadsFirst = needDLeads;
      const r = await askDoublesPlay(mineAll, { ...b, just_in: dMarkFresh(turn), pivot_to: dPivot, outcomes: dOutcome, leads_first: leadsFirst }, dPick.me, dPick.opp);
      if (leadsFirst) setDLeadsDone(true);
      setDOutcome({ me: [{}, {}], opp: [{}, {}] });
      applyDoubles(r, snap, true);
      dPending.current = r.hits ?? null;
      // who Protected this turn (and still is out): their next Protect works 1 time in 3
      const streaks = (x: Record<string, { out: number | null; protect_streak?: number }>) =>
        Object.fromEntries(Object.entries(x).filter(([, m]) => m.out != null && (m.protect_streak ?? 0) > 0).map(([n, m]) => [n, m.protect_streak!]));
      dStreak.current = { turn: turn + 1, me: streaks(r.me), opp: streaks(r.opp) };
      const vols = (x: Record<string, DoublesPlayMonT>) =>
        Object.fromEntries(
          Object.entries(x)
            .filter(([, m]) => m.out != null && (m.cursed || m.disabled))
            .map(([n, m]) => [n, { cursed: !!m.cursed, disabled: m.disabled?.[0] ?? null, left: m.disabled?.[1] }]),
        );
      dCarry.current = { turn: turn + 1, me: vols(r.me), opp: vols(r.opp) };
      // their moves used this turn are seen (as singles): one their set lacks takes the place of one not seen yet
      for (const [n, m] of Object.entries(r.opp)) {
        const mv = m.out != null ? m.last_move : null;
        const x = mv && mv !== 'Struggle' ? theirs.find((t) => baseName(t) === n) : undefined;
        if (!x || !mv) continue;
        const moves = [...x.moves];
        const seen = [...mark(1, x).moves];
        let i = moves.indexOf(mv);
        if (i < 0) {
          i = moves.findIndex((y, j) => !seen[j] || !y);
          if (i < 0) continue;
          moves[i] = mv;
          // by name: the played turn has just replaced the set objects
          setTeams((old) => {
            const next: [Team, Team] = [old[0], old[1]];
            next[1] = { ...old[1], sets: old[1].sets.map((y) => (y.species && baseName(y) === n ? { ...y, moves } : y)) };
            return next;
          });
        }
        seen[i] = true;
        setMark(1, x, { moves: seen });
      }
      setDVolMap((o) => {
        const next = { ...o };
        (['me', 'opp'] as const).forEach((sd, i) => {
          for (const [n, m] of Object.entries(r[sd])) {
            if (m.out == null) continue;
            const k = `${i}:${n}`;
            next[k] = {
              ...(next[k] ?? {}),
              who: n,
              last_move: m.last_move ?? next[k]?.last_move,
              last_move_turn: m.last_move ? turn : next[k]?.last_move_turn,
              disabled: m.disabled?.[0] ?? undefined,
            };
          }
        });
        return next;
      });
      dLogTurn.current = turn + 1;
      // what the turn settled replaces your marks
      setDManual({});
      // this turn is played: the next answer is for the next turn, counted here and not again
      setDTurn(turn + 1);
      dPlayedTurn.current = turn + 1;
      setDTurnRes(null);
    });
  // Undo a played turn (or the leads coming in), as in singles
  type DSnap = { teams: [Team, Team]; field: FieldState; marks: Record<string, Marks>; turn: number; timers: Record<string, number> };
  const dUndo = useRef<DSnap | null>(null);
  const undoDoubles = () => {
    const s0 = dUndo.current;
    if (!s0) return;
    if (dPlayed?.events[0] === 'Leads come in:') setDLeadsDone(false);
    setTeams(() => s0.teams);
    setField(() => s0.field);
    setMarks(s0.marks);
    if (s0.turn !== turn) pendingTimers.current = () => s0.timers;
    else setTimers(s0.timers);
    setTurnRaw(s0.turn);
    dPending.current = null;
    dPlayedTurn.current = null;
    dUndo.current = null;
    dStreak.current = { turn: -1, me: {}, opp: {} };
    dCarry.current = { turn: -1, me: {}, opp: {} };
    setDPlayed(null);
  };
  // A replacement after a faint (as singles' send-in): through the engine, so Intimidate, weather and seeds apply; the
  // turn does not move on.
  // the turn the log on show belongs to (send-ins that turn are added to it)
  const dLogTurn = useRef(-1);
  const doDoublesSendIn = (side: 0 | 1, slot: number, x: PokemonSet) =>
    run(`${baseName(x)} comes in…`, async () => {
      const b = doublesBoard();
      // one of theirs not seen yet: it is one of their four now
      const opp = b.opp.map((o) => (side === 1 && o.species === baseName(x) ? { ...o, seen: true } : o));
      const snap: DSnap = { teams, field, marks, turn, timers };
      if (side === 1) markAppeared(x);
      const r = await askDoublesSendIn(mineAll, { ...b, opp }, side === 0 ? 'me' : 'opp', slot, baseName(x));
      // added under the turn's log (it is part of the same turn), not in place of it
      const before = dLogTurn.current === turn ? (dPlayed?.events ?? []) : [];
      dLogTurn.current = turn;
      applyDoubles({ ...r, events: [...before, `${baseName(x)} sent in:`, ...r.events] }, snap);
    });
  // Turn 1: the leads come out (Intimidate, weather / terrain, seeds) by themselves once all four are out, as in singles
  const [dLeadsDone, setDLeadsDone] = useState(false);
  const dOutNow = [...dSide(0), ...dSide(1)];
  const needDLeads =
    !singles && phase === 'battle' && oppLeadsReady && turn === 1 && !dLeadsDone && dOutNow.every((x) => !!x) && dOutNow.every((x) => Object.values(x!.boosts).every((v) => !v)) && !dPlayed;
  const doDoublesLeads = () =>
    run('The leads come out…', async () => {
      const b = doublesBoard();
      const snap: DSnap = { teams, field, marks, turn, timers };
      const r = await askDoublesLeads(mineAll, { ...b, just_in: dMarkFresh(turn) });
      setDLeadsDone(true);
      if (!r.events.length) return;
      applyDoubles({ ...r, events: ['Leads come in:', ...r.events] }, snap);
    });
  useEffect(() => {
    if (!open || up !== true || !live || !needDLeads || busy) return;
    const t = window.setTimeout(doDoublesLeads, 1500); // after you finish putting the leads out
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, up, live, needDLeads, busy, dOutNow.map((x) => x?.species).join()]);
  // write a doubles result into the calc: HP, status, stat stages, used-up items (yours), the field
  const applyDoubles = (r: DoublesPlay, snap?: DSnap, advance = false) => {
      dUndo.current = snap ?? null;
      setDPlayed(r);
      // turns left as the engine counted them (Damp Rock and the like); a played turn also counts the rest down
      const tt = r.field.turns;
      if (tt) {
        const sync = (old: Record<string, number>) => {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(old)) next[k] = advance ? Math.max(1, v - 1) : v;
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
        if (advance) pendingTimers.current = sync;
        else setTimers(sync);
      }
      for (const s of mineAll) {
        const x = r.me[baseName(s)];
        if (x && x.item_gone && s.item && !mark(0, s).gone) setMark(0, s, { gone: true });
        if (x?.mega && !mark(0, s).mega) setMark(0, s, { mega: true });
      }
      for (const s of theirs) {
        const x = r.opp[baseName(s)];
        if (x?.mega && !mark(1, s).mega) setMark(1, s, { mega: true });
      }
      setTeams((old) => {
        const upd = (t: Team, side: 'me' | 'opp'): Team => {
          // who is out after the turn (a switching move brought someone in): left = selected, right = partner
          const slotOf = (k: number) => t.sets.findIndex((s) => s.species && r[side][baseName(s)]?.out === k);
          const [l, rr] = [slotOf(0), slotOf(1)];
          return {
            ...t,
            active: l >= 0 ? l : t.active,
            partner: rr >= 0 ? rr : t.partner,
            sets: t.sets.map((s) => {
              const x = s.species ? r[side][baseName(s)] : undefined;
              if (!x) return s;
              const b = x.boosts;
              return { ...s, hpPercent: Math.round(x.hp_pct), status: x.status as PokemonSet["status"], boosts: { atk: b.atk, def: b.def, spa: b.spa, spd: b.spd, spe: b.spe } };
            }),
          };
        };
        return [upd(old[0], 'me'), upd(old[1], 'opp')];
      });
      setField((f) => ({
        ...f,
        weather: r.field.weather as FieldState['weather'],
        terrain: r.field.terrain as FieldState['terrain'],
        isTrickRoom: r.field.trick_room,
        attackerSide: { ...f.attackerSide, isTailwind: r.field.tailwind[0], isReflect: r.field.screens[0][0], isLightScreen: r.field.screens[0][1], isAuroraVeil: r.field.screens[0][2] },
        defenderSide: { ...f.defenderSide, isTailwind: r.field.tailwind[1], isReflect: r.field.screens[1][0], isLightScreen: r.field.screens[1][1], isAuroraVeil: r.field.screens[1][2] },
      }));
  };
  // `addHits`: measured hits not yet in the marks (just taken from the last played turn)
  // Illusion: what you took for `s` was their Zoroark. Zoroark takes its place with its HP, status and stat changes; what
  // was put down to `s` while disguised (moves, measured hits) is dropped, since it was Zoroark's.
  const revealIllusion = (s: PokemonSet) => {
    const z = theirs.find((x) => baseName(x).startsWith('Zoroark') && !isTheirOut(x) && !mark(1, x).ko);
    if (!z) return setError("Enter their Zoroark in their six first.");
    setTeams((old) => {
      const t = old[1];
      const i = t.sets.indexOf(s);
      const j = t.sets.indexOf(z);
      if (i < 0 || j < 0) return old;
      const sets = t.sets.map((x, k) =>
        k === j
          ? { ...x, hpPercent: s.hpPercent, status: s.status, boosts: { ...s.boosts } }
          : k === i
            ? { ...x, hpPercent: 100, status: '' as PokemonSet['status'], boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }
            : x,
      );
      const next: [Team, Team] = [old[0], old[1]];
      next[1] = { ...t, sets, active: t.active === i ? j : t.active, partner: t.partner === i ? j : t.partner };
      return next;
    });
    setMarks((old) => {
      const o = { ...old };
      const ks = `1:${baseName(s)}`;
      const kz = `1:${baseName(z)}`;
      o[kz] = { ...(o[kz] ?? blankMarks()), seen: true };
      // it may never have been out at all
      o[ks] = { ...(o[ks] ?? blankMarks()), seen: false, moves: [false, false, false, false], hits: [] };
      return o;
    });
    // same time out as the disguise had (Fake Out and the like)
    const f = dFresh.current[`1:${baseName(s)}`];
    if (f != null) dFresh.current[`1:${baseName(z)}`] = f;
    setOppLeads((l) => l.map((n) => (n === baseName(s) ? baseName(z) : n)));
  };
  // out on their side now (doubles: either slot)
  const isTheirOut = (s: PokemonSet) =>
    (!!theirActive && baseName(s) === baseName(theirActive)) || (!singles && !!dSide(1)[1] && baseName(s) === baseName(dSide(1)[1]!));
  // Protects in a row from the last played turn, by name: sent with the next turn's board while the same ones are out
  const dStreak = useRef<{ turn: number; me: Record<string, number>; opp: Record<string, number> }>({ turn: -1, me: {}, opp: {} });
  // Cursed and disabled moves from the last played turn, by name: kept while the same ones stay out (a disabled move
  // for 4 turns in all)
  type DVol = { cursed?: boolean; disabled?: string | null; left?: number };
  const dCarry = useRef<{ turn: number; me: Record<string, DVol>; opp: Record<string, DVol> }>({ turn: -1, me: {}, opp: {} });
  /** What you set by hand ('me:Raichu' / 'opp:Gengar'); null disabled = cleared by hand. Dropped once it leaves the field. */
  const [dManual, setDManual] = useState<Record<string, { cursed?: boolean; disabled?: string | null; at?: number }>>({});
  const dOutKey = [...dSide(0), ...dSide(1)].map((x) => (x ? baseName(x) : '')).join('|');
  useEffect(() => {
    const out = { me: dSide(0).map((x) => (x ? baseName(x) : '')), opp: dSide(1).map((x) => (x ? baseName(x) : '')) };
    setDManual((o) => {
      const keep = Object.fromEntries(Object.entries(o).filter(([k]) => {
        const [sd, n] = k.split(':') as ['me' | 'opp', string];
        return out[sd].includes(n);
      }));
      return Object.keys(keep).length === Object.keys(o).length ? o : keep;
    });
    setDVolMap((o) => {
      const keep = Object.fromEntries(Object.entries(o).filter(([k]) => {
        const [sd, n] = k.split(':');
        return (sd === '0' ? out.me : out.opp).includes(n);
      }));
      return Object.keys(keep).length === Object.keys(o).length ? o : keep;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dOutKey]);
  /** Cursed / disabled for one that is out now: your marks first, else what the engine left after the last played turn. */
  const dVolNow = (side: 'me' | 'opp', name: string): { cursed: boolean; disabled: string | null; left?: number } => {
    const c = dCarry.current;
    const passed = dTurn - c.turn;
    const cv = c.turn >= 0 && passed >= 0 ? c[side][name] : undefined;
    const left = cv?.disabled && cv.left ? cv.left - passed : 0;
    const man = dManual[`${side}:${name}`];
    // the battle view's Disabled tag (one per side, for the Pokémon it was set on)
    const bvDis = dVolMap[`${side === 'me' ? 0 : 1}:${name}`]?.disabled ?? null;
    const disabled = man && man.disabled !== undefined ? man.disabled : bvDis ?? (left > 0 ? cv!.disabled! : null);
    return {
      cursed: man?.cursed ?? !!cv?.cursed,
      disabled,
      left: man && man.disabled ? Math.max(1, 4 - (dTurn - (man.at ?? dTurn))) : left > 0 ? left : undefined,
    };
  };
  const dTurnsLeft = (): DoublesTurns => {
    const t = (k: string) => timersNow.current[k] ?? 0;
    return {
      weather: t('weather'),
      terrain: t('terrain'),
      trick_room: t('tr'),
      tailwind: [t('0:isTailwind'), t('1:isTailwind')],
      screens: ([0, 1] as const).map((sd) => [t(`${sd}:isReflect`), t(`${sd}:isLightScreen`), t(`${sd}:isAuroraVeil`)]),
    };
  };
  const doublesBoard = (addHits: Record<string, SeenHit[]> = {}) => {
      const [ml, mr] = dSide(0);
      const [tl, tr] = dSide(1);
      if (!ml && !mr) throw new Error('Put your two Pokémon on the field in the calc (left and right).');
      if (!tl && !tr) throw new Error("Put their two Pokémon on the field in the calc.");
      // the four you brought (Team setup), the two out always among them
      const four = (mine.length ? mine : mineAll.slice(0, 4)).slice();
      for (const s of [ml, mr]) if (s && !four.some((x) => baseName(x) === baseName(s))) four.unshift(s);
      const pos = buildPosition({ mine: four.slice(0, 4), mineActive: ml ? baseName(ml) : '', theirs, theirActive: tl ? baseName(tl) : '', marks, field, turn: dTurn });
      // Mega Evolved: the Mega mark (as singles; a holder shown in its Mega form has not Mega Evolved yet). Fainted: 0%
      for (const s of four.slice(0, 4)) {
        if (s.hpPercent <= 0) {
          pos.me.hp[baseName(s)] = 0;
          (pos.me.hp_abs as Record<string, number>)[baseName(s)] = 0;
        }
      }
      for (const o of pos.opp) {
        const s = theirs.find((x) => baseName(x) === o.species);
        if (!s) continue;
        if (s.hpPercent <= 0) o.hp = 0;
        if (addHits[o.species]) o.hits = [...o.hits, ...addHits[o.species]];
      }
      pos.opp_mega_used = pos.opp_mega_used || pos.opp.some((o) => o.mega);
      const out = (a?: PokemonSet, b?: PokemonSet) => [a ? baseName(a) : '', b ? baseName(b) : ''];
      const st = dStreak.current.turn === dTurn ? dStreak.current : { me: {}, opp: {} as Record<string, number> };
      const keepOut = (m: Record<string, number>, outNow: string[]) => Object.fromEntries(Object.entries(m).filter(([n]) => outNow.includes(n)));
      const oppStreak = keepOut(st.opp, out(tl, tr));
      const vol = (side: 'me' | 'opp', n: string) => {
        const v = dVolNow(side, n);
        return { cursed: v.cursed, disabled: v.disabled ? [v.disabled, v.left ?? 4] : null };
      };
      const myOut = out(ml, mr).filter(Boolean);
      const theirOut = out(tl, tr).filter(Boolean);
      return {
        ...pos,
        opp: pos.opp.map((o) => {
          const x = oppStreak[o.species] ? { ...o, protect_streak: oppStreak[o.species] } : o;
          return theirOut.includes(o.species) ? { ...x, ...vol('opp', o.species) } : x;
        }),
        me: {
          ...pos.me,
          protect_streak: keepOut(st.me, out(ml, mr)),
          cursed: Object.fromEntries(myOut.map((n) => [n, vol('me', n).cursed])),
          disabled: Object.fromEntries(myOut.map((n) => [n, vol('me', n).disabled])),
        },
        // turns left of the timed effects, as the panel counts them (an effect switched off in the calc is off)
        field: { ...pos.field, turns: dTurnsLeft() },
        bring: four.slice(0, 4).map(baseName),
        active_me: out(ml, mr),
        active_opp: out(tl, tr),
        opp_sets: oppSetsJson(teams[1].sets),
        game: gameId.current,
      };
  };
  // Auto: ask again shortly after the board stops changing
  const [dAuto, setDAuto] = useState<boolean>(() => load(D_AUTO_KEY, false));
  useEffect(() => save(D_AUTO_KEY, dAuto), [dAuto]);
  const dAutoKey = useRef('');
  const boardKey = (b: Record<string, unknown>) => JSON.stringify({ ...b, game: undefined });
  let dKeyNow = '';
  if (!singles && open) {
    try {
      dKeyNow = boardKey(doublesBoard());
    } catch {
      dKeyNow = '';
    }
  }
  useEffect(() => {
    if (!dAuto || singles || !open || up !== true || busy || !dKeyNow || dKeyNow === dAutoKey.current || needDLeads) return;
    const t = window.setTimeout(() => doDoublesTurn(true), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dAuto, dKeyNow, busy, up, open, singles, needDLeads]);
  const dOptsFor = useRef('');
  useEffect(() => {
    if (singles || !open || up !== true || !dKeyNow) return;
    if (dOptsFor.current === dKeyNow && dOpts) return;
    const t = window.setTimeout(() => {
      let b: ReturnType<typeof doublesBoard>;
      try {
        b = doublesBoard();
      } catch {
        return;
      }
      const key = dKeyNow;
      askDoublesOptions(mineAll, { ...b, just_in: Object.keys(dFresh.current).filter((k) => dFresh.current[k] === turn).map((k) => k.slice(2)) })
        .then((o) => {
          dOptsFor.current = key;
          const { pick, kept } = dMerged(o);
          setDOpts(o);
          setDPick(pick);
          if (!kept) {
            setDStep(0);
            setDAim(null);
            setDMegaOn({});
          }
          setDPivot({ me: dTurnRes?.pivot?.options[0]?.species ?? '', opp: '' });
        })
        .catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singles, open, up, dKeyNow]);
  // a new answer: back to the bot's suggestions
  useEffect(() => {
    if (dOpts) {
      const { pick: d, kept } = dMerged(dOpts);
      const m: Record<string, boolean> = {};
      for (const side of ['me', 'opp'] as const)
        for (const k of [0, 1]) if (dOpts[side][k].find((o) => o.index === d[side][k])?.action.startsWith('Mega + ')) m[`${side}${k}`] = true;
      setDMegaOn(m);
      if (!kept) {
        setDStep(0);
        setDAim(null);
      }
      setDPick(d);
      setDPivot({ me: dTurnRes?.pivot?.options[0]?.species ?? '', opp: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dTurnRes]);
  // Start the bring check by itself as soon as their six are in (team preview), so it is ready when you look; once per
  // pair of teams
  const bringSig = turn === 1 && theirs.length >= 6 && mineAll.length >= 6 ? [...mineAll, ...theirs].map((s) => baseName(s)).join(',') : '';
  const bringAsked = useRef('');
  const bringFor = useRef(''); // the teams the answer shown is for: a change of either six asks again
  const oppNames = theirs.map((s) => baseName(s));
  // their six exactly as last game: not entered yet for this game, so no bring check on it
  const sameAsLast = lastOpp.current.length >= 6 && oppNames.length >= 6 && oppNames.every((n) => lastOpp.current.includes(n));
  // some of last game's six still there: worth a look (a slot not retyped)
  const carried = turn === 1 && !sameAsLast ? oppNames.filter((n) => lastOpp.current.includes(n)) : [];
  useEffect(() => {
    if (!open || !ready || !bringSig || busy || sameAsLast || (bring && bringFor.current === bringSig) || bringAsked.current === bringSig) return;
    const t = window.setTimeout(() => {
      bringAsked.current = bringSig;
      doBring();
    }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, bringSig, busy, bring, sameAsLast]);

  const useBring = (o: { bring: string[]; lead?: string }) => {
    if (phase === 'preview') {
      setPrevSel({ bring: o.bring, leads: o.lead ? [o.lead] : [o.bring[0]] });
      return;
    }
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
        {singles ? (
          <label className="check ai-auto" title="Solve again by itself a moment after you change the board">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto
          </label>
        ) : (
          <label className="check ai-auto" title="Solve again by itself a moment after the board stops changing">
            <input type="checkbox" checked={dAuto} onChange={(e) => setDAuto(e.target.checked)} />
            Auto
          </label>
        )}
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
        {!singles && <p className="hint">Doubles: tap two of each side's icons to put them out (left, then right).</p>}
        {up === false && (
          <p className="ai-warn">
            The bot is not running. Double-click <b>start_gui.bat</b> in the ChampionsAI folder.
            <button onClick={() => pingBot().then(setUp)}>Check again</button>
          </p>
        )}

        <div className="ai-grid">
        <div className="ai-col">
        {phase === 'preview' ? (
          <section className="ai-board ai-preview">
            <h3>Team preview</h3>
            <p className="hint">
              Their six: mark the {LEADS_N === 1 ? 'one they lead with' : '2 they lead with'} ({prevOpp.length}/{LEADS_N}) if you know it, or tap them once the battle starts
            </p>
            <div className="ai-prev-row">
              {theirs.map((x) => {
                const n = baseName(x);
                const l = prevOpp.includes(n);
                return (
                  <span key={'t' + n} className={'ai-prev-mon' + (l ? ' on' : '')}>
                    <Sprite species={x.species} size={44} />
                    <span>{n}</span>
                    <span className="ai-prev-btns">
                      <button className={'bv-tag' + (l ? ' on' : '')} onClick={() => togglePrevOpp(n)}>
                        Lead
                      </button>
                    </span>
                  </span>
                );
              })}
            </div>
            <p className="hint">
              Your six: pick {BRING_N} to bring ({prevSel.bring.length}/{BRING_N}) and {LEADS_N === 1 ? 'your lead' : 'your 2 leads'} ({prevSel.leads.length}/{LEADS_N}), or
              take the bot's pick from What should I bring? (Use this).
            </p>
            <div className="ai-prev-row">
              {mineAll.map((x) => {
                const n = baseName(x);
                const b = prevSel.bring.includes(n);
                const l = prevSel.leads.includes(n);
                return (
                  <span key={'m' + n} className={'ai-prev-mon' + (b ? ' on' : '')}>
                    <Sprite species={x.species} size={44} />
                    <span>{n}</span>
                    <span className="ai-prev-btns">
                      <button className={'bv-tag' + (b ? ' on' : '')} onClick={() => togglePrevBring(n)}>
                        Bring
                      </button>
                      <button className={'bv-tag' + (l ? ' on' : '')} onClick={() => togglePrevLead(n)}>
                        Lead
                      </button>
                    </span>
                  </span>
                );
              })}
            </div>
            {megaHolders(prevSel.bring).length > 1 && (
              <p className="ai-left">Only one of {megaHolders(prevSel.bring).join(' and ')} can Mega Evolve (one Mega per battle).</p>
            )}
            <button className="primary ai-main-btn ai-next" disabled={prevSel.bring.length !== BRING_N || prevSel.leads.length !== LEADS_N} onClick={startBattle}>
              Start battle
            </button>
          </section>
        ) : (
        <section className="ai-board">
          <BattleView
            mine={mine}
            theirs={theirs}
            mineActive={mine.some((s) => mineActive && baseName(s) === baseName(mineActive)) ? mineActive : undefined}
            theirActive={theirActive?.species && oppLeadsReady ? theirActive : undefined}
            doubles={!singles}
            minePartner={!singles ? dSide(0)[1] : undefined}
            theirPartner={!singles && oppLeadsReady ? dSide(1)[1] : undefined}
            showdown
            onIllusion={theirs.some((x) => baseName(x).startsWith('Zoroark') && !isTheirOut(x) && !mark(1, x).ko) ? revealIllusion : undefined}
            mark={mark}
            setMark={setMark}
            isAppeared={(s) => appeared(s, mark(1, s), isTheirOut(s))}
            vol={vol}
            volOf={singles ? undefined : (sd, x) => dVolMap[`${sd}:${baseName(x)}`] ?? { who: baseName(x) }}
            turn={turn}
            patchVol={patchVol}
            patchSet={patchSet}
            sendOut={sendOut}
            field={field}
            setField={setField}
            timers={timers}
            onTimer={tapTimer}
          />
          {singles && ready && board && !myKo && (
            <div className="ai-play ai-dplay">
              <span className="hint" title="Pick what both sides did, then Play: the turn runs with average luck (middle damage roll, no crits, chance effects only when likely) and the board updates itself. Fix what luck changed (HP, a crit, a burn) by hand.">
                Play turn
              </span>
              {ssChooser()}
              <div className="sd-summary">{ssSummary()}</div>
              <button className={'primary ai-main-btn' + (next === 'play' ? ' ai-next' : '')} onClick={() => doPlay()} disabled={playBusy}>
                {playBusy ? 'Playing…' : 'Play'}
              </button>
            </div>
          )}
          {!singles && (
            <>
            {dOpts && dPick && !dPlayed?.replace.some(Boolean) && (
              <div className="ai-play ai-dplay">
                <span className="hint" title="Pick what both sides did, then Play: the turn is played 64 times and the typical result is written into the calc (HP, status, stat changes, the field, who is out). Fix what luck changed by hand.">
                  Play turn
                </span>
                {sdChooser()}
                <div className="sd-summary">{sdSummary()}</div>
                {(['me', 'opp'] as const).map((side) => (
                  <div key={'pv' + side}>
                    {dPivotNeeded(side) && (
                      <label>
                        then sends in
                        <select value={dPivot[side]} onChange={(e) => setDPivot((v) => ({ ...v, [side]: e.target.value }))}>
                          <option value="">{side === 'me' ? '(the healthiest)' : '(the healthiest seen)'}</option>
                          {dPivotChoices(side).map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                ))}
                <button className={'primary ai-main-btn' + (dTurnRes ? ' ai-next' : '')} onClick={doDoublesPlay} disabled={up !== true || !!busy}>
                  Play
                </button>
              </div>
            )}
            </>
          )}
          {!oppLeadsReady && (
            <p className="ai-left">
              Tap the {LEADS_N === 1 ? 'Pokémon they led with' : `two Pokémon they led with (${oppLeads.length}/2)`}: their icons, top right.{' '}
              <button className="link" onClick={() => setPhase('preview')}>
                Back to team preview
              </button>
            </p>
          )}
          <p className="hint">
            Tap a team icon when it comes in, drag an HP bar (or type the number), tap the move it just used. Changes here are the calc's own HP,
            status, stats and field.
          </p>
        </section>
        )}
        </div>
        <div className="ai-col">

        <section className="ai-answer">
          {!singles ? (
            <>
            {dPlayed && (
              <div className="sdl">
                {dPlayed.events.map((e, i) =>
                  e.startsWith('--- Turn') ? (
                    <div key={i} className="sdl-turn">
                      {e.replace(/-/g, '').trim()}
                    </div>
                  ) : (
                    <div key={i} className={'sdl-line' + (e.startsWith('   ') ? ' sub' : '')}>
                      {e}
                    </div>
                  ),
                )}
                <div className="hint">
                  {dPlayed.events[0] === 'Leads come in:' || dPlayed.events[0]?.endsWith('sent in:')
                    ? 'Through the engine (entry abilities applied); the turn does not move on.'
                    : 'The typical result of 64 runs. Fix HP, crits or chance effects to match the game.'}{' '}
                  {dUndo.current && (
                    <button className="link" onClick={undoDoubles}>
                      Undo
                    </button>
                  )}
                </div>
                {(['me', 'opp'] as const).flatMap((side) =>
                  Object.entries(dPlayed[side])
                    .filter(([, m]) => m.fainted_share > 0.1 && m.fainted_share < 0.9)
                    .map(([n, m]) => (
                      <p key={side + n} className="ai-left">
                        {n} fainted in {pct(m.fainted_share)} of the runs: check it in the game.
                      </p>
                    )),
                )}
                {dPlayed.winner != null && <p className="ai-left">{dPlayed.winner === 0 ? 'You win.' : 'They win.'}</p>}
              </div>
            )}
            <div className="ai-actions">
              <button className={'primary ai-main-btn' + (!dTurnRes ? ' ai-next' : '')} onClick={() => doDoublesTurn()} disabled={up !== true || !!busy}>
                {dPlayed?.replace.some(Boolean) ? 'Pick my replacement' : 'Solve this turn'}
              </button>
              <button
                className="ai-report"
                disabled={up !== true}
                title="Something looks wrong? Saves this board and what the bot said, to fix later"
                onClick={() => {
                  let board: Record<string, unknown> = {};
                  try {
                    board = doublesBoard();
                  } catch {
                    /* an incomplete board is saved as it is */
                  }
                  sendDoublesReport(mineAll, board, { turn_answer: dTurnRes, played: dPlayed, bring: dbring })
                    .then(() => setDReported('Saved'))
                    .catch((e) => setDReported('Could not save: ' + (e instanceof Error ? e.message : String(e))));
                  window.setTimeout(() => setDReported(''), 2500);
                }}
              >
                {dReported || 'Report'}
              </button>
              {busy ? (
                <span className="hint">{busy}</span>
              ) : oppLeadsReady ? (
                (() => {
                  const t = teams[1];
                  const downK = [t.active, t.partner].findIndex((i) => i != null && !!t.sets[i]?.species && (t.sets[i].hpPercent <= 0 || mark(1, t.sets[i]).ko));
                  if (downK < 0) return null;
                  const out = [t.active, t.partner].filter((i) => i != null).map((i) => baseName(t.sets[i!]));
                  return (
                    <span className="ai-theirsend">
                      <span className="hint">They sent in:</span>
                      {theirs
                        .filter((x) => !mark(1, x).ko && x.hpPercent > 0 && !out.includes(baseName(x)))
                        .map((x, i) => (
                          <button key={baseName(x)} className={i === 0 ? 'ai-next' : ''} onClick={() => doDoublesSendIn(1, downK, x)} title="Sends it in through the engine: entry abilities apply; the turn does not move on">
                            {baseName(x)}
                          </button>
                        ))}
                    </span>
                  );
                })()
              ) : null}
              {!busy &&
                phase === 'battle' &&
                (() => {
                  // one of yours fainted: who to send in, the bot's pick first when it has one
                  const t = teams[0];
                  const downK = [t.active, t.partner].findIndex((i) => i != null && !!t.sets[i]?.species && (t.sets[i].hpPercent <= 0 || mark(0, t.sets[i]).ko));
                  if (downK < 0) return null;
                  const out = [t.active, t.partner].filter((i) => i != null).map((i) => baseName(t.sets[i!]));
                  const pool = (mine.length ? mine : mineAll.slice(0, 4)).filter((x) => !mark(0, x).ko && x.hpPercent > 0 && !out.includes(baseName(x)));
                  if (!pool.length) return null;
                  const r = dTurnRes?.[downK === 0 ? 'left' : 'right'];
                  const top = r && !r.species ? r.options[0]?.action.replace(/^Switch to /, '') : undefined;
                  const order = top ? [...pool].sort((x, y) => (baseName(y) === top ? 1 : 0) - (baseName(x) === top ? 1 : 0)) : pool;
                  return (
                    <span className="ai-theirsend">
                      <span className="hint">You send in:</span>
                      {order.map((x, i) => (
                        <button key={baseName(x)} className={i === 0 && (top || order.length === 1) ? 'ai-next' : ''} onClick={() => doDoublesSendIn(0, downK, x)} title="Sends it in through the engine: entry abilities apply; the turn does not move on">
                          {baseName(x)}
                        </button>
                      ))}
                    </span>
                  );
                })()}
            </div>
            {error && <p className="err">{error}</p>}
            {dTurnRes && (
              <div className="ai-result">
                {(['left', 'right'] as const).map((k, slot) => {
                  const r = dTurnRes[k];
                  // an empty slot (yours fainted): its options are who to send in, each with a button that does it
                  const empty = !r?.species;
                  return r ? (
                    <div key={k}>
                      <h4>{r.species || 'Send in'}</h4>
                      {r.options.slice(0, 4).map((o, i) => {
                        const to = empty && o.action.startsWith('Switch to ') ? mineAll.find((x) => baseName(x) === o.action.slice(10)) : undefined;
                        return (
                        <div key={i} className={'ai-bring' + (i === 0 ? ' top' : '')}>
                          <div className="ai-opt-main">
                            <strong>{o.action}</strong>
                            {to && (
                              <button className={'ai-sendin' + (i === 0 ? ' ai-next' : '')} disabled={!!busy} onClick={() => doDoublesSendIn(0, slot, to)} title="Sends it in through the engine: entry abilities apply; the turn does not move on">
                                Send in
                              </button>
                            )}
                          </div>
                          <Bar v={o.p} />
                          <span className="ai-pct">{pct(o.p)}</span>
                        </div>
                        );
                      })}
                    </div>
                  ) : null;
                })}
                {dTurnRes.pivot && (
                  <div className="ai-result">
                    <h4>After {dTurnRes.pivot.move.split(' → ')[0]}, send in</h4>
                    {dTurnRes.pivot.options.map((o, i) => (
                      <div key={o.species} className={'ai-bring' + (i === 0 ? ' top' : '')}>
                        <div className="ai-opt-main">
                          <strong>{o.species}</strong>
                        </div>
                        <Bar v={o.win} />
                        <span className="ai-pct">{pct(o.win)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {dTurnRes.options && dTurnRes.options.length > 0 && (
                  <details open>
                    <summary>Together (win chance against their likely choices)</summary>
                    {dTurnRes.options
                      .filter((o, i) => i < 5 && (i === 0 || o.mix >= 0.02 || i < 3))
                      .map((o, i) => (
                        <div key={i} className={'ai-bring' + (i === 0 ? ' top' : '')}>
                          <div className="ai-opt-main">
                            <span>{[o.left, o.right].filter(Boolean).join(' + ')}</span>
                            <span className="hint"> · plays it {pct(o.mix)}</span>
                          </div>
                          <Bar v={o.win} />
                          <span className="ai-pct">{pct(o.win)}</span>
                        </div>
                      ))}
                  </details>
                )}
                {dTurnRes.theirs && dTurnRes.theirs.length > 0 && (
                  <details>
                    <summary>What they likely do</summary>
                    {dTurnRes.theirs.slice(0, 5).map((x, i) => (
                      <div key={i} className="hint">
                        {pct(x.p)} · {x.action}
                      </div>
                    ))}
                  </details>
                )}
                {dTurnRes.pairs && dTurnRes.pairs.length > 1 && (
                  <details>
                    <summary>Together</summary>
                    {dTurnRes.pairs.slice(0, 5).map((x, i) => (
                      <div key={i} className="hint">
                        {pct(x.p)} · {x.left} + {x.right}
                      </div>
                    ))}
                  </details>
                )}
                {dTurnRes.warnings.length > 0 && <p className="ai-warn">Left out: {dTurnRes.warnings.join('; ')}</p>}
                <p className="hint">
                  Turn {dTurn}, {dTurnRes.field[0].filter(Boolean).join(' + ')} vs {dTurnRes.field[1].filter(Boolean).join(' + ')}:{' '}
                  {pct(dTurnRes.win ?? (dTurnRes.value + 1) / 2)} to win.{' '}
                  {dTurnRes.games
                    ? `From ${dTurnRes.games.toLocaleString()} simulated games (${dTurnRes.seconds} s) across guesses of their sets${
                        dTurnRes.endgame ? ', endgame: up to 24 likeliest pairs a side, every game played to the end' : ', a few turns deep'
                      }; the % beside each is how often to pick it (mix it up).`
                    : 'Network only (no lookahead), a rough guide.'}{' '}
                </p>
              </div>
            )}
            </>
          ) : (
          <>
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
            <div className="sdl">
              {played.events.map((e, i) =>
                e.startsWith('--- Turn') ? (
                  <div key={i} className="sdl-turn">
                    {e.replace(/-/g, '').trim()}
                  </div>
                ) : (
                  <div key={i} className={'sdl-line' + (e.startsWith('   ') ? ' sub' : '')}>
                    {e}
                  </div>
                ),
              )}
              <div className="hint">
                {played.sent ? 'Sent in through the engine (hazards and entry abilities applied).' : `Turn ${played.turn} played with average luck: fix HP, crits or chance effects to match the game.`}{' '}
                <button className="link" onClick={undoPlay}>
                  Undo
                </button>
              </div>
            </div>
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
                  <div className="ai-opt-main">{lineLabel(r.action)}</div>
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
          </>
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
          {sameAsLast && <p className="ai-left">Their six are still last game's: enter this opponent's team.</p>}
          {carried.length > 0 && carried.length < 6 && (
            <p className="ai-left">Also on last game's team: {carried.join(', ')}. Still on this team?</p>
          )}
          {bring && bringFor.current && bringFor.current !== bringSig && <p className="ai-left">The teams changed since this answer: asking again…</p>}
          {!singles ? (
            <>
              <button onClick={doDoublesBring} disabled={up !== true || !!busy} title="Which 4 of your six, and which 2 lead: simulated games">
                What should I bring?
              </button>
            {dbring && (
              <div className="ai-result">
                {dbring.sig !== dSig && (
                  <p className="ai-left">The teams changed since this answer: ask again.</p>
                )}
                {dbring.options.map((o, i) => (
                  <div key={i} className={'ai-bring' + (i === 0 ? ' top' : '')}>
                    <div className="ai-opt-main">
                      <strong>
                        Lead {o.lead[0]} + {o.lead[1]}
                      </strong>
                      <span className="hint"> · back {o.back.join(' + ')}</span>
                      {megaHolders([...o.lead, ...o.back]).length > 1 && (
                        <div className="hint ai-bad">Only one of {megaHolders([...o.lead, ...o.back]).join(' and ')} can Mega Evolve.</div>
                      )}
                      {o.zoroark_as != null && <div className="hint">{zoroarkNote(o.zoroark_as)}</div>}
                      {o.win != null && (
                        <div className={'hint' + (o.worst != null && o.worst < 0.35 ? ' ai-bad' : '')}>
                          picks it {pct(o.p)}
                          {o.worst != null ? ` · worst ${pct(o.worst)} against their worst-case bring` : ''}
                        </div>
                      )}
                    </div>
                    <Bar v={o.win ?? o.p} />
                    <span className="ai-pct">{pct(o.win ?? o.p)}</span>
                    <button onClick={() => useDoublesBring(o)} title="Put these four first in your team with the two leads out">
                      Use this
                    </button>
                  </div>
                ))}
                <p className="hint">
                  {dbring.games
                    ? `Win chance from ${dbring.games.toLocaleString()} simulated games (${dbring.seconds} s) against what they are likely to bring${
                        dbring.their_likely?.[0] ? ` (most likely: ${dbring.their_likely[0].lead.join(' + ')} lead, ${dbring.their_likely[0].back.join(' + ')} back)` : ''
                      }. `
                    : `How strongly the bot picks each. Its guess: ${pct((dbring.value + 1) / 2)} to win. `}
                  From {dbring.run} at update {dbring.update.toLocaleString()}; still learning, so a rough guide.
                </p>
              </div>
            )}
            </>
          ) : (
          <>
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
                      {megaHolders(o.bring).length > 1 && <div className="hint ai-bad">Only one of {megaHolders(o.bring).join(' and ')} can Mega Evolve.</div>}
                      {o.zoroark_as != null && <div className="hint">{zoroarkNote(o.zoroark_as)}</div>}
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
          </>
          )}
          <h4>
            The {singles ? 'three' : 'four'} you brought ({brought.length}/{BRING_N})
          </h4>
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
          <p className="hint">Ticked by itself when one comes in. They bring {singles ? 'three' : 'four'} of six, so the rest are treated as possible picks.</p>
          <div className="ai-flags">
            {theirs.map((s) => {
              const name = baseName(s);
              return (
                <label key={'a' + name} className="check">
                  <input type="checkbox" checked={appeared(s, mark(1, s), isTheirOut(s))} onChange={(e) => setMark(1, s, { seen: e.target.checked })} />
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
