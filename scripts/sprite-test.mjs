import fs from 'fs';
import { spriteSources } from '../src/lib/sprites.ts';
import { resolveSpecies } from '../src/lib/data.ts';
const d = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
const species = Object.keys(d.names).map((k) => resolveSpecies(k, d.names[k])).filter(Boolean);
const miss = { ani: [], none: [] };
const queue = [...species];
await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) { const s = queue.shift();
  const [a, b] = spriteSources(s);
  const ok = async (u) => { for (let i = 0; i < 3; i++) { try { return (await fetch(u, { method: 'HEAD' })).ok; } catch {} } return false; };
  if (await ok(a)) continue;
  if (await ok(b)) { miss.ani.push(s); continue; }
  miss.none.push(s);
} }));
console.log(species.length, 'species | static-only:', miss.ani.length, '| op.gg fallback:', miss.none.length);
console.log('static-only:', miss.ani.sort().join(', '));
console.log('op.gg fallback:', miss.none.sort().join(', '));
