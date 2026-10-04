import { calculate, Field, Move, Pokemon, toID } from '@smogon/calc';
import { calcStats, gen, LEVEL, STAT_KEYS, type PokemonSet } from './model';
import { getKOChance } from './vendor/kochance';

export type Weather = '' | 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain' | 'Strong Winds';
export type Terrain = '' | 'Electric' | 'Grassy' | 'Misty' | 'Psychic';

export interface SideState {
  isReflect: boolean;
  isLightScreen: boolean;
  isAuroraVeil: boolean;
  isHelpingHand: boolean;
  isFriendGuard: boolean;
  isTailwind: boolean;
  isSR: boolean;
  spikes: number;
  // Effects on that side's active Pokemon (all optional so older saved fields keep working)
  isSaltCured?: boolean;
  isSeeded?: boolean; // Leech Seed
  isIngrain?: boolean;
  isAquaRing?: boolean;
  isCurse?: boolean;
  isBound?: boolean; // trapped by Bind/Wrap/Fire Spin etc.
  hasBindingBand?: boolean; // the binder holds a Binding Band (1/6 instead of 1/8)
  isCharge?: boolean; // the Pokemon used Charge: its next Electric move is doubled
  isSteelySpirit?: boolean; // a Steely Spirit Pokemon is on this side: Steel moves x1.5
  active?: 1 | 2; // Pokemon this side has on the field in Doubles (default 2), derived from the selected pair; spread moves only lose power with 2+ targets
}

/** Normalize a saved field so every current side flag exists (saves from older versions lack the new ones). */
export function normalizeField(f: Partial<FieldState> | undefined): FieldState {
  const b = blankField();
  return { ...b, ...f, attackerSide: { ...b.attackerSide, ...f?.attackerSide }, defenderSide: { ...b.defenderSide, ...f?.defenderSide } };
}

export interface FieldState {
  gameType: 'Singles' | 'Doubles';
  weather: Weather;
  terrain: Terrain;
  isGravity: boolean;
  isMagicRoom: boolean;
  isWonderRoom: boolean;
  isTrickRoom: boolean; // affects turn order only (not part of smogon-calc's damage model)
  isFairyAura?: boolean; // Fairy Aura on the field from a Pokemon not in this matchup (e.g. a Doubles ally)
  // [0] = attacker's side (the side the attacker belongs to), [1] = defender's side
  attackerSide: SideState;
  defenderSide: SideState;
}

export const blankSide = (): SideState => ({
  isReflect: false,
  isLightScreen: false,
  isAuroraVeil: false,
  isHelpingHand: false,
  isFriendGuard: false,
  isTailwind: false,
  isSR: false,
  spikes: 0,
});
export const blankField = (): FieldState => ({
  gameType: 'Doubles',
  weather: '',
  terrain: '',
  isGravity: false,
  isMagicRoom: false,
  isWonderRoom: false,
  isTrickRoom: false,
  attackerSide: blankSide(),
  defenderSide: blankSide(),
});

export interface MoveResult {
  move: string;
  ok: boolean;
  category: string;
  type: string;
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  defenderHP: number;
  ko: string;
  desc: string;
  /** Every possible damage roll of one use of the move (16 equally likely values), for exact KO probabilities. */
  rolls: number[];
  /** The target's current HP (what `rolls` is compared against). */
  curHP: number;
}

/** The 16 damage rolls of a result. Multi-hit moves return one array per hit; their totals are spread evenly. */
function rollsFrom(damage: unknown, min: number, max: number): number[] {
  if (typeof damage === 'number') return [damage];
  const arr = damage as unknown[];
  if (arr.length >= 16 && typeof arr[0] === 'number') return arr as number[];
  if (arr.length && typeof arr[0] === 'number') return [(arr as number[]).reduce((a, b) => a + b, 0)];
  return Array.from({ length: 16 }, (_, i) => Math.round(min + ((max - min) * i) / 15));
}

/** Build a calc Pokemon. In the Champions ruleset the calc's `evs` are Stat Points (+1 final stat each). */
/**
 * The Champions ruleset only applies Steely Spirit when the attacker itself has the ability, but the
 * ability also powers up allies' Steel moves. This makes the attacker answer "yes" to Steely Spirit. The
 * library clones Pokemon before calculating, so the override has to survive `clone()`.
 */
class AllySteelySpiritPokemon extends Pokemon {
  hasAbility(...abilities: string[]): boolean {
    return abilities.includes('Steely Spirit') || super.hasAbility(...abilities);
  }
  clone(): Pokemon {
    return Object.setPrototypeOf(super.clone(), AllySteelySpiritPokemon.prototype) as Pokemon;
  }
}

