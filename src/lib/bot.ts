import type { FieldState } from './calc';
import { calcStats, type PokemonSet } from './model';
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
  pp?: Record<string, [number, number]>; // PP left / max of moves used, counted from played turns
}
/** What the battle text says about the Pokémon that is out (cleared when it switches out). */
export interface Vol {
  last_move?: string; // the move it used last turn (Encore locks it into this)
  last_move_turn?: number; // the panel's turn when the last move was tapped: a new tap (the same move used again) changes it
  who?: string; // the Pokémon these effects belong to: they are never sent for another one (a stale carry-over)
  first_move?: string; // the first move since it came in (Protean / Libero changed its type to this move's)
  disabled?: string; // Disable / Cursed Body: this move cannot be used for a few turns
  transformed?: string; // Ditto (Imposter / Transform): the species it copied
  charging?: string; // a two-turn move it started (Dive, Dig, Fly, Phantom Force, Solar Beam...): it lands next turn
  charge_turn?: number; // the turn it started on (panel only: the charge is sent for the next turn only)
  encore?: string; // Encored into this move
  yawn?: boolean; // drowsy: falls asleep at the end of this turn
  taunt?: boolean;
  leech_seed?: boolean;
  substitute?: boolean;
  bound?: boolean; // Infestation, Fire Spin, Whirlpool...: 1/8 a turn, cannot switch
  trapped?: boolean; // Mean Look, Block, Spirit Shackle, Jaw Lock: cannot switch
  confused?: boolean;
}

export const blankMarks = (): Marks => ({ ko: false, mega: false, gone: false, moves: [false, false, false, false], item: false, ability: false });

/** The name the bot uses: a Mega form is the base species holding its stone. */
/** An opposing Pokémon counts as having appeared if you ticked it, or it is the one out, fainted, or has changed state. */
export const appeared = (s: PokemonSet, m: Marks, isActive: boolean): boolean =>
  m.seen ?? (isActive || m.ko || s.hpPercent < 100 || !!s.status || Object.values(s.boosts).some((v) => v));

export const baseName = (s: PokemonSet): string => baseForMega(s.species)?.base ?? s.species;

/** Max HP of one of your Pokémon (the game shows your own HP as a number, e.g. 132/185). */
export const maxHpOf = (s: PokemonSet): number | undefined => calcStats(s.species, s.nature, s.sp)?.hp;

const WEATHER = new Set(['Sun', 'Rain', 'Sand', 'Snow']);

export interface PositionInput {
  mine: PokemonSet[]; // the three brought
  mineActive: string; // base name
  theirs: PokemonSet[]; // everything entered for the opponent so far
  theirActive: string; // base name
  marks: Record<string, Marks>; // key "0:<base name>" (yours) / "1:<base name>" (theirs)
  field: FieldState;
  turn: number;
  vol?: [Vol, Vol]; // the two Pokémon that are out: yours, theirs
}

/** V-Calc's battle state as the bot's position description (hp as percent; the bot converts using your max HP). */
/** PP left of moves that have been used, as {move: n}. */
const ppLeft = (m: Marks): Record<string, number> => Object.fromEntries(Object.entries(m.pp ?? {}).filter(([, v]) => v[0] < v[1]).map(([k, v]) => [k, v[0]]));

