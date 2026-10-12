import type { FieldState } from './calc';
import type { PokemonSet } from './model';
import { baseForMega, exportTeam } from './showdown';

/**
 * Client for the local simulation bot (the ChampionsAI project). It runs on this computer; nothing here leaves it.
 * Start it with start_gui.bat in the ChampionsAI folder. Singles only.
 */
export const BOT_URL = 'http://127.0.0.1:8765';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BOT_URL + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (j && typeof j === 'object' && 'error' in j) throw new Error(String((j as { error: unknown }).error));
  return j as T;
}

export const pingBot = async (): Promise<boolean> => {
  try {
    await call('/api/ping');
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
}
export const blankMarks = (): Marks => ({ ko: false, mega: false, gone: false, moves: [false, false, false, false], item: false, ability: false });

/** The name the bot uses: a Mega form is the base species holding its stone. */
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
        status: s.status,
        boosts: boosts(s),
        mega: m.mega,
        moves: s.moves.filter((mv, i) => mv && m.moves[i]),
        item: m.item ? s.item : '',
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
  win: number;
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
