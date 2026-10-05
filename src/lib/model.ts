import { calcStat, Generations, Move, NATURES, toID } from '@smogon/calc';

// Generation 0 is @smogon/calc's native Pokemon Champions ruleset: Champions move data, level 50, Stat Points.
export const gen = Generations.get(0);

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};
export type StatTable = Record<StatKey, number>;
export type BoostTable = Record<Exclude<StatKey, 'hp'>, number>;

// Pokemon Champions rules: level 50, IVs fixed at 31, 66 Stat Points total, max 32 per stat.
export const LEVEL = 50;
export const SP_MAX = 32;
export const SP_TOTAL = 66;

export interface MoveInfo {
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  bp: number;
}

const moveCache = new Map<string, MoveInfo | null>();

/**
 * A move's name, type, category and base power, or undefined if it isn't a known move.
 * The calculator's raw Champions move data is sparse (75 status moves, such as Nasty Plot, have no `category` stored),
 * so never read `gen.moves.get(...).category` directly: building a `Move` fills the gaps in correctly.
 */
export function moveInfo(name: string): MoveInfo | undefined {
  const id = toID(name);
  if (!id) return undefined;
  let info = moveCache.get(id);
  if (info === undefined) {
    try {
      const m = gen.moves.get(id) ? new Move(gen, name) : undefined;
      info = m ? { name: m.name, type: m.type, category: m.category as MoveInfo['category'], bp: m.bp ?? 0 } : null;
    } catch {
      info = null;
    }
    moveCache.set(id, info);
  }
  return info ?? undefined;
}

export const zeroSP = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
export const zeroBoosts = (): BoostTable => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

export type Status = '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';

export interface PokemonSet {
  species: string; // smogon calc species name, e.g. "Garchomp" or "Garchomp-Mega-Z"
  nickname?: string;
  item: string;
  ability: string;
  nature: string;
  sp: StatTable;
  moves: string[];
  status: Status;
  boosts: BoostTable;
  hpPercent: number; // 1-100
  abilityOn: boolean;
  alliesFainted?: number; // 0-5, for Supreme Overlord
  critMoves: boolean[]; // per move slot
}

export const natureNames = Object.keys(NATURES);

export function natureMods(nature: string): { plus?: StatKey; minus?: StatKey } {
  const n = (NATURES as Record<string, [string, string]>)[nature];
  if (!n || n[0] === n[1]) return {};
  return { plus: n[0] as StatKey, minus: n[1] as StatKey };
}

export function baseStatsOf(species: string): StatTable | undefined {
  const s = gen.species.get(toID(species));
  return s ? (s.baseStats as StatTable) : undefined;
}

/** Final stats using the library's Champions formula (level 50, IV 31; each Stat Point is +1 to the final stat). */
export function calcStats(species: string, nature: string, sp: StatTable): StatTable | undefined {
  const base = baseStatsOf(species);
  if (!base) return undefined;
  const out = {} as StatTable;
  for (const k of STAT_KEYS) out[k] = calcStat(gen, k, base[k], 31, sp[k], LEVEL, nature);
  return out;
}

export function spTotal(sp: StatTable): number {
  return STAT_KEYS.reduce((a, k) => a + sp[k], 0);
}

export function blankSet(species = 'Garchomp'): PokemonSet {
  const s = gen.species.get(toID(species));
  return {
    species,
    item: '',
    ability: s?.abilities?.[0] ?? '',
    nature: 'Serious',
    sp: zeroSP(),
    moves: ['', '', '', ''],
    status: '',
    boosts: zeroBoosts(),
    hpPercent: 100,
    abilityOn: false,
    critMoves: [false, false, false, false],
  };
}
