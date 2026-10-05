// Dev helper: Focus Sash / Sturdy. At full HP the holder survives a would-be KO at 1 HP, so a one-hit KO takes two
// hits: in the damage panel's KO text, in "what to bring", and in the move recommender.
import { analyze } from '../src/lib/bring.ts';
import { blankField, calcMove, sashIntact } from '../src/lib/calc.ts';
import { blankSet } from '../src/lib/model.ts';
import { killTimes, koProbability, profile } from '../src/lib/recommend.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const mk = (species, moves, ability, item = '', sp = {}) => ({ ...blankSet(species), ability, item, nature: 'Serious', moves: [...moves, '', '', '', ''].slice(0, 4), sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp } });
const singles = () => ({ ...blankField(), gameType: 'Singles' });
const kingambit = mk('Kingambit', ['Sucker Punch'], 'Defiant', '', { atk: 32 }); // a clean OHKO on frail targets
const ceruledge = (item) => mk('Ceruledge', ['Bitter Blade'], 'Flash Fire', item);
const fireAt = (att, def, move = 'Sucker Punch') => calcMove(att, def, move, false, singles());

// ---- helper
check('Focus Sash at full HP is active', sashIntact(kingambit, ceruledge('Focus Sash'), 'Sucker Punch'));
check('not active once damaged', !sashIntact(kingambit, { ...ceruledge('Focus Sash'), hpPercent: 99 }, 'Sucker Punch'));
check('no item, no Sash', !sashIntact(kingambit, ceruledge(''), 'Sucker Punch'));
check('Sturdy works, and Mold Breaker ignores it', sashIntact(kingambit, mk('Ceruledge', [], 'Sturdy'), 'Sucker Punch') && !sashIntact(mk('Excadrill', [], 'Mold Breaker'), mk('Ceruledge', [], 'Sturdy'), 'Sucker Punch'));
check('Mold Breaker does not ignore a Focus Sash', sashIntact(mk('Excadrill', [], 'Mold Breaker'), ceruledge('Focus Sash'), 'Sucker Punch'));
check('multi-hit moves are not adjusted', !sashIntact(kingambit, ceruledge('Focus Sash'), 'Population Bomb'));

// ---- damage panel
const plain = fireAt(kingambit, ceruledge(''));
const sash = fireAt(kingambit, ceruledge('Focus Sash'));
check('without a Sash it is an OHKO (test setup)', /OHKO/.test(plain.ko) && !/2HKO/.test(plain.ko), plain.ko);
check('with a Sash it is a 2HKO and says why', /2HKO/.test(sash.ko) && /Sash/.test(sash.ko) && !/(^|[^2])OHKO/.test(sash.ko), sash.ko);
check('damage numbers are unchanged', plain.minPct === sash.minPct && plain.maxPct === sash.maxPct);
check('a damaged Sash holder gets the normal text', /OHKO/.test(fireAt(kingambit, { ...ceruledge('Focus Sash'), hpPercent: 50 }).ko));
check('a move that was not a KO is untouched', fireAt(mk('Garchomp', ['Dragon Claw'], 'Rough Skin'), ceruledge('Focus Sash'), 'Dragon Claw').ko === fireAt(mk('Garchomp', ['Dragon Claw'], 'Rough Skin'), ceruledge(''), 'Dragon Claw').ko);

// ---- what to bring
const bring = analyze([kingambit], [ceruledge('Focus Sash')], singles());
const bringPlain = analyze([kingambit], [ceruledge('')], singles());
check('what to bring: 2 hits through a Sash, 1 without', bring.cells?.[0]?.[0]?.mine.turns === 2 && bringPlain.cells?.[0]?.[0]?.mine.turns === 1, JSON.stringify([bring.cells?.[0]?.[0]?.mine.turns, bringPlain.cells?.[0]?.[0]?.mine.turns]));

// ---- recommender
const ctx = (def) => ({ att: kingambit, def, field: singles(), reversed: false, accOf: () => 1 });
const pS = profile(ctx(ceruledge('Focus Sash')), 'Sucker Punch', () => 0, null, () => 0);
const pN = profile(ctx(ceruledge('')), 'Sucker Punch', () => 0, null, () => 0);
const kS = killTimes(pS);
const kN = killTimes(pN);
check('recommender: dead on turn 2 through a Sash, turn 1 without', Math.abs(kS[0]) < 1e-9 && Math.abs(kS[1] - 1) < 1e-9 && Math.abs(kN[0] - 1) < 1e-9, `${kS.slice(0, 3)} vs ${kN.slice(0, 3)}`);
check('doubles helper: a lone hit cannot KO through a Sash, two can', koProbability([{ acc: 1, rolls: [100] }], 100, false, 0, true) === 0 && koProbability([{ acc: 1, rolls: [100] }, { acc: 1, rolls: [1] }], 100, false, 0, true) === 1 && koProbability([{ acc: 1, rolls: [100] }], 100) === 1);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
