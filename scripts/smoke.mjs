// Dev helper: sanity-check the paste parser + calc pipeline without a browser.
import { parsePaste } from '../src/lib/showdown.ts';
import { calcMove, blankField } from '../src/lib/calc.ts';
import { calcStats } from '../src/lib/model.ts';

const paste = `Garchomp @ Garchompite Z
Ability: Sand Force
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Stealth Rock

Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 4 Atk / 30 SpD
Careful Nature
- Fake Out
- Flare Blitz`;

const { sets, warnings } = parsePaste(paste);
console.log('warnings', warnings);
for (const s of sets) console.log(s.species, s.ability, s.nature, JSON.stringify(s.sp), s.moves.join(','), JSON.stringify(calcStats(s.species, s.nature, s.sp)));
const [a, b] = sets;
for (const m of a.moves.filter(Boolean)) {
  const r = calcMove(a, b, m, false, blankField());
  console.log(m, r.ok, r.minPct, r.maxPct, '|', r.ko, '|', r.desc);
}
const r = calcMove(b, a, 'Flare Blitz', false, blankField(), true);
console.log('Flare Blitz', r.minPct, r.maxPct, r.desc);

// EV-style paste (252 -> 32 SP)
console.log(JSON.stringify(parsePaste('Incineroar\nEVs: 252 HP / 252 Atk / 4 SpD').sets[0].sp));
