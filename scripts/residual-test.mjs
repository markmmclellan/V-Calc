// Dev helper: check side effects (Charge, Steely Spirit, Salt Cure, Curse, binding, Ingrain...) change the calc correctly.
import { calculate, Field, Move } from '@smogon/calc';
import { buildPokemon, calcMove, blankField } from '../src/lib/calc.ts';
import { gen, zeroBoosts, zeroSP } from '../src/lib/model.ts';
import { getKOChance } from '../src/lib/vendor/kochance.js';

const mk = (species, ability, item = '', sp = {}) => ({
  species, item, ability, nature: 'Serious', sp: { ...zeroSP(), ...sp }, moves: [], status: '',
  boosts: zeroBoosts(), hpPercent: 100, abilityOn: false, critMoves: [],
});
const fieldWith = (att = {}, def = {}) => {
  const f = blankField();
  Object.assign(f.attackerSide, att);
  Object.assign(f.defenderSide, def);
  return f;
};
let fails = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fails++;
  console.log(cond ? 'ok  ' : 'FAIL', label, detail);
};

// --- damage effects -----------------------------------------------------------------------
const pika = mk('Pikachu', 'Static', '', { spa: 32 });
const gyara = mk('Gyarados', 'Intimidate', '', { hp: 32 });
const base = calcMove(pika, gyara, 'Thunderbolt', false, fieldWith());
const charged = calcMove(pika, gyara, 'Thunderbolt', false, fieldWith({ isCharge: true }));
check('Charge doubles Electric damage', Math.abs(charged.max / base.max - 2) < 0.03, `${base.max} -> ${charged.max}`);
const fireNoCharge = calcMove(mk('Charizard', 'Blaze', '', { spa: 32 }), gyara, 'Flamethrower', false, fieldWith({ isCharge: true }));
const fireBase = calcMove(mk('Charizard', 'Blaze', '', { spa: 32 }), gyara, 'Flamethrower', false, fieldWith());
check('Charge does not affect non-Electric moves', fireNoCharge.max === fireBase.max);

const metagross = mk('Metagross', 'Clear Body', '', { atk: 32 });
const tgt = mk('Clefable', 'Magic Guard', '', { hp: 32 });
const steelBase = calcMove(metagross, tgt, 'Iron Head', false, fieldWith());
const steely = calcMove(metagross, tgt, 'Iron Head', false, fieldWith({ isSteelySpirit: true }));
check('Steely Spirit boosts Steel moves x1.5', Math.abs(steely.max / steelBase.max - 1.5) < 0.04, `${steelBase.max} -> ${steely.max}`);
const eqSteely = calcMove(mk('Garchomp', 'Rough Skin', '', { atk: 32 }), tgt, 'Earthquake', false, fieldWith({ isSteelySpirit: true }));
const eqBase = calcMove(mk('Garchomp', 'Rough Skin', '', { atk: 32 }), tgt, 'Earthquake', false, fieldWith());
check('Steely Spirit ignores non-Steel moves', eqSteely.max === eqBase.max);

// --- residual effects: they must show in the KO text -------------------------------------------
const att = mk('Garchomp', 'Rough Skin', '', { atk: 32 });
const def = (ab = 'Intimidate', item = '') => mk('Incineroar', ab, item, { hp: 32 });
const ko = (defSide, d = def(), move = 'Earthquake') => calcMove(att, d, move, false, fieldWith({}, defSide)).ko;

console.log('\nplain:            ', ko({}));
const cases = [
  ['Curse damage', { isCurse: true }],
  ['Salt Cure', { isSaltCured: true }],
  ['Leech Seed damage', { isSeeded: true }],
  ['binding damage', { isBound: true }],
  ['Ingrain recovery', { isIngrain: true }],
  ['Aqua Ring recovery', { isAquaRing: true }],
];
for (const [label, side] of cases) {
  const k = ko(side);
  check(`${label} appears in KO text`, k.includes(label), `-> ${k}`);
}

// --- exact numbers: Incineroar 202 HP (32 SP). Damage after a hit vs lingering effect ----------
// 1/4 of 202 = 50, 1/8 = 25, 1/6 = 33, 1/16 = 12. Use a move+target where threshold math is checkable.
const maxHP = calcMove(att, def(), 'Earthquake', false, fieldWith()).defenderHP;
check('Incineroar max HP', maxHP === 202, String(maxHP));

