import { parsePaste, exportSet } from '../src/lib/showdown.ts';
const paste = `RAWR XD (Archaludon) @ Sitrus Berry
Ability: Stalwart
Level: 50
EVs: 2 Def / 32 HP / 32 SpD
Modest Nature
- Electro Shot
- Steel Beam
- Dragon Pulse
- Snarl

Zoomer (Garchomp) (M) @ Garchompite Z
Ability: Sand Force
Jolly Nature
- Earthquake

Bob (Charizard) (F)
- Flamethrower

Incineroar (M) @ Sitrus Berry
- Fake Out

Garchomp @ Leftovers
- Earthquake`;
const { sets, warnings } = parsePaste(paste);
console.log('warnings', warnings);
for (const s of sets) console.log(JSON.stringify({ species: s.species, nickname: s.nickname, item: s.item, ability: s.ability, moves: s.moves.filter(Boolean) }));
console.log('---\n' + exportSet(sets[0]) + '\n---\n' + exportSet(sets[1]));
