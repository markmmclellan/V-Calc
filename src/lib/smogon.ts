const SMOGON_DEX = 'https://www.smogon.com/dex/champions/pokemon';

// Species whose Smogon page name differs from the calculator's species name.
const SLUG_OVERRIDES: Record<string, string> = {
  Meowstic: 'meowstic-m',
  'Meowstic-Mega': 'meowstic-m-mega',
  'Aegislash-Shield': 'aegislash',
  'Aegislash-Blade': 'aegislash-blade',
  'Aegislash-Both': 'aegislash',
};

/** Smogon's page name: lowercase and hyphenated ("Ninetales-Alola" -> "ninetales-alola", "Mr. Mime" -> "mr-mime"). */
export function smogonSlug(species: string): string {
  return (
    SLUG_OVERRIDES[species] ??
    species
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

/**
 * Link to the Smogon Champions analysis for a species. Mega forms redirect to their base Pokémon's page
 * (the new Z-A Megas have their own), so the plain form name is always a valid address.
 */
export const smogonUrl = (species: string): string => `${SMOGON_DEX}/${smogonSlug(species)}/`;
