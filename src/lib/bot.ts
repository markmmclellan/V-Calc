import type { FieldState } from './calc';
import type { PokemonSet } from './model';
import { baseForMega, exportTeam } from './showdown';

/**
 * Client for the local simulation bot (the ChampionsAI project). It runs on this computer; nothing here leaves it.
 * Start it with start_gui.bat in the ChampionsAI folder. Singles only.
 */
export const DEFAULT_BOT_URL = 'http://127.0.0.1:8765';
const URL_KEY = 'champions-calc:bot-url';

/** Where the bot is: this computer by default, or another computer on your network (set in the footer or with ?bot=). */
export function getBotUrl(): string {
  try {
    const saved = localStorage.getItem(URL_KEY);
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  // Served by the bot itself (http://<computer>:8765/vcalc/): the bot is the page's own origin.
  if (window.location.pathname.startsWith('/vcalc/') && !window.location.hostname.endsWith('github.io')) return window.location.origin;
  return DEFAULT_BOT_URL;
}

export function setBotUrl(url: string): string {
  let v = url.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v;
  if (v && !/:\d+$/.test(v) && v.startsWith('http://')) v += ':8765';
  try {
    if (!v || v === DEFAULT_BOT_URL) localStorage.removeItem(URL_KEY);
    else localStorage.setItem(URL_KEY, v);
  } catch {
    /* storage unavailable */
  }
  return getBotUrl();
}

async function call<T>(path: string, body?: unknown, timeoutMs = 600_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(
      getBotUrl() + path,
      body === undefined ? { signal: ctl.signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal },
    );
  } finally {
    clearTimeout(timer);
  }
  const j = await res.json();
  if (j && typeof j === 'object' && 'error' in j) throw new Error(String((j as { error: unknown }).error));
  return j as T;
}

export const pingBot = async (): Promise<boolean> => {
  try {
    await call('/api/ping', undefined, 2500); // an unreachable address must not hang the page
    return true;
  } catch {
    return false;
  }
};

/** What you tick in the panel: facts V-Calc itself has no field for. */
export interface Marks {
  ko: boolean; // fainted
  mega: boolean; // already Mega Evolved
  gone: boolean; // held item used up (berry eaten, Air Balloon popped, knocked off)
  moves: boolean[]; // opposing only: this move slot has been SEEN (otherwise it is just the usage-data default)
  item: boolean; // opposing only: the item is known
  ability: boolean; // opposing only: the ability is known
  seen?: boolean; // opposing only: has appeared in this battle (unset = worked out: selected, fainted or damaged)
}
export const blankMarks = (): Marks => ({ ko: false, mega: false, gone: false, moves: [false, false, false, false], item: false, ability: false });

/** The name the bot uses: a Mega form is the base species holding its stone. */
/** An opposing Pokémon counts as having appeared if you ticked it, or it is the one out, fainted, or has changed state. */
export const appeared = (s: PokemonSet, m: Marks, isActive: boolean): boolean =>
  m.seen ?? (isActive || m.ko || s.hpPercent < 100 || !!s.status || Object.values(s.boosts).some((v) => v));

export const baseName = (s: PokemonSet): string => baseForMega(s.species)?.base ?? s.species;

const WEATHER = new Set(['Sun', 'Rain', 'Sand', 'Snow']);

export interface PositionInput {
  mine: PokemonSet[]; // the three brought
  mineActive: string; // base name
  theirs: PokemonSet[]; // everything entered for the opponent so far
  theirActive: string; // base name
  marks: Record<string, Marks>; // key "0:<base name>" (yours) / "1:<base name>" (theirs)
  field: FieldState;
  turn: number;
}

