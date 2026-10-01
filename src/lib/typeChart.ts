import { toID } from '@smogon/calc';
import { gen } from './model';

/** The 18 real types (the data also contains a "???" placeholder). */
const TYPES = [...gen.types].map((t) => t.name).filter((n) => n !== '???');

export interface Matchups {
  /** Attacking types grouped by the damage multiplier they deal to a Pokémon with these types. */
  x4: string[];
  x2: string[];
  half: string[];
  quarter: string[];
  immune: string[];
}

/** Type-only matchups for a Pokémon: each attacking type's multiplier is the product over its defending types. */
export function typeMatchups(defending: string[]): Matchups {
  const out: Matchups = { x4: [], x2: [], half: [], quarter: [], immune: [] };
  for (const atk of TYPES) {
    const chart = gen.types.get(toID(atk))?.effectiveness as Record<string, number> | undefined;
    if (!chart) continue;
    const m = defending.reduce((acc, d) => acc * (chart[d] ?? 1), 1);
    if (m === 0) out.immune.push(atk);
    else if (m >= 4) out.x4.push(atk);
    else if (m >= 2) out.x2.push(atk);
    else if (m <= 0.25) out.quarter.push(atk);
    else if (m < 1) out.half.push(atk);
  }
  return out;
}