/**
 * The calc cuts spread moves to 75% whenever the format is Doubles, however many Pokemon are left. In the real
 * game the cut only applies when the move has more than one target. This move claims a single target (the library
 * clones moves before calculating, so the override has to survive `clone()`). Changing the format to Singles
 * instead would also change how screens work.
 */
class SingleTargetMove extends Move {
  clone(): Move {
    const copy = super.clone();
    Object.setPrototypeOf(copy, SingleTargetMove.prototype);
    delete (copy as { target?: unknown }).target; // drop the plain copy so the accessor below applies
    return copy;
  }
}
Object.defineProperty(SingleTargetMove.prototype, 'target', { get: () => 'normal', set: () => {}, configurable: true });

const onField = (s: SideState): number => (s.active === 1 ? 1 : 2);

/** How many Pokemon a spread move would hit, or null if it isn't a spread move. Earthquake-style moves also hit the user's ally. */
function spreadTargets(move: Move, foes: number, allies: number): number | null {
  if (move.target === 'allAdjacentFoes' || move.named('Expanding Force')) return foes;
  if (move.target === 'allAdjacent') return foes + allies;
  return null;
}

export function buildPokemon(set: PokemonSet, allySteelySpirit = false): Pokemon | null {
  if (!gen.species.get(toID(set.species))) return null;
  const stats = calcStats(set.species, set.nature, set.sp);
  if (!stats) return null;
  const evs = Object.fromEntries(STAT_KEYS.map((k) => [k, set.sp[k]]));
  const Ctor = allySteelySpirit && set.ability !== 'Steely Spirit' ? AllySteelySpiritPokemon : Pokemon;
  return new Ctor(gen, set.species, {
    level: LEVEL,
    ability: set.ability || undefined,
    abilityOn: set.abilityOn,
    alliesFainted: set.ability === 'Supreme Overlord' ? set.alliesFainted : undefined,
    item: set.item || undefined,
    nature: set.nature,
    status: set.status || undefined,
    boosts: set.boosts,
    evs,
    curHP: Math.max(1, Math.round((stats.hp * set.hpPercent) / 100)),
  });
}

const WEATHER_MAP: Record<string, string | undefined> = { '': undefined };
const TERRAIN_MAP: Record<string, string | undefined> = { '': undefined };

function buildField(f: FieldState, flip: boolean): Field {
  const a = flip ? f.defenderSide : f.attackerSide;
  const d = flip ? f.attackerSide : f.defenderSide;
  const side = (s: SideState, isDefender: boolean) => ({
    spikes: s.spikes,
    isSR: s.isSR,
    isReflect: s.isReflect,
    isLightScreen: s.isLightScreen,
    isAuroraVeil: s.isAuroraVeil,
    isHelpingHand: s.isHelpingHand,
    isFriendGuard: s.isFriendGuard,
    isTailwind: s.isTailwind,
    isCharge: !!s.isCharge,
    isSaltCured: isDefender && !!s.isSaltCured,
    // Leech Seed drains the seeded Pokemon only; smogon-calc would also heal an attacker on a "seeded" side.
    isSeeded: isDefender && !!s.isSeeded,
  });
  return new Field({
    gameType: f.gameType,
    weather: (f.weather in WEATHER_MAP ? WEATHER_MAP[f.weather] : f.weather) as never,
    terrain: (f.terrain in TERRAIN_MAP ? TERRAIN_MAP[f.terrain] : f.terrain) as never,
    isGravity: f.isGravity,
    isMagicRoom: f.isMagicRoom,
    isWonderRoom: f.isWonderRoom,
    isFairyAura: !!f.isFairyAura,
    attackerSide: side(a, false) as never,
    defenderSide: side(d, true) as never,
  });
}

const TYPE_ABILITIES: Record<string, string[]> = {
  Ground: ['Levitate', 'Eelevate', 'Earth Eater'],
  Electric: ['Volt Absorb', 'Lightning Rod', 'Motor Drive'],
  Water: ['Water Absorb', 'Storm Drain', 'Dry Skin'],
  Fire: ['Flash Fire', 'Well-Baked Body'],
  Grass: ['Sap Sipper'],
};