/** V-Calc's battle state as the bot's position description (hp as percent; the bot converts using your max HP). */
export function buildPosition(p: PositionInput) {
  const mk = (side: 0 | 1, s: PokemonSet): Marks => p.marks[`${side}:${baseName(s)}`] ?? blankMarks();
  const boosts = (s: PokemonSet) => Object.fromEntries(Object.entries(s.boosts).filter(([, v]) => v));
  const hpOf = (side: 0 | 1, s: PokemonSet) => (mk(side, s).ko ? 0 : Math.max(1, Math.round(s.hpPercent)));
  const names = p.mine.map(baseName);
  const f = p.field;
  const mineMega = p.mine.filter((s) => mk(0, s).mega).map(baseName);
  return {
    bring: names,
    turn: p.turn,
    me: {
      active: p.mineActive,
      hp: Object.fromEntries(p.mine.map((s) => [baseName(s), hpOf(0, s)])),
      status: Object.fromEntries(p.mine.filter((s) => s.status).map((s) => [baseName(s), s.status])),
      boosts: Object.fromEntries(p.mine.map((s) => [baseName(s), boosts(s)])),
      mega_used: mineMega.length > 0,
      mega_evolved: mineMega,
      item_gone: p.mine.filter((s) => mk(0, s).gone).map(baseName),
    },
    opp: p.theirs.map((s) => {
      const m = mk(1, s);
      return {
        species: baseName(s),
        hp: hpOf(1, s),
        active: baseName(s) === p.theirActive,
        // the opponent brings 3 of their 6: the ones that have not appeared are only candidates for the other slots
        seen: appeared(s, m, baseName(s) === p.theirActive),
        status: s.status,
        boosts: boosts(s),
        mega: m.mega,
        moves: s.moves.filter((mv, i) => mv && m.moves[i]),
        // a Mega form in V-Calc is a Pokémon holding its Mega Stone: send the stone when you mark it Mega Evolved
        item: m.item ? s.item : m.mega && baseForMega(s.species) ? baseForMega(s.species)!.stone : '',
        ability: m.ability ? s.ability : '',
        item_gone: m.gone,
      };
    }),
    opp_mega_used: p.theirs.some((s) => mk(1, s).mega),
    field: {
      weather: WEATHER.has(f.weather) ? f.weather : '',
      terrain: f.terrain,
      trick_room: f.isTrickRoom,
      stealth_rock: [f.attackerSide.isSR, f.defenderSide.isSR],
      tailwind: [f.attackerSide.isTailwind, f.defenderSide.isTailwind],
      screens: [
        f.attackerSide.isReflect || f.attackerSide.isLightScreen || f.attackerSide.isAuroraVeil,
        f.defenderSide.isReflect || f.defenderSide.isLightScreen || f.defenderSide.isAuroraVeil,
      ],
      // which screens: [Reflect, Light Screen, Aurora Veil] for you, then for them
      screens_detail: [
        [f.attackerSide.isReflect, f.attackerSide.isLightScreen, f.attackerSide.isAuroraVeil],
        [f.defenderSide.isReflect, f.defenderSide.isLightScreen, f.defenderSide.isAuroraVeil],
      ],
    },
  };
}

export interface BringOption {
  lead: string;
  bring: string[];
  p: number;
}
export interface MoveCheck {
  action: string;
  win: number; // against a strong opponent who may switch
  win_stay?: number; // if the opponent stays in and attacks this turn
  win_switch?: number; // if the opponent switches this turn
  p_switch?: number; // how often the simulated opponent switches here
  win_net?: number; // against the learned opponent
  win_heur?: number; // against the damage-based opponent (plays unusual sets sensibly)
  ko_now?: number; // share of simulated games where this move knocks a Pokémon out this turn
  games: number;
}

export const askBring = (team: PokemonSet[], theirs: PokemonSet[]) =>
  call<{ options: BringOption[]; win: number }>('/api/preview', { team_text: exportTeam(team), opp: theirs.map(baseName) });

type Position = ReturnType<typeof buildPosition>;
const withTeam = (team: PokemonSet[], pos: Position) => ({ ...pos, team_text: exportTeam(team) });

export const askCheck = (team: PokemonSet[], pos: Position) => call<{ checked: MoveCheck[] }>('/api/check', withTeam(team, pos));
export const askQuick = (team: PokemonSet[], pos: Position) => call<{ actions: { action: string; p: number }[]; win: number }>('/api/position', withTeam(team, pos));
export const askReplace = (team: PokemonSet[], pos: Position) =>
  call<{ replace: { action: string; win: number; games: number }[]; note?: string }>('/api/replace', withTeam(team, pos));
