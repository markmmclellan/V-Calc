/** op.gg slug -> @smogon/calc species, for forms whose naming differs. */
const OVERRIDES: Record<string, string> = {
  aegislash: 'Aegislash-Shield',
  'floette-eternal-flower': 'Floette-Eternal',
  'indeedee-male': 'Indeedee',
  'indeedee-female': 'Indeedee-F',
  'basculegion-male': 'Basculegion',
  'basculegion-female': 'Basculegion-F',
  'meowstic-male': 'Meowstic',
  'meowstic-female': 'Meowstic-F',
  'mega-meowstic-male': 'Meowstic-Mega',
  'mega-meowstic-female': 'Meowstic-F-Mega',
  'toxtricity-amped': 'Toxtricity',
  'maushold-family-of-three': 'Maushold',
  'gourgeist-average': 'Gourgeist',
  'squawkabilly-green-plumage': 'Squawkabilly',
  'squawkabilly-yellow-plumage': 'Squawkabilly-Yellow',
};

/**
 * op.gg identifies Pokemon by slug ("arcanine-hisui", "mega-garchomp-z") and display name.
 * Return candidate @smogon/calc species names, best guess first.
 */
export function speciesCandidates(key: string, displayName?: string): string[] {
  const out: string[] = [];
  if (OVERRIDES[key]) out.push(OVERRIDES[key]);
  const norm = key.replace('-alolan', '-alola').replace('-galarian', '-galar').replace('-paldean', '-paldea').replace('-hisuian', '-hisui');
  const parts = norm.split('-');
  if (parts[0] === 'mega') {
    // mega-garchomp-z -> Garchomp-Mega-Z ; mega-charizard-x -> Charizard-Mega-X
    const rest = parts.slice(1);
    const last = rest[rest.length - 1];
    if ((last === 'x' || last === 'y' || last === 'z') && rest.length > 1) {
      out.push([...rest.slice(0, -1), 'Mega', last.toUpperCase()].join('-'));
    }
    out.push([...rest, 'Mega'].join('-'));
  }
  out.push(norm, key);
  if (displayName) out.push(displayName, displayName.replace(/\s+/g, '-'));
  return out;
}
