// Dev helper: the "Most used" list is built from public/data/champions.json - every entry must be usable.
import fs from 'node:fs';
import { resolveSpecies } from '../src/lib/data.ts';
import { smogonSlug } from '../src/lib/smogon.ts';

const d = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
const keys = Object.keys(d.pokemon);
const unresolved = keys.filter((k) => !resolveSpecies(k, d.names[k]));
console.log(`${keys.length} Pokemon pages saved | unresolved species: ${unresolved.length ? unresolved.join(', ') : 'none'}`);
for (const f of ['single', 'double']) {
  const ranks = keys.map((k) => d.pokemon[k].rank[f]).filter((r) => r != null).sort((a, b) => a - b);
  const dupes = ranks.length - new Set(ranks).size;
  console.log(`${f.padEnd(6)} ranked: ${ranks.length} | first ${ranks[0]} last ${ranks.at(-1)} | duplicate ranks: ${dupes} | unranked: ${keys.length - ranks.length}`);
}
const rime = d.pokemon['mr.-rime'];
console.log('Mr. Rime saved:', !!rime, '| species:', resolveSpecies('mr.-rime', d.names['mr.-rime']), '| smogon page:', smogonSlug('Mr. Rime'));
process.exit(unresolved.length ? 1 : 0);
