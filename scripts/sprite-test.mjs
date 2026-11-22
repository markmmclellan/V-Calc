import fs from 'fs';
import { spriteSources } from '../src/lib/sprites.ts';
import { resolveSpecies } from '../src/lib/data.ts';
const d = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
const species = Object.keys(d.names).map((k) => resolveSpecies(k, d.names[k])).filter(Boolean);
const miss = { ani: [], none: [] }; const local = [];
const queue = [...species];
await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) { const s = queue.shift();
  if (spriteSources(s)[0].includes('/sprites/') && !spriteSources(s)[0].startsWith('http')) { local.push(s); continue; }
  const [a, b] = spriteSources(s);
  const ok = async (u) => { for (let i = 0; i < 3; i++) { try { return (await fetch(u, { method: 'HEAD' })).ok; } catch {} } return false; };
  if (await ok(a)) continue;
  if (await ok(b)) { miss.ani.push(s); continue; }
  miss.none.push(s);
} }));
console.log(species.length, 'species | static-only:', miss.ani.length, '| op.gg fallback:', miss.none.length);
console.log('static-only:', miss.ani.sort().join(', '));
console.log('op.gg fallback:', miss.none.sort().join(', '));
console.log('our own animated:', local.sort().join(', '), local.every((s) => fs.existsSync(`public${spriteSources(s)[0]}`)) ? '(files present)' : 'MISSING FILE');
