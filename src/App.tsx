import { useEffect, useMemo, useState } from 'react';
import { MEGA_STONES, toID } from '@smogon/calc';
import BringPanel from './components/BringPanel';
import FieldPanel from './components/FieldPanel';
import LookUp from './components/LookUp';
import Mascot from './components/Mascot';
import MetaList from './components/MetaList';
import RecommendPanel from './components/RecommendPanel';
import PokemonEditor from './components/PokemonEditor';
import Results from './components/Results';
import TurnOrder from './components/TurnOrder';
import TeamSide, { focusSlot, onFieldCount, type Team } from './components/TeamSide';
import { normalizeField, type FieldState } from './lib/calc';
import { canRefreshFromOpgg, loadMeta, refreshFromOpgg, setFromMeta, type MetaEntry, type BattleFormat, type Meta } from './lib/data';
import { gen, zeroBoosts, type PokemonSet } from './lib/model';
import { applyStatEffect, statEffect } from './lib/statMoves';
import shaymin from '../shaymin-land.svg';
import victini from '../victini.svg';

const STORAGE_KEY = 'champions-calc:v1';

interface Saved {
  teams: [Team, Team];
  format: BattleFormat;
  field: FieldState;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

const STALE_AFTER_MIN = 30;
const HOSTED_STALE_AFTER_MIN = 12 * 60; // two missed 6-hour rebuilds

function formatAge(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} hr${h === 1 ? '' : 's'}`;
  return `${Math.floor(h / 24)} days`;
}

const emptyTeam =(): Team => ({ sets: [], active: 0 });

export default function App() {
  const saved = useMemo(load, []);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState('');
  const [flashLabel, setFlashLabel] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [bringOpen, setBringOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  // null until probed. false = a hosted copy (e.g. GitHub Pages) with no scraper: the button reloads the published data.
  const [canScrape, setCanScrape] = useState<boolean | null>(null);
  useEffect(() => {
    canRefreshFromOpgg().then(setCanScrape);
  }, []);
  const hosted = canScrape === false;
  const [format, setFormat] = useState<BattleFormat>(saved?.format ?? 'double');
  const [teams, setTeams] = useState<[Team, Team]>(saved?.teams ?? [emptyTeam(), emptyTeam()]);
  const [field, setField] = useState<FieldState>(normalizeField(saved?.field));

  useEffect(() => {
    loadMeta().then(setMeta, (e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ teams, format, field }));
    } catch {
      /* storage unavailable */
    }
  }, [teams, format, field]);

  // Seed a demo matchup from the top of the meta the first time there is nothing saved.
  useEffect(() => {
    if (!meta || teams[0].sets.length || teams[1].sets.length) return;
    const [a, b] = meta.entries;
    if (a && b) setTeams([{ sets: [setFromMeta(a, format)], active: 0 }, { sets: [setFromMeta(b, format)], active: 0 }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // op.gg republishes every 30 minutes, so data fetched that long ago is out of date.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick); // timers are throttled in background tabs
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const ageMin = meta ? Math.max(0, Math.floor((now - new Date(meta.updatedAt).getTime()) / 60_000)) : 0;
  // A hosted copy only updates when the site is rebuilt, so it isn't "stale" until much older than op.gg's 30-minute cycle.
  const stale = !!meta && !refreshing && ageMin >= (hosted ? HOSTED_STALE_AFTER_MIN : STALE_AFTER_MIN);

  const refresh = async () => {
    setRefreshing('Starting…');
    setError('');
    try {
      if (hosted) {
        const before = meta?.updatedAt;
        const fresh = await loadMeta();
        setMeta(fresh);
        setFlashLabel(fresh.updatedAt === before ? 'Already up to date ✓' : 'Data updated ✓');
        window.setTimeout(() => setFlashLabel(''), 2500);
      } else {
        await refreshFromOpgg((d, t) => setRefreshing(`Scraping ${d}/${t}…`));
        setMeta(await loadMeta());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing('');
    }
  };

  /** Add a Pokémon from the "Most used" list to a team (selected on arrival, like the search box). */
  const addFromList = (side: 0 | 1, entry: MetaEntry) =>
    setTeams((old) => {
      const t = old[side];
      if (t.sets.length >= 6) return old;
      const next: [Team, Team] = [old[0], old[1]];
      next[side] = { ...t, sets: [...t.sets, setFromMeta(entry, format)], active: t.sets.length };
      return next;
    });

  /** Put the recommended Pokémon first (leads at the front) and select the leads, like arranging a team in preview. */
  const applyBring = (bring: number[], leads: number[]) => {
    setTeams((old) => {
      const t = old[0];
      const order = [...bring, ...t.sets.map((_, i) => i).filter((i) => !bring.includes(i))];
      const sets = order.map((i) => t.sets[i]);
      const next: [Team, Team] = [{ sets, active: 0, partner: doubles && leads.length > 1 ? 1 : undefined }, old[1]];
      return next;
    });
    setBringOpen(false);
  };

  /**
   * A status move's stat changes, applied for `side`'s selected Pokémon: boosts go to the user, drops to the opposing
   * Pokémon, partner boosts to the Doubles partner. Returns why nothing changed, or undefined on success.
   */
  const applyStatMove = (side: 0 | 1, move: string): string | undefined => {
    const mine = teams[side];
    const theirs = teams[1 - side];
    const me = mine.sets[mine.active];
    if (!me) return 'No Pokémon selected';
    const types = (gen.species.get(toID(me.species))?.types ?? []) as string[];
    const effect = statEffect(move, { types, weather: field.weather });
    if (!effect) return `${move} has no stat changes to apply`;
    const partnerOf = (t: Team) => (doubles && onFieldCount(t, true) === 2 ? t.partner : undefined);
    const allyIdx = partnerOf(mine);
    const foePartnerIdx = partnerOf(theirs);
    const foe = theirs.sets[theirs.active];
    const result = applyStatEffect({
      me,
      foe,
      ally: allyIdx !== undefined ? mine.sets[allyIdx] : undefined,
      foePartner: foePartnerIdx !== undefined ? theirs.sets[foePartnerIdx] : undefined,
      effect,
    });
    if (!result.ok) return result.reason;
    setTeams((old) => {
      const next: [Team, Team] = [old[0], old[1]];
      const put = (s: 0 | 1, idx: number | undefined, p: PokemonSet | undefined) => {
        if (idx === undefined || !p) return;
        next[s] = { ...next[s], sets: next[s].sets.map((x, i) => (i === idx ? p : x)) };
      };
      put(side, mine.active, result.me);
      put(side, allyIdx, result.ally);
      put((1 - side) as 0 | 1, theirs.active, result.foe);
      put((1 - side) as 0 | 1, foePartnerIdx, result.foePartner);
      return next;
    });
    if (result.foeCurse) {
      const key = side === 0 ? 'defenderSide' : 'attackerSide';
      setField((f) => ({ ...f, [key]: { ...f[key], isCurse: true } }));
    }
    return undefined;
  };

  const changeFormat =(f: BattleFormat) => {
    setFormat(f);
    setField((old) => ({ ...old, gameType: f === 'single' ? 'Singles' : 'Doubles' }));
  };

  /** Clear every field effect plus each Pokemon's battle state (boosts, status, HP, "ability active", fainted allies). */
  const resetBattle = () => {
    setField(normalizeField({ gameType: format === 'single' ? 'Singles' : 'Doubles' }));
    setTeams((old) => old.map((t) => ({ ...t, sets: t.sets.map((s) => ({ ...s, boosts: zeroBoosts(), status: '' as const, hpPercent: 100, abilityOn: false, alliesFainted: undefined })) })) as [Team, Team]);
  };

  // 1-6 select your Pokemon, Shift+1-6 the opponent's (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const m = /^Digit([1-6])$/.exec(e.code);
      if (!m) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="dialog"]')) return; // a panel is open
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const side = e.shiftKey ? 1 : 0;
      const index = +m[1] - 1;
      setTeams((old) => {
        if (index >= old[side].sets.length) return old;
        const next: [Team, Team] = [old[0], old[1]];
        next[side] = focusSlot(old[side], index);
        return next;
      });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setTeam = (i: 0 | 1) => (t: Team) => setTeams((old) => (i === 0 ? [t, old[1]] : [old[0], t]));
  const setActive = (i: 0 | 1) => (s: PokemonSet) =>
    setTeams((old) => {
      const next: [Team, Team] = [old[0], old[1]];
      const t = old[i];
      next[i] = { ...t, sets: t.sets.map((x, j) => (j === t.active ? s : x)) };
      return next;
    });

  // In Doubles, each side's two selected Pokémon decide whether spread moves are reduced (they only are with 2 targets).
  const doubles = field.gameType === 'Doubles';
  const calcField = useMemo<FieldState>(
    () => ({
      ...field,
      attackerSide: { ...field.attackerSide, active: onFieldCount(teams[0], doubles) },
      defenderSide: { ...field.defenderSide, active: onFieldCount(teams[1], doubles) },
    }),
    [field, teams, doubles],
  );

  // The Pokémon on each side: the selected one, plus the second one when a Doubles pair is picked.
  const lineup = (t: Team): PokemonSet[] =>
    [t.sets[t.active], doubles && onFieldCount(t, true) === 2 ? t.sets[t.partner!] : undefined].filter((s): s is PokemonSet => !!s);
  const yours = lineup(teams[0]);
  const theirs = lineup(teams[1]);
  // Your other team members: candidates to switch in (Best move > Switch out?).
  const bench = useMemo(() => teams[0].sets.filter((s, i) => i !== teams[0].active && i !== teams[0].partner && !!s.species), [teams]);

  const a = teams[0].sets[teams[0].active];
  const b = teams[1].sets[teams[1].active];

  // Browser tab title follows the matchup: "V-Calc | Salamence vs. Meowstic"
  const yourName = a?.species;
  const theirName = b?.species;
  useEffect(() => {
    document.title =
      yourName && theirName ? `V-Calc | ${yourName} vs. ${theirName}` : yourName || theirName ? `V-Calc | ${yourName || theirName}` : 'V-Calc';
  }, [yourName, theirName]);

  const lists = useMemo(() => {
    const speciesSet = new Set<string>();
    meta?.entries.forEach((e) => speciesSet.add(e.species));
    const megaValues = Object.values(MEGA_STONES as Record<string, Record<string, string>>).flatMap((m) => Object.entries(m));
    megaValues.forEach(([base, mega]) => speciesSet.has(base) && speciesSet.add(mega));
    const items = [...gen.items].map((i) => i.name).sort();
    const moves = [...gen.moves].map((m) => m.name).sort();
    return { species: [...speciesSet].sort(), items, moves };
  }, [meta]);

  return (
    <div className="app">
      <header className="top">
        <h1 className="brand">
          <img src={victini} alt="" width={40} height={40} />
          V-Calc
        </h1>
        <div className="seg" role="group" aria-label="Battle format">
          <button className={format === 'single' ? 'on' : ''} onClick={() => changeFormat('single')}>
            Singles
          </button>
          <button className={format === 'double' ? 'on' : ''} onClick={() => changeFormat('double')}>
            Doubles
          </button>
        </div>
        <button
          onClick={resetBattle}
          title="Reset the field (weather, terrain, Tailwind, Trick Room, screens, hazards and side effects) and every Pokémon's battle state: stat boosts, status, HP, Ability active and fainted allies. Keeps your teams and builds."
        >
          Reset battle
        </button>
        <button onClick={() => setListOpen(true)} disabled={!meta} title="See the most used Pokémon (op.gg's tier ranking) and add them to a team">
          Most used
        </button>
        <button onClick={() => setLookupOpen(true)} title="Search moves, items and abilities (Smogon descriptions) and give one to a Pokémon">
          Look up
        </button>
        <button
          onClick={() => setBringOpen(true)}
          disabled={!teams[0].sets.length || !teams[1].sets.length}
          title="Team preview: see how your team matches up against the opponent's and what to bring"
        >
          What to bring
        </button>
        <button
          onClick={() => setRecOpen(true)}
          disabled={!yours.length || !theirs.length}
          title="Recommend a move for the current matchup, using the HP, boosts, status and field you've set"
        >
          Best move
        </button>
        <span className="meta-note">
          {error ? (
            <span className="err">{error}</span>
          ) : meta ? (
            <>
              op.gg data · {meta.entries.length} Pokémon
              {meta.opggUpdatedAt && <> · op.gg updated {meta.opggUpdatedAt} (updates every 30 min)</>}
              {' · '}fetched {new Date(meta.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </>
          ) : (
            'Loading op.gg data…'
          )}
        </span>
        <button
          className={stale ? 'stale' : ''}
          onClick={refresh}
          disabled={!!refreshing}
          title={
            hosted
              ? stale
                ? `This site's data was fetched ${formatAge(ageMin)} ago. Click to check for newer published data.`
                : 'Check for newer data published with this site'
              : stale
                ? `Data was fetched ${formatAge(ageMin)} ago and op.gg updates every 30 minutes. Click to re-download (takes about a minute).`
                : 'Re-download usage data from op.gg (takes about a minute)'
          }
        >
          {refreshing || flashLabel || (stale ? `⚠ Data ${formatAge(ageMin)} old · ${hosted ? 'Reload' : 'Refresh'}` : hosted ? 'Reload data' : 'Refresh op.gg data')}
        </button>
        <img className="header-mon" src={shaymin} alt="" width={40} height={40} />
      </header>

      <datalist id="dl-species">
        {lists.species.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="dl-items">
        {lists.items.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="dl-moves">
        {lists.moves.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <main className="layout">
        <div className="col">
          <TeamSide title="Your team" team={teams[0]} onChange={setTeam(0)} meta={meta} format={format} side={0} />
          {a ? <PokemonEditor set={a} onChange={setActive(0)} meta={meta} format={format} weather={field.weather} onStatMove={(m) => applyStatMove(0, m)} /> : null}
        </div>

        <div className="col center">
          <TurnOrder
            teams={teams}
            field={field}
            onSelect={(team, index) => setTeam(team)({ ...teams[team], active: index })}
            onTrickRoom={(on) => setField((f) => ({ ...f, isTrickRoom: on }))}
            onTailwind={(team, on) =>
              setField((f) => {
                const key = team === 0 ? 'attackerSide' : 'defenderSide';
                return { ...f, [key]: { ...f[key], isTailwind: on } };
              })
            }
          />
          <Results title={`${a?.species ?? 'Yours'} → ${b?.species ?? 'Opponent'}`} pairTitle="Your side → Opponent's side" attackers={yours} defenders={theirs} field={calcField} reversed={false} />
          <Results title={`${b?.species ?? 'Opponent'} → ${a?.species ?? 'Yours'}`} pairTitle="Opponent's side → Your side" attackers={theirs} defenders={yours} field={calcField} reversed />
          <FieldPanel field={field} onChange={setField} />
        </div>

        <div className="col">
          <TeamSide title="Opponent" team={teams[1]} onChange={setTeam(1)} meta={meta} format={format} side={1} />
          {b ? <PokemonEditor set={b} onChange={setActive(1)} meta={meta} format={format} weather={field.weather} onStatMove={(m) => applyStatMove(1, m)} /> : null}
        </div>
      </main>

      {recOpen && (
        <RecommendPanel mine={yours} theirs={theirs} bench={bench} field={calcField} doubles={doubles} onClose={() => setRecOpen(false)} />
      )}

      {bringOpen && (
        <BringPanel
          mine={teams[0].sets}
          theirs={teams[1].sets}
          format={format}
          onApply={applyBring}
          onClose={() => setBringOpen(false)}
        />
      )}

      {lookupOpen && (
        <LookUp onClose={() => setLookupOpen(false)} />
      )}

      {listOpen && meta && (
        <MetaList
          meta={meta}
          format={format}
          teamSizes={[teams[0].sets.length, teams[1].sets.length]}
          onAdd={addFromList}
          onClose={() => setListOpen(false)}
        />
      )}

      <footer className="app-footer">© 2026 Mark McLellan</footer>

      <Mascot />
    </div>
  );
}
