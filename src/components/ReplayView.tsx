import { useEffect, useMemo, useRef, useState } from 'react';
import { blankField, type FieldState, type Terrain, type Weather } from '../lib/calc';
import { baseName, blankMarks, getReplay, listGames, type GameRow, type Marks, type ReplayAdvice, type ReplayBoard, type ReplayGame, type ReplayMon } from '../lib/bot';
import { blankSet, moveInfo, type PokemonSet, type Status } from '../lib/model';
import { megaFor, parsePaste } from '../lib/showdown';
import BattleView, { type BattleAnim } from './BattleView';

/**
 * Replay of a logged game in the battle view: the board at the start of each turn (with what the bot advised and what
 * both sides did), the board after the turn was played (with what happened), and who was sent in after a faint. The
 * frames come from the bot's log (`/api/replay`); nothing here changes V-Calc's own battle state.
 */
const pct = (x: number | null | undefined) => (x == null ? '' : `${Math.round(x * 100)}%`);
const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
const noop = () => {};

function toField(b: ReplayBoard): FieldState {
  const f = blankField();
  f.gameType = b.doubles ? 'Doubles' : 'Singles';
  f.weather = b.field.weather as Weather;
  f.terrain = b.field.terrain as Terrain;
  f.isTrickRoom = b.field.trick_room;
  (['attackerSide', 'defenderSide'] as const).forEach((k, i) => {
    const s = b.field.sides[i];
    if (!s) return;
    f[k] = { ...f[k], isSR: s.sr, spikes: s.spikes, toxicSpikes: s.tspikes, isTailwind: s.tailwind, isReflect: s.reflect, isLightScreen: s.light, isAuroraVeil: s.veil };
  });
  return f;
}

// ---- animation: the turn's log lines played one at a time over the board the turn started from

const TYPE_COLOR: Record<string, string> = {
  Normal: '#d0d0b0', Fire: '#ff7b2e', Water: '#4a9bff', Electric: '#ffd43a', Grass: '#5fcf5a', Ice: '#8fe3e8',
  Fighting: '#d0463c', Poison: '#b455c4', Ground: '#d9b45a', Flying: '#a9b8ff', Psychic: '#ff5f9a', Bug: '#b3c22c',
  Rock: '#c2a94e', Ghost: '#8a6fd0', Dragon: '#7a52ff', Dark: '#8a7466', Steel: '#b9c2d6', Fairy: '#ff9fd0',
};
const STATUS_OF: Record<string, [string, string]> = {
  Burn: ['brn', '#e25822'], Paralysis: ['par', '#e0c020'], Poison: ['psn', '#a050c0'], Toxic: ['tox', '#a050c0'],
  BadPoison: ['tox', '#a050c0'], Sleep: ['slp', '#9aa4a8'], Freeze: ['frz', '#5ab0e8'], Frozen: ['frz', '#5ab0e8'],
};
const WEATHER_OF: Record<string, string> = { Sun: 'Sun', Rain: 'Rain', Sand: 'Sand', Sandstorm: 'Sand', Snow: 'Snow', None: '' };
const TAG = /\[(you|opp|p[12][ab])\]/;
const TAGS = /\[(you|opp|p[12][ab])\]/g;

interface Step {
  /** the board while this line plays */
  board: ReplayBoard;
  /** the last log line that has happened */
  upto: number;
  anim: BattleAnim;
}

/** A fainted Pokémon is off the field (the log keeps it in its slot until the replacement comes). */
export function clean(b: ReplayBoard): ReplayBoard {
  const f = (l: ReplayMon[]) => l.map((m) => (m.hp <= 0 && m.out != null ? { ...m, out: null } : m));
  return { ...b, me: f(b.me), opp: f(b.opp) };
}

const slotOf = (tag: string) => {
  const side = tag === 'opp' || tag.startsWith('p2') ? 1 : 0;
  const k = tag.startsWith('p') && tag.endsWith('b') ? 1 : 0;
  return { side, k, id: `${side}${k ? 'b' : ''}` };
};
/** A log line as Showdown would say it: no side tags, their Pokémon called "the opposing". */
const say = (t: string) => {
  const x = t.replace(/\[(opp|p2[ab])\] /g, 'the opposing ').replace(/\[(you|p1[ab])\] /g, '');
  return x.charAt(0).toUpperCase() + x.slice(1);
};

/** The turn as steps: each log line with the board as it stands then and the animation that goes with it. The HP and
 * effects are followed from the lines themselves, so they are only as exact as the log; the frame's own board is shown
 * once the last step has played. */
