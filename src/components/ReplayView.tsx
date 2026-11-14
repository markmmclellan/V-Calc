import { useEffect, useMemo, useState } from 'react';
import { blankField, type FieldState, type Terrain, type Weather } from '../lib/calc';
import { baseName, blankMarks, getReplay, listGames, type GameRow, type Marks, type ReplayAdvice, type ReplayBoard, type ReplayGame, type ReplayMon } from '../lib/bot';
import { blankSet, type PokemonSet, type Status } from '../lib/model';
import { megaFor, parsePaste } from '../lib/showdown';
import BattleView from './BattleView';

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
      setPlaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const n = game?.frames.length ?? 0;
  const go = (i: number) => setStep(Math.max(0, Math.min(n - 1, i)));
  // keys: arrows step, space plays, Esc goes back (to the list, then out)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'Escape') {
        if (game) setGame(null);
        else onClose();
      } else if (!game) return;
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(n - 1, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [game, n, onClose]);
  // playing: a frame every 2.5 s, stopping at the end
  useEffect(() => {
    if (!playing || !game) return;
    if (step >= n - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(n - 1, s + 1)), 2500);
    return () => clearTimeout(t);
  }, [playing, step, n, game]);

  const mineSets = useMemo(() => (game?.team_text ? parsePaste(game.team_text).sets : []), [game]);
  const frame = game?.frames[step];

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
    if (!frame) return null;
    const b = frame.board;
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
  }, [frame, mineSets]);

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
            <button onClick={() => go(step + 1)} disabled={step >= n - 1} title="Next (→)">
              ▶
            </button>
            <button onClick={() => go(n - 1)} disabled={step >= n - 1} title="Last">
              ⏭
            </button>
            <input type="range" min={0} max={n - 1} value={step} onChange={(e) => go(+e.target.value)} />
            <b>
              Turn {frame.turn}: {title(frame.kind)}
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
                {(frame.events ?? []).map((e, i) =>
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
