import { baseForMega, megaFor } from '../src/lib/showdown.ts';
import { calcStats } from '../src/lib/model.ts';
const sp = { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 };
for (const [base, item] of [['Garchomp', 'Garchompite Z'], ['Charizard', 'Charizardite X'], ['Charizard', 'Charizardite Y'], ['Garchomp', 'Leftovers']]) {
  const mega = megaFor(base, item);
  console.log(base, '+', item, '->', mega ?? 'no mega', '| roundtrip', mega && baseForMega(mega)?.base);
  if (mega) console.log('  base spe', calcStats(base, 'Jolly', sp).spe, '| mega spe', calcStats(mega, 'Jolly', sp).spe);
}
