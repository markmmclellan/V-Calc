import type { FieldState } from './calc';
import { calcStats, type PokemonSet } from './model';
import { baseForMega, exportTeam } from './showdown';

/**
 * Client for the local simulation bot (the ChampionsAI project). It runs on this computer; nothing here leaves it.
 * Start it with start_gui.bat in the ChampionsAI folder. Singles, and Doubles (the askDoubles* calls).
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
  hits?: SeenHit[]; // opposing only: measured hits it dealt or took (narrow down its spread)
}
/** A measured hit, in the bot's format (see the engine's position::parse_hits). */
export interface SeenHit {
  dealt_by_opp: boolean;
  move: string;
  other: string; // my Pokémon in the hit
  dmg?: number; // HP my Pokémon lost (dealt_by_opp)
  my_hp_before?: number;
  pct_from?: number; // their HP % before and after (my hit on them)
  pct_to?: number;
  crit: boolean;
  ko: boolean;
  opp_boosts: Record<string, number>;
  my_boosts: Record<string, number>;
  opp_status: string;
  my_status: string;
  opp_mega: boolean;
  my_mega: boolean;
  weather: string;
  terrain: string;
  def_screens: boolean[];
  spread?: boolean; // doubles: a spread move (x0.75)
  doubles?: boolean; // doubles screens (2/3)
}
/** One move's hit in a played doubles turn (the typical run), between the sides. */
export interface DoublesHit {
  attacker: 'me' | 'opp';
  move: string;
  mine: string;
  theirs: string;
  dmg: number;
  before: number;
  max_hp: number;
  after: number; // the target's HP after the whole turn, in that run
  hits: number;
  crit: boolean;
  ko: boolean;
  spread: boolean;
  unmeasured: boolean; // Focus Sash, Sturdy, Disguise: not the full roll
  my_boosts: number[];
  opp_boosts: number[];
  my_status: string;
  opp_status: string;
  my_mega: boolean;
  opp_mega: boolean;
  weather: string;
  terrain: string;
  def_screens: boolean[];
}
/** Turns left of the field's timed effects (kept by the panel, sent back as field.turns). */
export interface DoublesTurns {
  weather: number;
  terrain: number;
  trick_room: number;
  tailwind: number[];
  screens: number[][];
}
/** One move's hit in a played turn, as the engine worked it out (average roll). */
export interface PlayHit {
  attacker: 'me' | 'opp';
  move: string;
  mine: string;
  theirs: string;
  dmg: number;
  before: number;
  max_hp: number;
  hits: number;
  crit: boolean;
  ko: boolean;
  my_boosts: number[];
  opp_boosts: number[];
  my_status: string;
  opp_status: string;
  my_mega: boolean;
  opp_mega: boolean;
  weather: string;
  terrain: string;
  def_screens: boolean[];
}
export interface LikelySets {
  [species: string]: { hits: number; builds: { nature: string; sp: number[]; item: string; share: number }[]; entered_fits?: boolean };
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
        hits: m.hits ?? [], // measured hits: the bot only imagines spreads that explain them
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

/** Doubles team preview: which 4 to bring and which 2 lead, from the doubles bot's preview network (instant). */
export interface DoublesBring {
  value: number; // expected result, -1 (loss) .. +1 (win)
  // p: how often to pick it (simulated mix, or the network's guess); win / worst: from simulated games
  options: { p: number; lead: string[]; back: string[]; win?: number; worst?: number; prior?: number }[];
  brought: Record<string, number>; // share of its picks that bring each of yours
  led: Record<string, number>; // ... and that lead with it
  their_likely?: { lead: string[]; back: string[]; p: number }[];
  win?: number;
  games?: number;
  seconds?: number;
  run: string;
  update: number;
}
export const askDoublesBring = (team: PokemonSet[], theirs: PokemonSet[], seconds = 20) =>
  call<DoublesBring>('/api/doubles_bring', { team_text: exportTeam(team), opp: theirs.map(baseName), seconds });

/** Doubles turn advice: each of your two's options with the network's weights, and the likeliest pairs. */
export interface DoublesTurn {
  field: string[][]; // [[your left, right], [their left, right]]
  left: { species: string; options: { action: string; p: number }[] } | null;
  right: { species: string; options: { action: string; p: number }[] } | null;
  pairs?: { left: string; right: string; p: number }[]; // network only (quick)
  value: number; // -1 .. +1
  warnings: string[];
  run: string;
  update: number;
  // the search (simulated games)
  options?: { action: string; left: string | null; right: string | null; mix: number; win: number; prior: number }[];
  theirs?: { action: string; p: number }[];
  win?: number;
  games?: number;
  seconds?: number;
  endgame?: boolean; // few left: every likely option, played to the end
  // the pick uses a switching move: who to send in, each from simulated games
  pivot?: { move: string; options: { species: string; win: number }[] } | null;
}
export const askDoublesTurn = (team: PokemonSet[], board: Record<string, unknown>, seconds = 6) =>
  call<DoublesTurn>('/api/doubles_turn', { ...board, team_text: exportTeam(team), seconds });

/** Doubles Play turn: every choice of the four on the field ([left, right] per side). */
export interface DoublesOptions {
  field: string[][];
  me: { index: number; action: string }[][];
  opp: { index: number; action: string }[][];
  warnings: string[];
}
export const askDoublesOptions = (team: PokemonSet[], board: Record<string, unknown>) =>
  call<DoublesOptions>('/api/doubles_options', { ...board, team_text: exportTeam(team) });
interface DoublesPlayMon {
  hp_pct: number;
  hp: number;
  status: string;
  boosts: Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>;
  mega: boolean;
  item_gone: boolean;
  out: number | null;
  fainted_share: number; // how often it fainted over the runs
}
/** The typical result of a doubles turn (64 runs): the board after it and one run's log. */
export interface DoublesPlay {
  events: string[];
  me: Record<string, DoublesPlayMon>;
  opp: Record<string, DoublesPlayMon>;
  field: { weather: string; terrain: string; trick_room: boolean; tailwind: [boolean, boolean]; screens: [boolean, boolean, boolean][]; turns?: DoublesTurns };
  replace: [boolean, boolean];
  winner: number | null;
  hits?: DoublesHit[];
  runs: number;
  warnings: string[];
}
/** "Something is off" (doubles): the board and the bot's last answers, saved on the bot's computer. */
export const sendDoublesReport = (team: PokemonSet[], board: Record<string, unknown>, extra: Record<string, unknown>) =>
  call<{ ok: boolean }>('/api/report', { ...board, team_text: exportTeam(team), doubles: true, ...extra });
/** Turn 1: the leads come out (entry abilities, seeds); the board after. */
export const askDoublesLeads = (team: PokemonSet[], board: Record<string, unknown>) =>
  call<DoublesPlay>('/api/doubles_leads', { ...board, team_text: exportTeam(team) });
/** `theirs`: an index from the menu, or a move of theirs typed in ({move, target species, mega}). */
export const askDoublesPlay = (
  team: PokemonSet[],
  board: Record<string, unknown>,
  mine: number[],
  theirs: (number | { move: string; target: string; mega: boolean })[],
) => call<DoublesPlay>('/api/doubles_play', { ...board, team_text: exportTeam(team), mine, theirs });

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
  theirs: { their_action: string; prob: number; mega?: number }[]; // mega: how often that move comes with Mega Evolution
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
  /** faints so far per side [yours, theirs], revived ones included (Last Respects, Supreme Overlord) */
  fainted_count?: [number, number];
  warnings?: string[];
  hits?: PlayHit[];
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
/** A replacement sent in between turns through the engine, so Stealth Rock, Intimidate and the like apply. */
/** Their sets as entered in V-Calc, keyed by base species (what the engine plays them with). */
export const oppSetsJson = (theirSets: PokemonSet[]) =>
  Object.fromEntries(
    theirSets
      .filter((s) => s.species)
      .map((s) => [baseName(s), { item: s.item, ability: baseName(s) === s.species ? s.ability : '', nature: s.nature, sp: [s.sp.hp, s.sp.atk, s.sp.def, s.sp.spa, s.sp.spd, s.sp.spe], moves: s.moves }]),
  );

/** The board as you corrected it after a played turn: only logged (the review shows how the game really went). */
export const logBoard = (team: PokemonSet[], pos: Position) => call<{ ok: boolean }>('/api/board', withTeam(team, pos));

/** The start of a battle: both leads come in through the engine (Intimidate, weather and terrain, Imposter...). */
export const askLeads = (team: PokemonSet[], pos: Position, theirSets: PokemonSet[] = []) =>
  call<PlayResult>('/api/leads', { ...withTeam(team, pos), opp_sets: oppSetsJson(theirSets) });

/** The opposing Pokémon's most likely builds, given the hits measured so far. */
export const askLikelySets = (team: PokemonSet[], pos: Position) => call<LikelySets>('/api/likely_sets', withTeam(team, pos));

export const askSendIn = (team: PokemonSet[], pos: Position, side: 'me' | 'opp', species: string, theirSets: PokemonSet[] = []) =>
  call<PlayResult>('/api/send_in', {
    ...withTeam(team, pos),
    side,
    species,
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
