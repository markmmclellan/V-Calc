import type { Field, Move, Pokemon } from '@smogon/calc';
import type { Generation } from '@smogon/calc/dist/data/interface';

/** Extra per-turn effects on the defender that @smogon/calc doesn't model. */
export interface ExtraResidual {
  curse?: boolean;
  bound?: boolean;
  bindingBand?: boolean;
  ingrain?: boolean;
  aquaRing?: boolean;
  /** The defender is an intact Mimikyu: the first hit is blocked and costs it 1/8 max HP. */
  disguise?: boolean;
}

export function getKOChance(
  gen: Generation,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
  damage: unknown,
  err: boolean,
  extra?: ExtraResidual,
): { chance: number; n: number; text: string };
