// Dev helper: which Pokémon (and every Mega form) lack a real animated sprite.
// Showdown answers 200 with a 2-5 KB placeholder for Megas it hasn't animated yet, so a file that small counts as
// missing; real animations are 14 KB and up. Fix: add the Pokémon Champions animation to public/sprites/ and to
// LOCAL_ANIMATED in src/lib/sprites.ts.
import fs from 'fs';
import { toID } from '@smogon/calc';
import { spriteSources } from '../src/lib/sprites.ts';
import { resolveSpecies } from '../src/lib/data.ts';
import { gen } from '../src/lib/model.ts';

const PLACEHOLDER_MAX = 8000;
const d = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
const all = new Set(Object.keys(d.names).map((k) => resolveSpecies(k, d.names[k])).filter(Boolean));
for (const s of gen.species) if (/-Mega/.test(s.name) && gen.species.get(toID(s.name))) all.add(s.name);

const size = async (u) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u);
      return r.ok ? (await r.arrayBuffer()).byteLength : 0;
    } catch {}
  }
  return 0;
};
const missing = [];
const local = [];
const queue = [...all];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const first = spriteSources(s)[0];
    if (!first.startsWith('http')) {
      local.push(s);
      if (!fs.existsSync(`public${first}`)) missing.push(`${s} (file ${first} missing)`);
      continue;
    }
    const n = await size(first);
    if (n <= PLACEHOLDER_MAX) missing.push(`${s} (${n} B)`);
  }
}));
console.log(all.size, 'species incl. Megas |', local.length, 'use our own animation');
console.log(missing.length ? `no real animation: ${missing.sort().join(', ')}` : 'all passed');
