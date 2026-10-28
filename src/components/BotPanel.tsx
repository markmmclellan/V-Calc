import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FieldState } from '../lib/calc';
import {
  askBring,
  askCheck,
  askQuick,
  askReplace,
  askSolve,
  appeared,
  baseName,
  blankMarks,
  buildPosition,
  pingBot,
  type BringOption,
  type Marks,
  type MoveCheck,
  type SolveResult,
} from '../lib/bot';
import type { PokemonSet } from '../lib/model';
import type { Team } from './TeamSide';
import Sprite from './Sprite';

interface Props {
  teams: [Team, Team];
  field: FieldState;
  skipped: string[]; // species of yours left at home (set by What to bring)
  singles: boolean;
  /** Same function What to bring uses: put these first, select the lead. */
  onApplyBring: (bring: number[], leads: number[]) => void;
  onClose: () => void;
}

const MARKS_KEY = 'champions-calc:ai-marks:v1';
const loadMarks = (): Record<string, Marks> => {
  try {
    return JSON.parse(localStorage.getItem(MARKS_KEY) ?? '{}') as Record<string, Marks>;
  } catch {
    return {};
  }
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const Bar = ({ v }: { v: number }) => (
  <div className="ai-bar">
    <span style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
  </div>
);

/** Advice from the local simulation bot, built from what is already entered in V-Calc. */
export default function BotPanel({ teams, field, skipped, singles, onApplyBring, onClose }: Props) {
  const [up, setUp] = useState<boolean | null>(null);
  const [marks, setMarks] = useState<Record<string, Marks>>(loadMarks);
  const [picked, setPicked] = useState<string[] | null>(null); // base names; null = follow What to bring
  const [turn, setTurn] = useState(5);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [bring, setBring] = useState<{ options: BringOption[]; win: number } | null>(null);
  const [solved, setSolved] = useState<SolveResult | null>(null);
  const [advice, setAdvice] = useState<{ pSwitch?: number; title: string; rows: { label: string; v: number; stay?: number; sw?: number; net?: number; heur?: number; ko?: number; n?: number }[]; quick?: string; note?: string } | null>(null);

  useEffect(() => {
    pingBot().then(setUp);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
    } catch {
      /* storage unavailable */
    }
  }, [marks]);

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

  const mark = (side: 0 | 1, s: PokemonSet): Marks => marks[`${side}:${baseName(s)}`] ?? blankMarks();
  const setMark = (side: 0 | 1, s: PokemonSet, patch: Partial<Marks>) =>
    setMarks((old) => ({ ...old, [`${side}:${baseName(s)}`]: { ...mark(side, s), ...patch } }));
  const toggleBrought = (name: string) =>
    setPicked((old) => {
      const cur = old ?? defaultBrought;
      return cur.includes(name) ? cur.filter((n) => n !== name) : cur.length >= 3 ? cur : [...cur, name];
    });

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

  const ready = up === true && singles;

  const doBring = () =>
    run('Choosing a bring…', async () => {
      if (theirs.length < 6) throw new Error(`Enter all six of the opponent's Pokémon first (${theirs.length} so far).`);
      if (mineAll.length < 6) throw new Error(`The bot picks 3 from your six; you have ${mineAll.length} entered.`);
      setBring(await askBring(mineAll, theirs));
    });

  const useBring = (o: BringOption) => {
    const idx = o.bring.map((n) => mineAll.findIndex((s) => baseName(s) === n)).filter((i) => i >= 0);
    onApplyBring(idx, [0]);
    setPicked(null);
  };

  /** The battle as the bot sees it, after checking that V-Calc has what it needs. */
  const position = () => {
    if (mine.length !== 3) throw new Error('Tick the three Pokémon you brought.');
    if (!mineActive || !mine.some((s) => baseName(s) === baseName(mineActive))) throw new Error('Select (in V-Calc) the Pokémon of yours that is out, and make sure it is one of the three brought.');
    if (!theirActive) throw new Error("Add the opposing Pokémon that is out and select it in V-Calc.");
    if (mark(1, theirActive).ko) throw new Error("The opponent's selected Pokémon is marked fainted: select the one they sent out.");
    return buildPosition({ mine, mineActive: baseName(mineActive), theirs, theirActive: baseName(theirActive), marks, field, turn });
  };

  const doSolve = () =>
    run('Solving the turn as a guessing game (about 15–30 s)…', async () => {
      const pos = position();
      if (mark(0, mineActive!).ko) throw new Error('Your Pokémon is fainted: use “What should I do this turn?” to pick the replacement.');
      setSolved(await askSolve(mineAll, pos));
    });

  const doAdvice = () =>
    run('Simulating each option…', async () => {
      const pos = position();
      if (mark(0, mineActive!).ko) {
        const r = await askReplace(mineAll, pos);
        setAdvice({
          title: 'Best replacement',
          rows: r.replace.map((x) => ({ label: x.action, v: x.win, n: x.games })),
          note: r.replace.length ? 'Each replacement is played out from the new board.' : r.note,
        });
        return;
      }
      const c = await askCheck(mineAll, pos);
      let quick = '';
      try {
        const q = await askQuick(mineAll, pos);
        const t = q.actions[0];
        if (t) quick = `${t.action} (${pct(t.p)} sure)`;
      } catch {
        /* the table is the answer; the quick read is optional */
      }
      setAdvice({ title: 'Best option by simulation', pSwitch: c.checked[0]?.p_switch, rows: c.checked.map((x: MoveCheck) => ({ label: x.action, v: x.win, stay: x.win_stay, sw: x.win_switch, net: x.win_net, heur: x.win_heur, ko: x.ko_now, n: x.games })), quick });
    });

  const flags = (side: 0 | 1, s: PokemonSet) => {
    const m = mark(side, s);
    const box = (key: 'ko' | 'mega' | 'gone', label: string, title: string) => (
      <label className="check" title={title}>
        <input type="checkbox" checked={m[key]} onChange={(e) => setMark(side, s, { [key]: e.target.checked })} />
        {label}
      </label>
    );
    return (
      <div className="ai-flags">
        {box('ko', "Fainted", 'This Pokémon has fainted')}
        {box('mega', 'Mega Evolved', 'Already Mega Evolved this battle')}
        {box('gone', 'Item used up', 'Held item is gone (berry eaten, Air Balloon popped, knocked off)')}
      </div>
    );
  };

  const seenChips = (s: PokemonSet) => {
    const m = mark(1, s);
    const chips: ReactNode[] = [];
    s.moves.forEach((mv, i) => {
      if (!mv) return;
      chips.push(
        <label key={'m' + i} className="check chip" title="Tick only moves you have actually seen it use">
          <input type="checkbox" checked={m.moves[i] ?? false} onChange={(e) => setMark(1, s, { moves: m.moves.map((x, j) => (j === i ? e.target.checked : x)) })} />
          {mv}
        </label>,
      );
    });
    if (s.item)
      chips.push(
        <label key="item" className="check chip" title="Tick if you know it holds this item">
          <input type="checkbox" checked={m.item} onChange={(e) => setMark(1, s, { item: e.target.checked })} />
          {s.item}
        </label>,
      );
    if (s.ability)
      chips.push(
        <label key="ab" className="check chip" title="Tick if you know this is its ability">
          <input type="checkbox" checked={m.ability} onChange={(e) => setMark(1, s, { ability: e.target.checked })} />
          {s.ability}
        </label>,
      );
    return chips;
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ai" role="dialog" aria-modal="true" aria-label="AI advice">
        <header className="modal-head">
          <h2>
            AI advice <span className="hint">· simulation bot, Singles</span>
          </h2>
          <button className="icon close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="ai-body">
          {!singles && <p className="ai-warn">The bot plays Singles only. Switch V-Calc to Singles.</p>}
          {up === false && (
            <p className="ai-warn">
              The bot is not running. Double-click <b>start_gui.bat</b> in the ChampionsAI folder, then reopen this panel.
              <button onClick={() => pingBot().then(setUp)}>Check again</button>
            </p>
          )}
          {up === null && <p className="hint">Looking for the bot…</p>}
          {error && <p className="err">{error}</p>}

          <section>
            <h3>Team preview</h3>
            <p className="hint">Uses your six and the opponent's six as entered in V-Calc. Your builds come from V-Calc, so edits there count.</p>
            <button className="primary" onClick={doBring} disabled={!ready || !!busy}>
              What should I bring?
            </button>
            {bring && (
              <div className="ai-result">
                {bring.options.slice(0, 4).map((o, i) => (
                  <div key={i} className={'ai-opt' + (i === 0 ? ' top' : '')}>
                    <div className="ai-opt-main">
                      <strong>Lead {o.lead}</strong>
                      <span className="hint"> bring {o.bring.join(', ')}</span>
                    </div>
                    <Bar v={o.p} />
                    <span className="ai-pct">{pct(o.p)}</span>
                    <button onClick={() => useBring(o)} title="Put these first in your team, select the lead, and mark the rest as not brought">
                      Use this
                    </button>
                  </div>
                ))}
                <p className="hint">Estimated win chance {pct(bring.win)}. The percentages are how strongly the bot prefers each option.</p>
              </div>
            )}
          </section>

          <section>
            <h3>This turn</h3>
            <p className="hint">
              HP, boosts, status, field and which Pokémon is out come from V-Calc. Tick what V-Calc has no place for, and tick only what you have actually seen
              of their sets; the rest is assumed to be the usual build.
            </p>
            <h4>Your team</h4>
            <p className="hint">Tick the three you brought ({brought.length}/3). The one selected in V-Calc is the one that is out.</p>
            {mineAll.map((s) => {
              const name = baseName(s);
              const inBring = brought.includes(name);
              return (
                <div key={'y' + name} className={'ai-card' + (inBring ? '' : ' ai-off') + (mark(0, s).ko ? ' ai-ko' : '')}>
                  <div className="ai-who">
                    <label className="check">
                      <input type="checkbox" checked={inBring} onChange={() => toggleBrought(name)} />
                      <Sprite species={s.species} size={28} />
                      <strong>{name}</strong>
                    </label>
                    <span className="hint">{Math.round(s.hpPercent)}%</span>
                    {mineActive && name === baseName(mineActive) && <span className="ai-tag">out now</span>}
                  </div>
                  {inBring && flags(0, s)}
                </div>
              );
            })}
            <h4>Opponent</h4>
            <p className="hint">Tick only what you have actually seen; unticked moves, item and ability are assumed to be the usual ones.</p>
            {theirs.map((s) => {
              const name = baseName(s);
              return (
                <div key={'t' + name} className={'ai-card' + (mark(1, s).ko ? ' ai-ko' : '')}>
                  <div className="ai-who">
                    <Sprite species={s.species} size={28} />
                    <strong>{name}</strong>
                    <span className="hint">{Math.round(s.hpPercent)}%</span>
                    {theirActive && name === baseName(theirActive) && <span className="ai-tag">out now</span>}
                  </div>
                  <div className="ai-flags">
                    <label className="check" title="Has this one been sent out in this battle? The opponent only brings three of their six, so ones that haven't appeared are treated as possible picks for the remaining slots.">
                      <input
                        type="checkbox"
                        checked={appeared(s, mark(1, s), !!theirActive && name === baseName(theirActive))}
                        onChange={(e) => setMark(1, s, { seen: e.target.checked })}
                      />
                      Has appeared
                    </label>
                  </div>
                  {flags(1, s)}
                  <div className="ai-seen">
                    <span className="hint">Seen / known:</span>
                    {seenChips(s)}
                  </div>
                </div>
              );
            })}
            <div className="ai-actions">
              <label>
                Turn{' '}
                <input type="number" min={1} max={60} value={turn} onChange={(e) => setTurn(Math.max(1, Math.min(60, parseInt(e.target.value || '1', 10))))} />
              </label>
              <button className="primary" onClick={doAdvice} disabled={!ready || !!busy}>
                What should I do this turn?
              </button>
              <button
                onClick={doSolve}
                disabled={!ready || !!busy}
                title="Treats the turn as a guessing game: you and the opponent pick at the same time. Gives how often to pick each option and what they are likely to do. With two or fewer Pokémon a side it works out every damage roll, crit and miss of the next two turns exactly."
              >
                Solve as a guessing game
              </button>
              {busy && <span className="hint">{busy}</span>}
            </div>
            {solved && (
              <div className="ai-result">
                <h4>
                  {solved.endgame ? `Endgame, worked out exactly (${solved.depth} turn${solved.depth === 1 ? '' : 's'} ahead)` : 'Turn solved as a guessing game'}
                  <span className="hint"> · win chance {pct(solved.value)}</span>
                </h4>
                <div className="ai-colhead hint">
                  <span />
                  <span />
                  <span title="How often to pick this option. A mix means no single choice is best against a smart opponent: roll for it, don't always pick the top one.">Pick</span>
                  <span title="Win chance against the opponent's predicted play (listed below)">Vs their play</span>
                  <span title="Win chance if they make the best reply to this option">Worst case</span>
                </div>
                {solved.mine.map((r, i) => (
                  <div key={i} className={'ai-opt2' + (i === 0 ? ' top' : '')}>
                    <div className="ai-opt-main">{r.action}</div>
                    <Bar v={r.vs_their_play} />
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
                  {solved.endgame
                    ? 'Every damage roll, crit, miss and added effect of this turn and the next is counted with its real chance (later rolls are grouped), and both turns are solved as guessing games; positions still open after that are scored by HP left. '
                    : 'Each pairing of your option and their reply is played out by the bot for both sides, then the table is solved as a guessing game. '}
                  Their sets are sampled from usage data, using what you ticked as seen. Their predicted play is what a smart opponent would do, not a read on this player.
                  {solved.cut_short ? ' The time limit cut the search short, so treat close numbers as ties.' : ''}
                </p>
              </div>
            )}
            {advice && (
              <div className="ai-result">
                <h4>{advice.title}</h4>
                {advice.rows.some((r) => r.stay !== undefined) && (
                  <div className="ai-colhead hint">
                    <span />
                    <span />
                    <span title="Win rate if the opponent stays in and attacks this turn">They stay in</span>
                    <span title="Win rate if the opponent switches out this turn">They switch</span>
                    <span title="Win rate against the simulated opponent's own mix of staying and switching">Bot's guess</span>
                  </div>
                )}
                {(() => {
                  // the safest option is the one whose WORSE outcome (they stay in / they switch) is best: no guess needed
                  const floor = (r: { stay?: number; sw?: number; v: number }) => Math.min(r.stay ?? r.v, r.sw ?? r.v);
                  const best = Math.max(...advice.rows.map(floor));
                  const safeLabels = new Set(advice.rows.filter((r) => floor(r) >= best - 0.01).map((r) => r.label));
                  return advice.rows.map((r, i) => (
                    <div key={i} className={'ai-opt2' + (i === 0 ? ' top' : '')}>
                      <div className="ai-opt-main">
                        {r.label}
                        {r.ko !== undefined && r.ko >= 0.5 && (
                          <span className="ai-tag ko" title={`Knocks a Pokémon out this turn in ${pct(r.ko)} of the simulated games`}>
                            KO {pct(r.ko)}
                          </span>
                        )}
                        {r.net !== undefined && r.heur !== undefined && Math.abs(r.net - r.heur) >= 0.25 && (
                          <span
                            className="ai-tag warn"
                            title={`The two simulated opponents disagree: ${pct(r.net)} against the learned one, ${pct(r.heur)} against the damage-based one. The learned opponent plays unusual sets badly, so the lower number is the safer one to believe.`}
                          >
                            ⚠ {pct(Math.min(r.net, r.heur))}
                          </span>
                        )}
                        {r.stay !== undefined && safeLabels.has(r.label) && (
                          <span className="ai-tag safe" title="Its worse case (they stay in, or they switch) is the best of all options, so it needs no prediction">
                            safe
                          </span>
                        )}
                      </div>
                      <Bar v={r.v} />
                      <span className="ai-pct">{r.stay !== undefined ? pct(r.stay) : ''}</span>
                      <span className="ai-pct">{r.sw !== undefined ? pct(r.sw) : ''}</span>
                      <span className="ai-pct">{pct(r.v)}</span>
                    </div>
                  ));
                })()}
                {advice.note && <p className="hint">{advice.note}</p>}
                {advice.quick && <p className="hint">The bot's quick first read was: {advice.quick}. Go with the table above; differences under about 5 points are noise.</p>}
                {!advice.note && (
                  <p className="hint">
                    Each option is forced as your next move and the bot then plays the rest of the game for both sides, with their unseen sets sampled each time.
                    Options within a couple of points of each other are ordered by whether they knock something out this turn, then by how fast they win
                    (a winning position gives every sensible move about the same win rate). The first two columns are the two reads: they attack, or they switch. <b>Bot's guess</b> is how the simulated opponent mixes them
                    {advice.pSwitch !== undefined ? ` (it switched ${pct(advice.pSwitch)} of the time here)` : ''}. Pick by your read of this opponent; if the
                    rows are all close, the position is winning whatever you do, so choose the move that does what you want this turn (a KO, keeping a
                    Pokémon alive).
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