export function buildSteps(start: ReplayBoard, events: string[], doubles: boolean): Step[] {
  const w: ReplayBoard = JSON.parse(JSON.stringify(start));
  const steps: Step[] = [];
  let color = '#ffffff';
  const list = (side: number) => (side ? w.opp : w.me);
  const mon = (side: number, k: number) => list(side).find((m) => m.out === k);
  events.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('---')) return;
    const push = (a: Partial<BattleAnim> & { kind: BattleAnim['kind'] }) =>
      steps.push({ board: JSON.parse(JSON.stringify(w)), upto: i, anim: { id: 0, ms: 650, msg: say(t), ...a } });
    if (t.startsWith('***')) return void push({ kind: 'none', msg: t.replace(/\*/g, '').trim(), ms: 1200 });
    const tm = TAG.exec(t);
    if (!tm) {
      const we = /the weather became (\w+)/.exec(t);
      const te = /the terrain became (\w+)/.exec(t);
      if (we && we[1] in WEATHER_OF) w.field.weather = WEATHER_OF[we[1]];
      if (te) w.field.terrain = te[1] === 'None' ? '' : te[1];
      return void push({ kind: 'none' });
    }
    const sub = slotOf(tm[1]);
    const m = mon(sub.side, sub.k);
    const their = sub.side ? 'The opposing ' : '';
    let x: RegExpExecArray | null;
    if ((x = /^\[[^\]]+\] (.+?) used (.+)$/.exec(t))) {
      // who it is aimed at: the Pokémon named in the lines that follow
      const targets: string[] = [];
      for (let j = i + 1; j < events.length && /^\s/.test(events[j]); j++) {
        const tags = [...events[j].matchAll(TAGS)].map((g) => slotOf(g[1]).id);
        const all = /attack missed|doesn't affect|protected/.test(events[j]);
        const hit = /lost .*\(now|fainted/.test(events[j]);
        for (const id of all ? tags : hit ? tags.slice(0, 1) : []) if (id !== sub.id && !targets.includes(id)) targets.push(id);
      }
      const info = moveInfo(x[2]);
      const cat = info?.category ?? 'Status';
      if (!targets.length && !doubles && cat !== 'Status') targets.push(sub.side ? '0' : '1');
      color = TYPE_COLOR[info?.type ?? ''] ?? '#ffffff';
      return void push({ kind: 'move', who: sub.id, targets, color, style: cat === 'Physical' ? 'lunge' : cat === 'Special' || targets.length ? 'shot' : 'pulse', msg: say(t) + '!', ms: 950 });
    }
    if ((x = /^\[[^\]]+\] sends out (.+)$/.exec(t) ?? /^\[[^\]]+\] (.+) came in$/.exec(t))) {
      const name = x[1];
      if (m && m.hp > 0) push({ kind: 'out', who: sub.id, msg: sub.side ? `The opponent withdrew ${m.species}!` : `${m.species}, come back!`, ms: 550 });
      if (m) {
        m.out = null;
        m.boosts = {};
      }
      const bench = list(sub.side).filter((c) => c.out == null && c.hp > 0);
      const inc = bench.find((c) => c.species === name) ?? bench.find((c) => name.startsWith(c.species + '-')) ?? bench.find((c) => name.startsWith(c.species));
      if (inc) inc.out = sub.k;
      return void push({ kind: 'in', who: sub.id, msg: sub.side ? `The opponent sent out ${name}!` : `Go! ${name}!`, ms: 750 });
    }
    if (/fainted!/.test(t)) {
      if (m) m.hp = 0;
      push({ kind: 'faint', who: sub.id, ms: 850 });
      if (m) m.out = null;
      return;
    }
    if (/Mega Evolve/.test(t)) {
      if (m) m.mega = true;
      return void push({ kind: 'mega', who: sub.id, msg: `${their}${m?.species ?? 'Pokémon'} Mega Evolved!`, ms: 1000 });
    }
    if ((x = /lost (\d+(?:\.\d+)?)(%| HP)/.exec(t))) {
      const now = /\(now (\d+(?:\.\d+)?)(?:%|\/(\d+))/.exec(t);
      if (m) {
        if (now) m.hp = now[2] ? (100 * +now[1]) / +now[2] : +now[1];
        else if (x[2] === '%') m.hp -= +x[1];
        m.hp = Math.max(0, Math.min(100, m.hp));
      }
      return void push({ kind: now ? 'hit' : 'hurt', who: sub.id, color, msg: (/critical hit/.test(t) ? 'A critical hit! ' : '') + say(t) });
    }
    if (/is hurt by/.test(t)) return void push({ kind: 'hurt', who: sub.id });
    if ((x = /recovered (\d+(?:\.\d+)?)%/.exec(t))) {
      if (m) m.hp = Math.min(100, m.hp + +x[1]);
      return void push({ kind: 'heal', who: sub.id });
    }
    const b1 = / (Atk|Def|Spa|Spd|Spe) ([+-]\d+)$/i.exec(t);
    const b2 = / (Atk|Def|Spa|Spd|Spe) (rose|fell) by (\d+)$/i.exec(t);
    if (b1 || b2) {
      const key = (b1 ?? b2)![1].toLowerCase();
      const d = b1 ? +b1[2] : (b2![2] === 'rose' ? 1 : -1) * +b2![3];
      if (m) m.boosts = { ...m.boosts, [key]: Math.max(-6, Math.min(6, (m.boosts[key] ?? 0) + d)) };
      return void push({ kind: d > 0 ? 'up' : 'down', who: sub.id, ms: 500 });
    }
    if ((x = /(?:was afflicted:|is now) (\w+)/.exec(t)) && STATUS_OF[x[1]]) {
      if (m) m.status = STATUS_OF[x[1]][0];
      return void push({ kind: 'status', who: sub.id, color: STATUS_OF[x[1]][1] });
    }
    if (/protected/.test(t)) return void push({ kind: 'protect', who: sub.id });
    if (/attack missed/.test(t)) {
      const tags = [...t.matchAll(TAGS)].map((g) => slotOf(g[1]).id);
      return void push({ kind: 'miss', who: tags[1] ?? (doubles ? undefined : sub.side ? '0' : '1') });
    }
    push({ kind: 'none', who: sub.id });
  });
  return steps;
}