/** The effects of the Pokémon that is out, or nothing if they were recorded for a different one. */
const volFor = (v: Vol | undefined, name: string): Vol => (v && (!v.who || v.who === name) ? v : {});

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
      // exact HP where the max is known (the percentage alone can be off by a point)
      hp_abs: Object.fromEntries(
        p.mine.flatMap((s) => {
          const max = maxHpOf(s);
          return max ? [[baseName(s), mk(0, s).ko ? 0 : Math.max(1, Math.round((s.hpPercent * max) / 100))]] : [];
        }),
      ),
      status: Object.fromEntries(p.mine.filter((s) => s.status).map((s) => [baseName(s), s.status])),
      boosts: Object.fromEntries(p.mine.map((s) => [baseName(s), boosts(s)])),
      mega_used: mineMega.length > 0,
      mega_evolved: mineMega,
      item_gone: p.mine.filter((s) => mk(0, s).gone).map(baseName),
      // V-Calc's "Disguise broken" box
      disguise_broken: p.mine.filter((s) => s.ability === 'Disguise' && s.abilityOn).map(baseName),
      // PP left, from played turns: a move at 0 is never suggested
      pp: Object.fromEntries(p.mine.map((s) => [baseName(s), ppLeft(mk(0, s))])),
      // Leech Seed and binding are set in the calc's field (per side); the rest in the AI panel
      volatile: { ...volFor(p.vol?.[0], p.mineActive), leech_seed: !!f.attackerSide.isSeeded, bound: !!f.attackerSide.isBound },
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
        disguise_broken: s.ability === 'Disguise' && s.abilityOn,
        pp: ppLeft(m), // their moves seen running low (or out)
        volatile: baseName(s) === p.theirActive ? { ...volFor(p.vol?.[1], p.theirActive), leech_seed: !!f.defenderSide.isSeeded, bound: !!f.defenderSide.isBound } : {},
      };
    }),
    opp_mega_used: p.theirs.some((s) => mk(1, s).mega),
    field: {
      weather: WEATHER.has(f.weather) ? f.weather : '',
      terrain: f.terrain,
      trick_room: f.isTrickRoom,
      stealth_rock: [f.attackerSide.isSR, f.defenderSide.isSR],
      spikes: [f.attackerSide.spikes || 0, f.defenderSide.spikes || 0],
      toxic_spikes: [f.attackerSide.toxicSpikes || 0, f.defenderSide.toxicSpikes || 0],
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

/** One of my brings, simulated: whole games against what they are likely to bring. */
export interface BringRow {
  lead: string;
  bring: string[];
  win: number; // against their likely brings
  worst: number | null; // against the bring of theirs it does worst against
  worst_vs: string[] | null;
  rank: number; // among all 60 brings and leads
  p: number; // how strongly the network's instant guess picked it
  games: number;
}
export interface BringCheck {
  options: BringRow[];
  games: number;
  seconds: number;
  their_likely: { lead: string; bring: string[]; p: number }[];
}
export const askBringCheck = (team: PokemonSet[], theirs: PokemonSet[], seconds = 20) =>
  call<BringCheck>('/api/bring_check', { team_text: exportTeam(team), opp: theirs.map(baseName), seconds });

type Position = ReturnType<typeof buildPosition>;
const withTeam = (team: PokemonSet[], pos: Position) => ({ ...pos, team_text: exportTeam(team) });

export const askCheck = (team: PokemonSet[], pos: Position) => call<{ checked: MoveCheck[] }>('/api/check', withTeam(team, pos));
export const askQuick = (team: PokemonSet[], pos: Position) => call<{ actions: { action: string; p: number }[]; win: number }>('/api/position', withTeam(team, pos));
/** One of my options in the solved turn. */
export interface SolveRow {
  action: string;
  mix: number; // how often to pick it (the game's mixed strategy)
  vs_their_play: number; // win chance against the opponent's predicted mix
  worst: number; // win chance against their best reply to this option
}
export interface SolveResult {
  warnings?: string[]; // what the bot left out because it did not understand it (it answered anyway)
  value: number;
  mine: SolveRow[];
  theirs: { their_action: string; prob: number }[];
  endgame?: boolean; // two or fewer a side: every chance outcome of two turns listed exactly
  depth?: number;
  cut_short?: boolean;
}
/** This turn solved as a simultaneous guessing game (or exactly, in an endgame). */
export const askSolve = (team: PokemonSet[], pos: Position, seconds = 8) => call<SolveResult>('/api/solve', { ...withTeam(team, pos), seconds });
/** One Pokémon after a played turn (see the bot's play_turn). */
export interface PlayMon {
  hp: number;
  max_hp: number;
  hp_pct: number;
  status: string;
  fainted: boolean;
  active: boolean;
  boosts: { atk: number; def: number; spa: number; spd: number; spe: number };
  mega: boolean;
  item: string;
  item_gone: boolean;
  revealed_item?: string | null;
  revealed_ability?: string | null;
  revealed_moves?: string[] | null;
  disguise_broken?: boolean;
  pp?: Record<string, [number, number]>;
}
export interface PlaySide {
  active: string;
  mons: Record<string, PlayMon>;
  vol: { yawn: boolean; encore?: string | null; taunt: boolean; substitute: boolean; trapped: boolean; confused: boolean; last_move?: string | null; first_move?: string | null; charging?: string | null; disabled?: string | null; transformed?: string | null };
}
export interface PlaySideField {
  stealth_rock: boolean;
  spikes: number;
  toxic_spikes: number;
  tailwind: boolean;
  reflect: boolean;
  light_screen: boolean;
  aurora_veil: boolean;
  leech_seed: boolean;
  bound: boolean;
}
export interface PlayResult {
  events: string[];
  warnings?: string[];
  me: PlaySide;
  opp: PlaySide;
  field: {
    weather: string;
    terrain: string;
    trick_room: boolean;
    sides: [PlaySideField, PlaySideField];
    turns: { weather: number; terrain: number; trick_room: number; tailwind: [number, number]; screens: [[number, number, number], [number, number, number]] };
  };
  winner: number | null;
  need_pivot: null | { side: 'me' | 'opp'; options: string[]; kind?: 'revive' };
  replace: [boolean, boolean];
}
/** Play the turn both sides chose (average luck, their most likely set): the board after it. */
/** "Something is off here": the board and what the bot said, saved on the bot's computer for later. */
export const sendReport = (team: PokemonSet[], pos: Position, extra: Record<string, unknown>) => call<{ ok: boolean }>('/api/report', { ...withTeam(team, pos), ...extra });

/** What you saw happen to one side's move this turn (overrides the dice). */
export interface Outcome {
  miss?: boolean;
  crit?: boolean;
  no_move?: boolean; // flinched, fully paralysed, asleep...
  first?: boolean; // it moved first (a speed tie, or the engine has the speed wrong)
}
export const askPlayTurn = (
  team: PokemonSet[],
  pos: Position,
  mine: string,
  theirs: string,
  pivot: Record<string, string> = {},
  theirSets: PokemonSet[] = [],
  outcome: { me?: Outcome; opp?: Outcome } = {},
) =>
  call<PlayResult>('/api/play_turn', {
    ...withTeam(team, pos),
    mine,
    theirs,
    pivot,
    outcome,
    // their sets as entered in the calc: the turn is played with them, so it matches the damage numbers on screen
    opp_sets: Object.fromEntries(
      theirSets
        .filter((s) => s.species)
        .map((s) => [baseName(s), { item: s.item, ability: baseName(s) === s.species ? s.ability : '', nature: s.nature, sp: [s.sp.hp, s.sp.atk, s.sp.def, s.sp.spa, s.sp.spd, s.sp.spe], moves: s.moves }]),
    ),
  });
export const askReplace =(team: PokemonSet[], pos: Position) =>
  call<{
    replace: { action: string; win: number; games: number; mix?: number; worst?: number; vs?: Record<string, number> }[];
    note?: string;
    double_ko?: boolean; // both fainted: a blind pick, solved as a guessing game
    warnings?: string[];
    theirs?: { their_action: string; prob: number }[];
  }>('/api/replace', withTeam(team, pos));

/** Two-turn moves: the first turn only charges. Dig / Dive / Fly / Bounce / Phantom Force also take the user out of
 * reach until it lands (the name is the battle's word for it). */
export const CHARGE_MOVES: Record<string, string> = {
  Dig: 'Underground',
  Dive: 'Underwater',
  Fly: 'In the air',
  Bounce: 'In the air',
  'Phantom Force': 'Concealed',
  'Shadow Force': 'Concealed',
  'Solar Beam': 'Charging',
  'Solar Blade': 'Charging',
  'Electro Shot': 'Charging',
  'Meteor Beam': 'Charging',
  'Sky Attack': 'Charging',
};
