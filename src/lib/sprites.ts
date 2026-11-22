import { toID } from '@smogon/calc';
import { gen } from './model';

const SD = 'https://play.pokemonshowdown.com/sprites';

/** Showdown's sprite id: base species + squashed forme, e.g. Tauros-Paldea-Blaze -> tauros-paldeablaze. */
function showdownId(species: string): string {
  if (species === 'Aegislash-Shield') return 'aegislash';
  if (species === 'Aegislash-Blade') return 'aegislash-blade';
  // the Champions data has no base species for these, so the generic rule would squash the hyphen
  if (species === 'Floette-Eternal') return 'floette-eternal';
  if (species === 'Floette-Mega') return 'floette-mega';
  const sp = gen.species.get(toID(species));
  const base = sp?.baseSpecies;
  if (base && species.startsWith(base + '-')) return `${toID(base)}-${toID(species.slice(base.length + 1))}`;
  return toID(species);
}

/**
 * Showdown only has 2-5 KB placeholder images (or nothing) for the Megas new in Legends: Z-A, so these use the
 * Pokémon Champions animations, via PokeStats.gg, resized to 96px and stored in public/sprites/.
 */
const LOCAL_ANIMATED = new Set([
  'absol-megaz', 'barbaracle-mega', 'baxcalibur-mega', 'chandelure-mega', 'chesnaught-mega', 'chimecho-mega',
  'crabominable-mega', 'delphox-mega', 'dragalge-mega', 'drampa-mega', 'eelektross-mega', 'excadrill-mega',
  'falinks-mega', 'floette-mega', 'garchomp-megaz', 'glimmora-mega', 'golisopod-mega', 'golurk-mega',
  'greninja-mega', 'hawlucha-mega', 'lucario-megaz', 'malamar-mega', 'meowstic-fmega', 'meowstic-mmega',
  'pyroar-mega', 'raichu-megax', 'raichu-megay', 'scolipede-mega', 'scovillain-mega', 'scrafty-mega',
  'staraptor-mega',
]);

/**
 * Image sources to try in order: Showdown's animated sprite, then its static placeholder
 * (used for new Pokemon and Z-A Megas that have no animation yet).
 */
export function spriteSources(species: string): string[] {
  const id = showdownId(species);
  const local = LOCAL_ANIMATED.has(id) ? [`${import.meta.env?.BASE_URL ?? "/"}sprites/${id}.webp`] : [];
  return [...local, `${SD}/ani/${id}.gif`, `${SD}/gen5/${id}.png`];
}
