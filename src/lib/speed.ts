import { toID } from '@smogon/calc';
import type { FieldState, SideState } from './calc';
import { calcStats, gen, moveInfo, STAT_KEYS, type PokemonSet, type StatKey } from './model';

/**
 * @smogon/calc only records positive priority, so negative brackets are filled in here. Checked against Smogon's
 * Champions dex: these are exactly its negative-priority moves, plus a few (Vital Throw, Revenge...) that aren't in
 * Champions. Magic Room and Wonder Room are normal priority; only Trick Room is -7.
 */
const NEGATIVE_PRIORITY: Record<string, number> = {
  'Vital Throw': -1,
  'Focus Punch': -3,
  'Beak Blast': -3,
  'Shell Trap': -3,
  Avalanche: -4,
  Revenge: -4,
  Counter: -5,
  'Mirror Coat': -5,
  'Dragon Tail': -6,
  'Circle Throw': -6,
  Roar: -6,
  Whirlwind: -6,
  Teleport: -6,
  'Trick Room': -7,
};

export interface SpeedInfo {
  speed: number;
  /** Speed stat before stages/modifiers */
  raw: number;
  /** Human-readable modifiers that changed it, e.g. ["+1", "Choice Scarf", "Tailwind"] */
  notes: string[];
}

function pokeRound(n: number): number {
  return n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n);
}

/** Speed the game uses to order moves: stat -> stages -> modifier chain -> paralysis -> cap. */
export function effectiveSpeed(set: PokemonSet, field: FieldState, side: SideState): SpeedInfo | undefined {
  const stats = calcStats(set.species, set.nature, set.sp);
  if (!stats) return undefined;
  const notes: string[] = [];
  const raw = stats.spe;

  const stage = set.boosts.spe;
  let speed = stage >= 0 ? Math.floor((raw * (2 + stage)) / 2) : Math.floor((raw * 2) / (2 - stage));
  if (stage) notes.push(stage > 0 ? `+${stage}` : `${stage}`);

  const ability = set.ability;
  const item = field.isMagicRoom ? '' : set.item; // Magic Room suppresses held items
  const mods: number[] = [];
  const add = (m: number, note: string) => {
    mods.push(m);
    notes.push(note);
  };

  if (item === 'Choice Scarf') add(1.5, 'Choice Scarf');
  if (item === 'Iron Ball') add(0.5, 'Iron Ball');
  if (side.isTailwind) add(2, 'Tailwind');

  const w = field.weather;
  if (ability === 'Swift Swim' && (w === 'Rain' || w === 'Heavy Rain')) add(2, 'Swift Swim');
  if (ability === 'Chlorophyll' && (w === 'Sun' || w === 'Harsh Sunshine')) add(2, 'Chlorophyll');
  if (ability === 'Sand Rush' && w === 'Sand') add(2, 'Sand Rush');
  if (ability === 'Slush Rush' && w === 'Snow') add(2, 'Slush Rush');
  if (ability === 'Surge Surfer' && field.terrain === 'Electric') add(2, 'Surge Surfer');
  if (ability === 'Unburden' && set.abilityOn) add(2, 'Unburden');
  if (ability === 'Slow Start' && set.abilityOn) add(0.5, 'Slow Start');
  if (set.status && ability === 'Quick Feet') add(1.5, 'Quick Feet');

  if ((ability === 'Protosynthesis' || ability === 'Quark Drive') && set.abilityOn) {
    // Boosts the highest stat (Atk > Def > SpA > SpD > Spe on ties); only matters here if that stat is Speed.
    const order: StatKey[] = STAT_KEYS.filter((k) => k !== 'hp');
    const best = order.reduce((a, k) => (stats[k] > stats[a] ? k : a), order[0]);
    if (best === 'spe') add(1.5, ability);
  }

  if (mods.length) {
    const chain = mods.reduce((m, x) => pokeRound(m * x), 4096);
    speed = pokeRound((speed * chain) / 4096);
  }
  if (set.status === 'par' && ability !== 'Quick Feet') {
    speed = Math.floor(speed / 2);
    notes.push('Paralysis');
  }
  return { speed: Math.max(1, Math.min(10000, speed)), raw, notes };
}

export interface PriorityInfo {
  move: string;
  priority: number;
  note?: string;
}

/** Priority bracket of a move for this Pokemon in this field, including Prankster / Gale Wings / Grassy Glide. */
export function movePriority(set: PokemonSet, moveName: string, field: FieldState): PriorityInfo | undefined {
  const raw = moveName ? gen.moves.get(toID(moveName)) : undefined;
  const mv = moveInfo(moveName);
  if (!raw || !mv) return undefined;
  let priority = (raw as { priority?: number }).priority ?? NEGATIVE_PRIORITY[mv.name] ?? 0;
  let note: string | undefined;
  if (set.ability === 'Prankster' && mv.category === 'Status') {
    priority += 1;
    note = 'Prankster';
  } else if (set.ability === 'Gale Wings' && mv.type === 'Flying' && set.hpPercent === 100) {
    priority += 1;
    note = 'Gale Wings';
  } else if (mv.name === 'Grassy Glide' && field.terrain === 'Grassy') {
    priority += 1;
    note = 'Grassy Terrain';
  }
  return { move: mv.name, priority, note };
}

export type Faster = 'a' | 'b' | 'tie';

/** Who moves first between two speeds (accounting for Trick Room). */
export function compareSpeed(a: number, b: number, trickRoom: boolean): Faster {
  if (a === b) return 'tie';
  return (a > b) !== trickRoom ? 'a' : 'b';
}
