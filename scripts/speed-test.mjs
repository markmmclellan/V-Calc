// Dev helper: check turn-order math against hand-computed values.
import { blankSet, zeroSP } from '../src/lib/model.ts';
import { blankField, blankSide } from '../src/lib/calc.ts';
import { effectiveSpeed, movePriority, compareSpeed } from '../src/lib/speed.ts';

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? got : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const mk = (species, over = {}) => ({ ...blankSet(species), ...over });
const f = blankField();
const s = blankSide();

// Garchomp base 102: floor((204+31)/2)=117 +5 = 122; Jolly +10% => floor(1.1*(122+32)) = 169
const g = mk('Garchomp', { nature: 'Jolly', sp: { ...zeroSP(), spe: 32 } });
eq('Garchomp Jolly 32 Spe', effectiveSpeed(g, f, s)?.speed, 169);
eq('+1', effectiveSpeed({ ...g, boosts: { ...g.boosts, spe: 1 } }, f, s)?.speed, 253);
eq('-1', effectiveSpeed({ ...g, boosts: { ...g.boosts, spe: -1 } }, f, s)?.speed, 112);
eq('Scarf', effectiveSpeed({ ...g, item: 'Choice Scarf' }, f, s)?.speed, 253);
eq('Scarf + Magic Room', effectiveSpeed({ ...g, item: 'Choice Scarf' }, { ...f, isMagicRoom: true }, s)?.speed, 169);
eq('Tailwind', effectiveSpeed(g, f, { ...s, isTailwind: true })?.speed, 338);
eq('Paralysis', effectiveSpeed({ ...g, status: 'par' }, f, s)?.speed, 84);
const swift = mk('Qwilfish', { ability: 'Swift Swim' }); // Kingdra isn't in Champions
const base = effectiveSpeed(swift, f, s).speed;
eq('Swift Swim in Rain', effectiveSpeed(swift, { ...f, weather: 'Rain' }, s)?.speed, base * 2);
eq('Swift Swim no rain', effectiveSpeed(swift, f, s)?.speed, base);

eq('faster', compareSpeed(200, 100, false), 'a');
eq('trick room', compareSpeed(200, 100, true), 'b');
eq('tie', compareSpeed(100, 100, true), 'tie');

const inc = mk('Incineroar');
eq('Fake Out', movePriority(inc, 'Fake Out', f)?.priority, 3);
eq('Dragon Tail', movePriority(g, 'Dragon Tail', f)?.priority, -6);
eq('Earthquake', movePriority(g, 'Earthquake', f)?.priority, 0);
eq('Prankster Taunt', movePriority(mk('Whimsicott', { ability: 'Prankster' }), 'Taunt', f)?.priority, 1);
eq('Trick Room', movePriority(g, 'Trick Room', f)?.priority, -7);
process.exit(fail ? 1 : 0);
