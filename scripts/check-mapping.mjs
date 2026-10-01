// Dev helper: report op.gg keys/names/items/moves that don't resolve in @smogon/calc data.
import fs from 'node:fs';
import { Generations, toID } from '@smogon/calc';
import { speciesCandidates } from '../src/lib/names.ts';

const gen = Generations.get(9);
const d = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
const miss = { species: new Set(), item: new Set(), move: new Set(), ability: new Set() };
const resolve = (key) => speciesCandidates(key, d.names[key]).find((c) => gen.species.get(toID(c)));
for (const [key, p] of Object.entries(d.pokemon)) {
  if (!resolve(key)) miss.species.add(`${key} (${d.names[key]})`);
  for (const f of ['single', 'double']) {
    const x = p[f];
    if (!x) continue;
    x.items.forEach((i) => !gen.items.get(toID(i.name)) && miss.item.add(i.name));
    x.moves.forEach((i) => !gen.moves.get(toID(i.name)) && miss.move.add(i.name));
    x.abilities.forEach((i) => !gen.abilities.get(toID(i.name)) && miss.ability.add(i.name));
    x.mega.forEach((m) => !resolve(m.key) && miss.species.add(`mega:${m.key}`));
  }
}
for (const [k, v] of Object.entries(miss)) console.log(k, [...v]);
