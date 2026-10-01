// Dev helper: every species the calculator knows must map to a real Smogon dex page.
// Usage: node scripts/smogon-test.mjs        (uses Smogon's own entry list, fetched from the Salamence page)
import { Generations } from '@smogon/calc';
import { smogonSlug, smogonUrl } from '../src/lib/smogon.ts';

const html = await (await fetch('https://www.smogon.com/dex/champions/pokemon/salamence/', { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
const settings = JSON.parse(html.match(/dexSettings = (\{[\s\S]*?\})\s*<\/script>/)[1]);
const basics = settings.injectRpcs.find((r) => JSON.stringify(r[0]).includes('dump-basics'))[1];
const smogon = new Set(basics.pokemon.map((p) => smogonSlug(p.name)));

const species = [...Generations.get(0).species].map((s) => s.name);
const missing = species.filter((n) => !smogon.has(smogonSlug(n)));
console.log(`calculator species ${species.length}, Smogon pages ${smogon.size}`);
console.log('no matching Smogon page:', missing.length ? missing : 'none');
console.log(smogonUrl('Salamence'));
for (const n of ['Garchomp-Mega-Z', 'Charizard-Mega-X', 'Ninetales-Alola', 'Mr. Mime', "Farfetch'd", 'Meowstic', 'Meowstic-F', 'Aegislash-Shield', 'Rotom-Wash', 'Tauros-Paldea-Blaze']) console.log(n.padEnd(22), smogonUrl(n));
process.exit(missing.length ? 1 : 0);