/** Short reason a move did 0 damage, mirroring the immunity checks in @smogon/calc. */
function immunityReason(defender: Pokemon, move: Move, field: FieldState): string {
  const chart = gen.types.get(toID(move.type));
  const immuneType = defender.types.find((t) => chart?.effectiveness[t] === 0);
  if (immuneType) return `Immune (${immuneType}-type)`;

  const ab = defender.ability ?? '';
  const flags = move.flags as Record<string, number | undefined>;
  if (TYPE_ABILITIES[move.type]?.includes(ab)) return `Immune (${ab})`;
  if (ab === 'Wonder Guard') return 'Immune (Wonder Guard)';
  if (flags.bullet && ab === 'Bulletproof') return 'Immune (Bulletproof)';
  if (flags.sound && ab === 'Soundproof') return 'Immune (Soundproof)';
  if (flags.wind && ab === 'Wind Rider') return 'Immune (Wind Rider)';
  if (move.priority > 0 && ['Queenly Majesty', 'Dazzling', 'Armor Tail'].includes(ab)) return `Blocked (${ab})`;

  if (move.type === 'Ground' && defender.item === 'Air Balloon') return 'Immune (Air Balloon)';
  if (move.priority > 0 && field.terrain === 'Psychic') return 'Blocked (Psychic Terrain)';
  return 'No damage';
}

/** Abilities that make an attacker's moves ignore the defender's ability in Champions (negating Disguise). */
const IGNORES_ABILITIES = ['Mold Breaker'];

/**
 * Mimikyu's Disguise: the first damaging hit it takes deals nothing and costs it 1/8 of its max HP (Smogon's
 * Champions dex). The damage library has no concept of this, so callers add one hit to the count. It doesn't apply
 * once Busted (the Mimikyu-Busted form), when the attacker has Mold Breaker, or to multi-hit moves (only the first
 * hit would be blocked, which isn't modeled).
 */
export function disguiseIntact(attacker: PokemonSet, defender: PokemonSet, moveName: string): boolean {
  if (defender.species !== 'Mimikyu' || defender.ability !== 'Disguise') return false;
  if (IGNORES_ABILITIES.includes(attacker.ability)) return false;
  const data = gen.moves.get(toID(moveName)) as { multihit?: number | number[] } | undefined;
  return !!data && !data.multihit;
}

export function calcMove(
  attacker: PokemonSet,
  defender: PokemonSet,
  moveName: string,
  crit: boolean,
  field: FieldState,
  reversed = false,
): MoveResult {
  const empty: MoveResult = {
    move: moveName,
    ok: false,
    category: '',
    type: '',
    min: 0,
    max: 0,
    minPct: 0,
    maxPct: 0,
    defenderHP: 0,
    ko: '',
    desc: '',
    rolls: [],
    curHP: 0,
  };
  try {
    const attackerSide = reversed ? field.defenderSide : field.attackerSide;
    const defenderSide = reversed ? field.attackerSide : field.defenderSide;
    const a = buildPokemon(attacker, !!attackerSide.isSteelySpirit);
    const d = buildPokemon(defender);
    if (!a || !d || !moveName) return empty;
    let move = new Move(gen, moveName, { isCrit: crit });
    const targets = field.gameType === 'Doubles' ? spreadTargets(move, onField(defenderSide), onField(attackerSide) - 1) : null;
    if (targets !== null && targets < 2) move = new SingleTargetMove(gen, moveName, { isCrit: crit });
    if (move.category === 'Status') return { ...empty, category: 'Status', type: move.type };
    const result = calculate(gen, a, d, move, buildField(field, reversed));
    const [min, max] = result.range();
    const hp = d.maxHP();
    if (max === 0) {
      // smogon-calc's desc()/kochance() assert on 0 damage, so explain the immunity ourselves.
      // ok stays false so the row renders as one compact line, like a status move.
      return { ...empty, category: move.category, type: move.type, defenderHP: hp, desc: immunityReason(d, move, field) };
    }
    // Re-run the KO text through our copy of the library's logic so it also counts the effects it lacks.
    const ds = defenderSide;
    const extra = {
      curse: ds.isCurse,
      bound: ds.isBound,
      bindingBand: ds.hasBindingBand,
      ingrain: ds.isIngrain,
      aquaRing: ds.isAquaRing,
      disguise: disguiseIntact(attacker, defender, moveName),
    };
    let ko = '';
    let libKo = '';
    try {
      libKo = result.kochance().text;
      ko = getKOChance(gen, result.attacker, result.defender, result.move, result.field, result.damage, false, extra).text;
    } catch {
      /* some moves have no KO text */
    }
    let fullDesc = result.desc();
    if (libKo && ko !== libKo && fullDesc.endsWith(libKo)) fullDesc = fullDesc.slice(0, -libKo.length) + ko;
    return {
      move: moveName,
      ok: true,
      category: move.category,
      type: move.type,
      min,
      max,
      minPct: Math.round((min / hp) * 1000) / 10,
      maxPct: Math.round((max / hp) * 1000) / 10,
      defenderHP: hp,
      ko,
      desc: fullDesc,
      rolls: rollsFrom(result.damage, min, max),
      curHP: d.curHP(),
    };
  } catch (e) {
    return { ...empty, desc: e instanceof Error ? e.message : String(e) };
  }
}
