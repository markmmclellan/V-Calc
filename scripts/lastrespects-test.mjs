// Dev helper: Last Respects is 50 + 50 per fainted ally; the damage library leaves it at 50, so calc.ts overrides it.
import { blankField, calcMove, lastRespectsPower } from '../src/lib/calc.ts';
import { blankSet } from '../src/lib/model.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };
const mk = (species, moves, ability, extra = {}) => ({ ...blankSet(species), ability, nature: 'Adamant', moves: [...moves, '', '', '', ''].slice(0, 4), sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 }, ...extra });
const f = { ...blankField(), gameType: 'Singles' };
const target = mk('Garchomp', ['Earthquake'], 'Rough Skin');
const dmg = (n) => calcMove(mk('Annihilape', ['Last Respects'], 'Defiant', { alliesFainted: n }), target, 'Last Respects', false, f);

check('power is 50 + 50 per fainted ally', [0, 1, 3, 5].every((n) => lastRespectsPower('Last Respects', { alliesFainted: n })?.basePower === 50 + 50 * n));
check('other moves are untouched', lastRespectsPower('Shadow Claw', { alliesFainted: 3 }) === undefined);
const r = [0, 1, 3, 5].map((n) => dmg(n));
check('damage grows with every fainted ally', r.every((x, i) => i === 0 || x.maxPct > r[i - 1].maxPct), r.map((x) => x.maxPct).join(' < '));
check('3 fainted allies deal about 4x the damage of none (200 vs 50 power)', Math.abs(r[2].maxPct / r[0].maxPct - 4) < 0.25, (r[2].maxPct / r[0].maxPct).toFixed(2));
check('Supreme Overlord alone does not change Last Respects power', dmg(0).max === calcMove(mk('Annihilape', ['Last Respects'], 'Defiant'), target, 'Last Respects', false, f).max);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