function advice(a: ReplayAdvice | null | undefined) {
  if (!a || a.kind === 'error' || a.kind === 'other') return <div className="hint">The bot was not asked on this turn.</div>;
  const rows = a.mine ?? a.rows ?? [];
  return (
    <div className="rp-advice">
      <div className="rp-h">
        Bot's advice{a.value != null ? <span className="hint"> · win chance {pct(a.value)}</span> : null}
      </div>
      {rows.slice(0, 4).map((r, i) => (
        <div key={i} className="rp-row">
          <span className="rp-pct">{pct(r.mix ?? r.p ?? r.win)}</span>
          <span>{r.action}</span>
          {r.vs != null && <span className="hint">wins {pct(r.vs)}</span>}
        </div>
      ))}
      {a.theirs && a.theirs.length > 0 && (
        <div className="rp-theirs hint">
          Expected from them:{' '}
          {a.theirs
            .slice(0, 3)
            .map((t) => `${t.action} ${pct(t.p)}`)
            .join(' · ')}
        </div>
      )}
    </div>
  );
}

export default function ReplayView({ onClose }: { onClose: () => void }) {
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [fmt, setFmt] = useState<'all' | 'singles' | 'doubles'>('all');
  const [game, setGame] = useState<ReplayGame | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** the frame whose turn is being played out line by line, and the line it is at */
  const [anim, setAnim] = useState<{ frame: number; i: number } | null>(null);
  const [animate, setAnimate] = useState(true);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    listGames()
      .then((r) => setGames(r.games))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const open = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const g = await getReplay(id);
      setGame(g);
      setStep(0);
      setAnim(null);
      setPlaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const n = game?.frames.length ?? 0;
  /** Jump to a frame as it stands (no animation). */
  const go = (i: number) => {
    setAnim(null);
    setStep(Math.max(0, Math.min(n - 1, i)));
  };
  const animFrame = anim?.frame;
  const steps = useMemo(() => {
    if (animFrame == null || !game) return null;
    const f = game.frames[animFrame];
    const before = game.frames[animFrame - 1];
    if (!f?.events?.length || !before) return null;
    return buildSteps(clean(before.board), f.events, game.doubles).map((st, i) => ({ ...st, anim: { ...st.anim, id: animFrame * 1000 + i + 1 } }));
  }, [animFrame, game]);
  /** Forward one frame, playing the turn out; while one is playing, skip to its end. */
  const forward = () => {
    if (anim) return setAnim(null);
    if (!game || step >= n - 1) return;
    const f = game.frames[step + 1];
    setStep(step + 1);
    if (animate && f.kind !== 'start' && f.events?.length) setAnim({ frame: step + 1, i: 0 });
  };
  const fwd = useRef(forward);
  fwd.current = forward;
  // the turn being played: one line after another
  useEffect(() => {
    if (!anim) return;
    const st = steps?.[anim.i];
    if (!st) return setAnim(null);
    const t = setTimeout(() => setAnim((a) => (a && steps && a.i + 1 < steps.length ? { ...a, i: a.i + 1 } : null)), st.anim.ms / speed);
    return () => clearTimeout(t);
  }, [anim, steps, speed]);
  // keys: arrows step, space plays, Esc goes back (to the list, then out)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input:not([type=range]):not([type=checkbox]), select, textarea')) return;
      if (e.key === 'Escape') {
        if (game) setGame(null);
        else onClose();
      } else if (!game) return;
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        fwd.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setAnim(null);
        setStep((s) => Math.max(0, s - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [game, n, onClose]);
  // playing: the advice is held a moment, then the turn plays out, stopping at the end
  useEffect(() => {
    if (!playing || !game || anim) return;
    if (step >= n - 1) {
      setPlaying(false);
      return;
    }
    const hold = game.frames[step]?.kind === 'start' || !animate ? 2500 : 900;
    const t = setTimeout(() => fwd.current(), hold / speed);
    return () => clearTimeout(t);
  }, [playing, step, n, game, anim, animate, speed]);

  const mineSets = useMemo(() => (game?.team_text ? parsePaste(game.team_text).sets : []), [game]);
  const frame = game?.frames[step];
  const cur = anim && anim.frame === step ? steps?.[anim.i] : undefined;
  const board = useMemo(() => (cur ? cur.board : frame ? clean(frame.board) : null), [cur, frame]);

  /** One Pokémon of a frame as a V-Calc set (species, HP, status, stat stages) and its marks. */
  const build = (side: 0 | 1, m: ReplayMon): [PokemonSet, Marks] => {
    let s: PokemonSet;
    if (side === 0) {
      s = { ...(mineSets.find((x) => baseName(x) === m.species) ?? blankSet(m.species)) };
    } else {
      s = blankSet(m.species);
      const o = game?.opp_sets[m.species];
      if (o) {
        s.item = o.item || '';
        s.ability = o.ability || s.ability;
        s.nature = o.nature || s.nature;
        if (o.sp?.length === 6) s.sp = { hp: o.sp[0], atk: o.sp[1], def: o.sp[2], spa: o.sp[3], spd: o.sp[4], spe: o.sp[5] };
        s.moves = [...(o.moves ?? [])];
      }
      // the moves it has shown come first; the rest are the set as it was entered
      const rest = s.moves.filter((x) => x && !m.moves.includes(x));
      s.moves = [...m.moves, ...rest].slice(0, 4);
      while (s.moves.length < 4) s.moves.push('');
    }
    const base = baseName(s);
    s.species = m.mega ? megaFor(base, s.item) ?? s.species : base;
    s.hpPercent = Math.max(0, Math.min(100, m.hp));
    s.status = (m.status || '') as Status;
    s.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    for (const k of STAT_KEYS) s.boosts[k] = m.boosts[k] ?? 0;
    const marks: Marks = { ...blankMarks(), ko: m.hp <= 0, mega: m.mega, gone: m.item_gone, moves: s.moves.map((x) => !!x && m.moves.includes(x)), seen: m.seen };
    return [s, marks];
  };

  const view = useMemo(() => {
    if (!board) return null;
    const b = board;
    const marks: Record<string, Marks> = {};
    const side = (sd: 0 | 1, list: ReplayMon[]) =>
      list.map((m) => {
        const [s, mk] = build(sd, m);
        marks[`${sd}:${baseName(s)}`] = mk;
        return { s, out: m.out };
      });
    const me = side(0, b.me);
    const opp = side(1, b.opp);
    const at = (l: { s: PokemonSet; out: number | null }[], k: number) => l.find((x) => x.out === k)?.s;
    return { b, marks, me, opp, at, field: toField(b) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, mineSets]);

  const title = (k: string) => (k === 'start' ? 'start of the turn' : k === 'played' ? 'after the turn' : 'sent in');
  const shownGames = (games ?? []).filter((g) => fmt === 'all' || (fmt === 'doubles') === g.doubles);

  return (
    <div className="rp-overlay">
      <header className="rp-head">
        {game ? (
          <button onClick={() => setGame(null)} title="Back to the list of games (Esc)">
            ← Games
          </button>
        ) : null}
        <strong>Replay</strong>
        {game ? (
          <span className="hint">
            {game.start} · {game.doubles ? 'Doubles' : 'Singles'}
            {game.result ? ` · ${game.result}` : ''}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <button className="icon close" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </header>
      {error && <div className="ai-error">{error}</div>}
      {!game && (
        <div className="rp-list">
          <div className="rp-tools">
            {(['all', 'singles', 'doubles'] as const).map((f) => (
              <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>
                {f === 'all' ? 'All' : f === 'singles' ? 'Singles' : 'Doubles'}
              </button>
            ))}
            <span className="hint">{busy ? 'Loading…' : games ? `${shownGames.length} games in the log` : 'Loading the games…'}</span>
          </div>
          {shownGames.map((g) => (
            <button key={g.id} className="rp-game" onClick={() => open(g.id)} disabled={busy}>
              <span className="rp-when">{g.start}</span>
              <span className={'rp-res ' + (g.result || 'none')}>{g.result || '?'}</span>
              <span className="rp-fmt">{g.doubles ? 'Doubles' : 'Singles'}</span>
              <span className="rp-teams">
                {g.bring.join(', ') || '(no turns)'} <span className="hint">vs</span> {(g.opp_seen.length ? g.opp_seen : g.preview?.opp ?? []).join(', ')}
              </span>
              <span className="hint">{g.turns.length} turns</span>
            </button>
          ))}
          {games && !games.length && <div className="hint">No games in the log yet. Games you play with the AI panel are logged as you go.</div>}
        </div>
      )}
      {game && !n && <div className="hint rp-pad">This game has no turns that can be shown (only a team preview was asked).</div>}
      {game && frame && view && (
        <div className="rp-body">
          <div className="rp-bar">
            <button onClick={() => go(0)} disabled={step === 0} title="First">
              ⏮
            </button>
            <button onClick={() => go(step - 1)} disabled={step === 0} title="Back (←)">
              ◀
            </button>
            <button className="primary" onClick={() => setPlaying((p) => !p)} title="Play / pause (space)">
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <button onClick={forward} disabled={step >= n - 1 && !anim} title="Next (→); while a turn is playing, skip to its end">
              ▶
            </button>
            <button onClick={() => go(n - 1)} disabled={step >= n - 1} title="Last">
              ⏭
            </button>
            <input type="range" min={0} max={n - 1} value={step} onChange={(e) => go(+e.target.value)} />
            <label title="Play each turn out move by move, as Showdown's replays do">
              <input type="checkbox" checked={animate} onChange={(e) => (setAnimate(e.target.checked), setAnim(null))} />
              Animations
            </label>
            <button onClick={() => setSpeed((v) => (v === 1 ? 2 : v === 2 ? 0.5 : 1))} title="Speed">
              {speed}×
            </button>
            <b>
              Turn {frame.turn}: {cur ? 'playing' : title(frame.kind)}
            </b>
            <span className="hint">
              {step + 1} / {n}
            </span>
          </div>
          <div className="rp-stage">
            <BattleView
              mine={view.me.map((x) => x.s)}
              theirs={view.opp.map((x) => x.s)}
              mineActive={view.at(view.me, 0)}
              theirActive={view.at(view.opp, 0)}
              doubles={view.b.doubles}
              minePartner={view.b.doubles ? view.at(view.me, 1) : undefined}
              theirPartner={view.b.doubles ? view.at(view.opp, 1) : undefined}
              showdown
              mark={(sd, s) => view.marks[`${sd}:${baseName(s)}`] ?? blankMarks()}
              setMark={noop}
              isAppeared={(s) => view.marks[`1:${baseName(s)}`]?.seen !== false}
              vol={[{}, {}]}
              volOf={view.b.doubles ? (_sd, s) => ({ who: baseName(s) }) : undefined}
              turn={frame.turn}
              patchVol={noop}
              patchSet={noop}
              sendOut={noop}
              field={view.field}
              setField={noop}
              timers={{}}
              onTimer={noop}
              anim={cur?.anim ?? null}
            />
          </div>
          <div className="rp-info">
            {frame.kind === 'start' && (
              <>
                {frame.played ? (
                  <div className="rp-did">
                    <div>
                      <span className="hint">You:</span> <b>{frame.you || '—'}</b>
                    </div>
                    <div>
                      <span className="hint">They:</span> <b>{frame.them || '—'}</b>
                    </div>
                  </div>
                ) : (
                  <div className="hint">This turn was not played through Play turn, so what happened is not in the log.</div>
                )}
                {advice(frame.advice)}
              </>
            )}
            {frame.kind !== 'start' && (
              <div className="sdl">
                {(cur ? (frame.events ?? []).slice(0, cur.upto + 1) : frame.events ?? []).map((e, i) =>
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
                {!frame.events?.length && <div className="hint">Nothing was logged for this step.</div>}
              </div>
            )}
            {step === n - 1 && (
              <div className="rp-end">
                End of the log{game.result ? `: you ${game.result}` : ' (no result recorded)'}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