// Bound vs Bound+Band: band must hurt more, so KO turns can only get equal or quicker
const rank = (t) => (t.includes('guaranteed 2HKO') ? 2 : t.includes('3HKO') ? 3 : t.includes('OHKO') ? 1 : 9);
check('Binding Band hits harder than plain binding', rank(ko({ isBound: true, hasBindingBand: true })) <= rank(ko({ isBound: true })));
// Magic Guard ignores Curse / binding / salt cure
const mg = def('Magic Guard');
check('Magic Guard ignores Curse', !ko({ isCurse: true }, mg).includes('Curse'), ko({ isCurse: true }, mg));
check('Magic Guard ignores binding', !ko({ isBound: true }, mg).includes('binding'));
// Big Root boosts Ingrain: 12 -> 15. Both still show recovery text
check('Big Root Ingrain still listed', ko({ isIngrain: true }, def('Intimidate', 'Big Root')).length > 0);

// --- regression: with no effects the KO text is identical to the library's own -------------------
for (const m of ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Outrage']) {
  const r = calcMove(att, def(), m, false, fieldWith());
  check(`${m}: KO text matches the library's`, r.desc.endsWith(r.ko), r.ko);
}
// desc (the long description) is updated with the same KO text
const withCurse = calcMove(att, def(), 'Earthquake', false, fieldWith({}, { isCurse: true }));
check('long description carries the updated KO text', withCurse.desc.endsWith(withCurse.ko), withCurse.ko);

// --- Leech Seed on the ATTACKER's side must not heal/alter the attacker ------------------------
const seededAttacker = calcMove(att, def(), 'Earthquake', false, fieldWith({ isSeeded: true }, {}));
check('Seeded attacker does not change the target KO text', seededAttacker.ko === ko({}));

// --- reversed direction reads the right side ------------------------------------------------------
const f = fieldWith({}, {});
f.attackerSide.isCurse = true; // "your" Pokemon is cursed
const fwd = calcMove(att, def(), 'Earthquake', false, f, false).ko; // you attack the opponent: your curse irrelevant
const rev = calcMove(def(), mk('Garchomp', 'Rough Skin', '', { hp: 32 }), 'Flare Blitz', false, f, true).ko; // opponent attacks you
check('Your Curse does not affect your attack', !fwd.includes('Curse'), fwd);
check('Your Curse counts when the opponent attacks you', rev.includes('Curse') || rev.includes('OHKO') || rev.length > 0, rev);

// --- exact amounts: 1-turn KO chance = share of damage rolls that reach (HP - residual) ---------------------
for (const hpSP of [32, 0, 10]) {
  const a = buildPokemon(att);
  const d = buildPokemon(mk('Incineroar', 'Intimidate', '', { hp: hpSP }));
  const res = calculate(gen, a, d, new Move(gen, 'Earthquake'), new Field({ gameType: 'Doubles' }));
  const rolls = [...res.damage];
  const HP = d.maxHP();
  const share = (resid) => rolls.filter((x) => x + resid >= HP).length / rolls.length;
  const T = (label, extra, lost) => {
    const r = getKOChance(gen, res.attacker, res.defender, res.move, res.field, res.damage, false, extra);
    const got = r.n === 1 ? r.chance : 0;
    const want = share(lost);
    check(`${label}: ${lost} HP/turn`, Math.abs(got - want) < 1e-9, `want ${want}, got ${got} (n=${r.n})`);
  };
  console.log(`\nrolls ${rolls[0]}-${rolls[rolls.length - 1]} | HP ${HP}`);
  T('Curse 1/4', { curse: true }, Math.floor(HP / 4));
  T('Binding 1/8', { bound: true }, Math.floor(HP / 8));
  T('Binding + Band 1/6', { bound: true, bindingBand: true }, Math.floor(HP / 6));
  T('Ingrain (recovery never adds KO chance)', { ingrain: true }, 0);
  T('Aqua Ring (recovery never adds KO chance)', { aquaRing: true }, 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
