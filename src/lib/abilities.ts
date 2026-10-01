import { toID } from '@smogon/calc';
import { gen } from './model';

// species id -> ability names, filled in from op.gg's roster by loadMeta()
let byForm = new Map<string, string[]>();

export function setFormAbilities(m: Map<string, string[]>) {
  byForm = m;
}

/**
 * Abilities a species can have. @smogon/calc's species data only lists the first one, so prefer op.gg's
 * full roster and fall back to the calc's data if op.gg has nothing for this form.
 */
export function abilitiesOf(species: string): string[] {
  const id = toID(species);
  const known = (byForm.get(id) ?? []).filter((a) => gen.abilities.get(toID(a)));
  if (known.length) return known;
  const s = gen.species.get(id);
  return s ? [...new Set(Object.values(s.abilities ?? {}) as string[])] : [];
}
