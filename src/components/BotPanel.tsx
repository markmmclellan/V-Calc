import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldState } from '../lib/calc';
import {
  askBringCheck,
  askCheck,
  askQuick,
  askReplace,
  askSolve,
  appeared,
  baseName,
  blankMarks,
  buildPosition,
  getBotUrl,
  pingBot,
  type BringCheck,
  type Marks,
  type MoveCheck,
  type SolveResult,
  type Vol,
} from '../lib/bot';
import type { PokemonSet } from '../lib/model';
import type { Team } from './TeamSide';
import Sprite from './Sprite';

interface Props {
  open: boolean;
  teams: [Team, Team];
  /** Edit the battle from the panel (who is out, HP, status), so the main calc can stay as it is. */
  setTeams: (f: (old: [Team, Team]) => [Team, Team]) => void;
  field: FieldState;
  skipped: string[]; // species of yours left at home (set by What to bring)
  singles: boolean;
  /** Goes up each time the battle is reset (Reset battle, or the opponent's team cleared): a new game. */
  battleId: number;
  /** Same function What to bring uses: put these first, select the lead. */
  onApplyBring: (bring: number[], leads: number[]) => void;
  onResetBattle: () => void;
  onClose: () => void;
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
/** Options this close (win chance against their likely play) are a toss-up: the simulation cannot tell them apart. */
const CLOSE = 0.02;
/** Battle-text effects on the Pokémon that is out: [field, label, what it means]. */
const VOL_TOGGLES: [keyof Vol, string, string][] = [
  ['yawn', 'Drowsy', 'Hit by Yawn last turn: falls asleep at the end of this turn'],
  ['taunt', 'Taunted', 'Cannot use status moves'],
  ['trapped', 'Trapped', 'Mean Look, Block, Spirit Shackle, Anchor Shot, Jaw Lock: cannot switch'],
  ['substitute', 'Sub', 'Behind a Substitute'],
  ['confused', 'Confused', 'Confused'],
];
const Bar = ({ v }: { v: number }) => (
  <div className="ai-bar">
    <span style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
  </div>
);

type Advice = { pSwitch?: number; title: string; rows: { label: string; v: number; stay?: number; sw?: number; net?: number; heur?: number; ko?: number; n?: number }[]; quick?: string; note?: string };

/**
 * Advice from the local simulation bot, docked beside the calc. It reads the battle from V-Calc, lets you update the
 * board from here (who is out, HP, status, fainted), keeps track of what it can (who has appeared, the turn number),
 * and re-solves the turn by itself whenever the board changes.
 */
/** Board changes within this long of the last answer are you still entering the same turn. */
const SAME_TURN_MS = 20_000;
/** Time the bring check may take at team preview. */
const BRING_SECS = 20;

export default function BotPanel({ open, teams, setTeams, field, skipped, singles, battleId, onApplyBring, onResetBattle, onClose }: Props) {
  const [up, setUp] = useState<boolean | null>(null);
  const [marks, setMarks] = useState<Record<string, Marks>>(() => load(MARKS_KEY, {}));
  const [auto, setAuto] = useState<boolean>(() => load(AUTO_KEY, true));
  const [secs, setSecs] = useState<number>(() => load(SECS_KEY, 8)); // time the bot may think per answer
  const [picked, setPicked] = useState<string[] | null>(null); // base names; null = follow What to bring
  const [turn, setTurnRaw] = useState(1);
  // effects on the two Pokémon that are out (yours, theirs); a side's are cleared when its Pokémon switches out
  const [vol, setVol] = useState<[Vol, Vol]>([{}, {}]);
  const patchVol = (side: 0 | 1, patch: Partial<Vol>) =>
    setVol((old) => {
      const next: [Vol, Vol] = [old[0], old[1]];
      next[side] = { ...old[side], ...patch };
      return next;
    });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [bring, setBring] = useState<BringCheck | null>(null);
  const [solved, setSolved] = useState<(SolveResult & { key: string }) | null>(null);
  const [advice, setAdvice] = useState<(Advice & { key: string }) | null>(null);
  // the last call to the bot: its board and turn, to tell a new turn from the same one
  const last = useRef<{ key: string; turnKey: string; bring: string; turn: number; kind: 'solve' | 'replace'; at: number } | null>(null);
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
    setSolved(null);
    setAdvice(null);
    setBring(null);
    setPicked(null);
    setError('');
    setLive(false);
    setVol([{}, {}]);
    last.current = null;
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
  const prevOut = useRef(outNames);
  useEffect(() => {
    const [a, b] = prevOut.current;
    prevOut.current = outNames;
    const changed = [a !== outNames[0], b !== outNames[1]];
    if (!changed[0] && !changed[1]) return;
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
  const sendOut = (side: 0 | 1, s: PokemonSet) => {
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
  const position = () => {
    if (mine.length !== 3) throw new Error('Tick the three Pokémon you brought (Setup, below).');
    if (!mineActive || !mine.some((s) => baseName(s) === baseName(mineActive))) throw new Error('Pick which of your three is out.');
    if (!theirActive) throw new Error("Add the opposing Pokémon that is out and pick it.");
    if (mark(1, theirActive).ko) throw new Error('Their Pokémon is marked fainted: pick the one they sent out.');
    return buildPosition({ mine, mineActive: baseName(mineActive), theirs, theirActive: baseName(theirActive), marks, field, turn, vol });
  };
  let board: ReturnType<typeof buildPosition> | null = null;
  let boardProblem = '';
  try {
    board = position();
  } catch (e) {
    boardProblem = e instanceof Error ? e.message : String(e);
  }
  const myKo = !!mineActive && mark(0, mineActive).ko;
  // the board without the turn number: a change here means something happened
  const key = board ? JSON.stringify({ ...board, turn: 0 }) + (myKo ? '|replace' : '') : '';
  // Only what a turn changes: who is out, HP, status, boosts, the field. Revealed moves, items and Mega marks are
  // facts you learn, not a turn going by.
  const turnKey = board
    ? JSON.stringify({
        me: [board.me.active, board.me.hp, board.me.status, board.me.boosts],
        opp: board.opp.map((o) => [o.species, o.hp, o.status, o.boosts, o.active]),
        field: board.field,
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

  /** Ask the bot about the current board: the replacement if yours fainted, otherwise the turn as a guessing game. */
  const solveNow = () => {
    if (!board) {
      setError(boardProblem);
      return;
    }
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
    if (l && l.kind === 'solve' && l.turn === turn && l.turnKey !== turnKey && l.bring === bringKey && now - l.at > SAME_TURN_MS) t = turn + 1;
    if (t !== turn) setTurnRaw(t);
    const pos = { ...board, turn: t, game: gameId.current };
    const kind = myKo ? 'replace' : 'solve';
    last.current = { key, turnKey, bring: bringKey, turn: t, kind, at: now };
    const k = key;
    if (kind === 'replace')
      return run('Picking your replacement…', async () => {
        const r = await askReplace(mineAll, pos);
        setSolved(null);
        setAdvice({
          key: k,
          title: 'Best replacement',
          rows: r.replace.map((x) => ({ label: x.action, v: x.win, n: x.games })),
          note: r.replace.length ? 'Each replacement is played out from the new board.' : r.note,
        });
      });
    return run(`Solving this turn (about ${secs} s)…`, async () => {
      const r = await askSolve(mineAll, pos, secs);
      setAdvice(null);
      setSolved({ ...r, key: k });
    });
  };

  // Auto: re-solve shortly after the board stops changing.
  useEffect(() => {
    if (!open || !auto || !live || !ready || busy || !key || last.current?.key === key) return;
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
      const pos = { ...board, turn, game: gameId.current };
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

  // ---- the board: who is out, HP, status, fainted ----
  const sideRow = (side: 0 | 1, list: PokemonSet[], out: PokemonSet | undefined) => {
    const m = out ? mark(side, out) : null;
    return (
      <div className="ai-side">
        <div className="ai-mons">
          {list.map((s) => {
            const mk = mark(side, s);
            const isOut = !!out && baseName(s) === baseName(out);
            const shown = side === 1 && !isOut && appeared(s, mk, false);
            return (
              <button
                key={baseName(s)}
                className={'ai-mon' + (isOut ? ' out' : '') + (mk.ko ? ' ko' : '') + (shown ? ' seen' : '')}
                onClick={() => sendOut(side, s)}
                title={`${s.species}${mk.ko ? ' (fainted)' : ''}: click when it comes in`}
              >
                <Sprite species={s.species} size={side === 1 ? 30 : 34} />
                <span>{mk.ko ? 'KO' : `${Math.round(s.hpPercent)}%`}</span>
              </button>
            );
          })}
        </div>
        {out && m && (
          <div className="ai-out">
            <strong>{out.species}</strong>
            <button className={'ai-toggle' + (m.ko ? ' on bad' : '')} onClick={() => setMark(side, out, { ko: !m.ko })} title="It fainted">
              Fainted
            </button>
            <button className={'ai-toggle' + (m.mega ? ' on' : '')} onClick={() => setMark(side, out, { mega: !m.mega })} title="It has Mega Evolved">
              Mega
            </button>
            <button className={'ai-toggle' + (m.gone ? ' on' : '')} onClick={() => setMark(side, out, { gone: !m.gone })} title="Its held item is gone (berry eaten, Air Balloon popped, knocked off)">
              Item gone
            </button>
          </div>
        )}
        {out && m && (
          <div className="ai-out ai-vol">
            <label className="ai-inline" title="The move it used last turn. Encore locks it into this one.">
              Last move
              <select
                value={vol[side].last_move ?? ''}
                onChange={(e) => {
                  const mv = e.target.value;
                  patchVol(side, { last_move: mv || undefined });
                  // a move it used is a move you have seen
                  const k = out.moves.indexOf(mv);
                  if (side === 1 && mv && k >= 0 && !m.moves[k]) setMark(1, out, { moves: m.moves.map((x, j) => (j === k ? true : x)) });
                }}
              >
                <option value="">?</option>
                {out.moves.filter(Boolean).map((mv) => (
                  <option key={mv} value={mv}>
                    {mv}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={'ai-toggle' + (vol[side].encore ? ' on' : '')}
              disabled={!vol[side].encore && !vol[side].last_move}
              onClick={() => patchVol(side, { encore: vol[side].encore ? undefined : vol[side].last_move })}
              title={vol[side].encore ? `Encored into ${vol[side].encore}` : 'Encored into its last move (pick the last move first)'}
            >
              {vol[side].encore ? `Encore: ${vol[side].encore}` : 'Encored'}
            </button>
            {VOL_TOGGLES.map(([k, l, t]) => (
              <button key={k} className={'ai-toggle' + (vol[side][k] ? ' on' : '')} title={t} onClick={() => patchVol(side, { [k]: !vol[side][k] })}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

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

  const resultStale = (k: string) => k !== key;
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
          <h3>You</h3>
          {sideRow(0, mine, mineActive)}
          <h3>Them</h3>
          {sideRow(1, theirs, theirActive)}
          <p className="hint">
            Tap a Pokémon when it comes in. HP, status, boosts and the field (including Leech Seed and Infestation-type binding) are set in the calc;
            the AI reads them from there.
          </p>
        </section>
        </div>
        <div className="ai-col">

        <section className="ai-answer">
          <div className="ai-actions">
            <button className="primary" onClick={solveNow} disabled={!ready || !!busy}>
              {myKo ? 'Pick my replacement' : 'Solve this turn'}
            </button>
            {busy ? (
              <span className="hint">{busy}</span>
            ) : boardProblem ? (
              <span className="hint">{boardProblem}</span>
            ) : auto && !live ? (
              <span className="hint">Auto starts once you tap who is out or press Solve.</span>
            ) : null}
          </div>
          {error && <p className="err">{error}</p>}

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
                  .map((c) => `${c.their_action} ${pct(c.prob)}`)
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
        </div>
        <div className="ai-col">
        {theirSeen.length > 0 && (
          <section>
            <h3>Their sets: tap what you've seen</h3>
            <p className="hint">Unticked moves, item and ability are guessed from usage data.</p>
            {theirSeen.map((s) => (
              <div key={'s' + baseName(s)} className="ai-seenrow">
                <Sprite species={s.species} size={26} />
                <div className="ai-seen">{seenChips(s)}</div>
              </div>
            ))}
          </section>
        )}
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
        </div>
        </div>
      </div>
    </section>
  );
}
