import { useEffect, useMemo, useState } from 'react';
import type { FieldState } from '../lib/calc';
import {
  askBring,
  askCheck,
  askQuick,
  askReplace,
  baseName,
  blankMarks,
  buildPosition,
  pingBot,
  type BringOption,
  type Marks,
  type MoveCheck,
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
  const [advice, setAdvice] = useState<{ title: string; rows: { label: string; v: number; n?: number }[]; quick?: string; note?: string } | null>(null);

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

  const doAdvice = () =>
    run('Simulating each option…', async () => {
      if (mine.length !== 3) throw new Error('Tick the three Pokémon you brought.');
      if (!mineActive || !mine.some((s) => baseName(s) === baseName(mineActive))) throw new Error('Select (in V-Calc) the Pokémon of yours that is out, and make sure it is one of the three brought.');
      if (!theirActive) throw new Error("Add the opposing Pokémon that is out and select it in V-Calc.");
      const theirKo = mark(1, theirActive).ko;
      if (theirKo) throw new Error("The opponent's selected Pokémon is marked fainted: select the one they sent out.");
      const pos = buildPosition({ mine, mineActive: baseName(mineActive), theirs, theirActive: baseName(theirActive), marks, field, turn });
      if (mark(0, mineActive).ko) {
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
      setAdvice({ title: 'Best option by simulation', rows: c.checked.map((x: MoveCheck) => ({ label: x.action, v: x.win, n: x.games })), quick });
    });

  const markRow = (side: 0 | 1, s: PokemonSet) => {
    const m = mark(side, s);
    return (
      <tr key={`${side}${baseName(s)}`} className={m.ko ? 'ai-ko' : ''}>
        <th scope="row">
          <Sprite species={s.species} size={24} />
          <span>{baseName(s)}</span>
          <span className="hint"> {Math.round(s.hpPercent)}%</span>
        </th>
        <td>
          <input type="checkbox" checked={m.ko} onChange={(e) => setMark(side, s, { ko: e.target.checked })} aria-label="Fainted" />
        </td>
        <td>
          <input type="checkbox" checked={m.mega} onChange={(e) => setMark(side, s, { mega: e.target.checked })} aria-label="Mega Evolved" />
        </td>
        <td>
          <input type="checkbox" checked={m.gone} onChange={(e) => setMark(side, s, { gone: e.target.checked })} aria-label="Item used up" />
        </td>
        <td className="ai-known">
          {side === 1 ? (
            <>
              {s.moves.map((mv, i) =>
                mv ? (
                  <label key={i} title="Tick only moves you have actually seen it use">
                    <input
                      type="checkbox"
                      checked={m.moves[i] ?? false}
                      onChange={(e) => setMark(side, s, { moves: m.moves.map((x, j) => (j === i ? e.target.checked : x)) })}
                    />
                    {mv}
                  </label>
                ) : null,
              )}
              {s.item && (
                <label title="Tick if you know it holds this (e.g. you saw it)">
                  <input type="checkbox" checked={m.item} onChange={(e) => setMark(side, s, { item: e.target.checked })} />
                  {s.item}
                </label>
              )}
              {s.ability && (
                <label title="Tick if you know this is its ability">
                  <input type="checkbox" checked={m.ability} onChange={(e) => setMark(side, s, { ability: e.target.checked })} />
                  {s.ability}
                </label>
              )}
            </>
          ) : (
            <span className="hint">your build from V-Calc</span>
          )}
        </td>
      </tr>
    );
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
            <table className="ai-table">
              <thead>
                <tr>
                  <th>Pokémon</th>
                  <th title="Fainted">KO'd</th>
                  <th title="Already Mega Evolved">Mega'd</th>
                  <th title="Held item used up (berry eaten, Air Balloon popped)">Item used</th>
                  <th>Seen / known</th>
                </tr>
              </thead>
              <tbody>
                <tr className="ai-sub">
                  <td colSpan={5}>
                    Yours: tick the three you brought{' '}
                    <span className="hint">({brought.length}/3)</span>
                  </td>
                </tr>
                {mineAll.map((s) => (
                  <tr key={'b' + baseName(s)} className="ai-pick">
                    <th scope="row">
                      <label>
                        <input type="checkbox" checked={brought.includes(baseName(s))} onChange={() => toggleBrought(baseName(s))} />
                        <Sprite species={s.species} size={22} />
                        <span>{baseName(s)}</span>
                      </label>
                    </th>
                    <td colSpan={4} className="hint">
                      {mineActive && baseName(s) === baseName(mineActive) ? '← out now' : ''}
                    </td>
                  </tr>
                ))}
                <tr className="ai-sub">
                  <td colSpan={5}>Your brought Pokémon</td>
                </tr>
                {mine.map((s) => markRow(0, s))}
                <tr className="ai-sub">
                  <td colSpan={5}>Opponent</td>
                </tr>
                {theirs.map((s) => markRow(1, s))}
              </tbody>
            </table>
            <div className="ai-actions">
              <label>
                Turn{' '}
                <input type="number" min={1} max={60} value={turn} onChange={(e) => setTurn(Math.max(1, Math.min(60, parseInt(e.target.value || '1', 10))))} />
              </label>
              <button className="primary" onClick={doAdvice} disabled={!ready || !!busy}>
                What should I do this turn?
              </button>
              {busy && <span className="hint">{busy}</span>}
            </div>
            {advice && (
              <div className="ai-result">
                <h4>{advice.title}</h4>
                {advice.rows.map((r, i) => (
                  <div key={i} className={'ai-opt' + (i === 0 ? ' top' : '')}>
                    <div className="ai-opt-main">{r.label}</div>
                    <Bar v={r.v} />
                    <span className="ai-pct">{pct(r.v)}</span>
                  </div>
                ))}
                {advice.note && <p className="hint">{advice.note}</p>}
                {advice.quick && <p className="hint">The bot's quick first read was: {advice.quick}. Go with the table above; differences under about 5 points are noise.</p>}
                {!advice.note && <p className="hint">Each option is forced as your next move and the bot then plays the rest of the game for both sides, with their unseen sets sampled each time.</p>}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
