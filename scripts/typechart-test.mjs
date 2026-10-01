// Dev helper: type matchups for known Pokemon.   npx tsx scripts/typechart-test.mjs
import { typeMatchups } from '../src/lib/typeChart.ts';

const sort = (a) => [...a].sort().join(',');
let fails = 0;
const eq = (label, got, want) => {
  const ok = sort(got) === sort(want);
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', label.padEnd(34), ok ? sort(got) || '(none)' : `got ${sort(got)} | want ${sort(want)}`);
};

// Dragon (e.g. Garchomp-Mega-Z)
let m = typeMatchups(['Dragon']);
eq('Dragon  4x', m.x4, []);
eq('Dragon  2x', m.x2, ['Ice', 'Dragon', 'Fairy']);
eq('Dragon  1/2x', m.half, ['Fire', 'Water', 'Electric', 'Grass']);
eq('Dragon  immune', m.immune, []);

// Dragon/Flying (Salamence): Ice 4x, Ground immune, Grass 1/4x
m = typeMatchups(['Dragon', 'Flying']);
eq('Dragon/Flying  4x', m.x4, ['Ice']);
eq('Dragon/Flying  2x', m.x2, ['Dragon', 'Fairy', 'Rock']);
eq('Dragon/Flying  1/2x', m.half, ['Fire', 'Water', 'Fighting', 'Bug']);
eq('Dragon/Flying  1/4x', m.quarter, ['Grass']);
eq('Dragon/Flying  immune', m.immune, ['Ground']);

// Steel/Ghost (Gholdengo): Normal, Poison and others
m = typeMatchups(['Steel', 'Ghost']);
eq('Steel/Ghost  immune', m.immune, ['Normal', 'Fighting', 'Poison']);
eq('Steel/Ghost  2x', m.x2, ['Fire', 'Ground', 'Ghost', 'Dark']);

// Fire/Dark (Incineroar): Fighting 2x... Ghost/Dark cancel; Psychic immune
m = typeMatchups(['Fire', 'Dark']);
eq('Fire/Dark  immune', m.immune, ['Psychic']);
eq('Fire/Dark  4x', m.x4, []);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
