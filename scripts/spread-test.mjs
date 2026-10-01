// Dev helper: spread moves (x0.75 in Doubles) only apply when the move would hit more than one Pokemon.
import { calcMove, blankField } from '../src/lib/calc.ts';
import { zeroBoosts, zeroSP } from '../src/lib/model.ts';

const mk = (species, ability, sp = {}) => ({ species, item: '', ability, nature: 'Serious', sp: { ...zeroSP(), ...sp }, moves: [], status: '', boosts: zeroBoosts(), hpPercent: 100, abilityOn: false, critMoves: [] });
const F = ({ gameType = 'Doubles', yours, theirs, terrain = '', reflect = false } = {}) => {
  const f = blankField();
  f.gameType = gameType;
  f.terrain = terrain;
  if (yours !== undefined) f.attackerSide.active = yours;
  if (theirs !== undefined) f.defenderSide.active = theirs;
  if (reflect) f.defenderSide.isReflect = true;
  return f;
};
let fails = 0;
const check = (label, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', label, detail); };
const close = (a, b, tol = 0.04) => Math.abs(a - b) < tol;

const garch = mk('Garchomp', 'Rough Skin', { atk: 32, spa: 32 });
const tgt = mk('Incineroar', 'Intimidate', { hp: 32 });
const dmg = (atk, def, move, field, reversed = false) => calcMove(atk, def, move, false, field, reversed).max;

// --- allAdjacentFoes: only the foes count
const rs2 = dmg(garch, tgt, 'Rock Slide', F());
const rs1 = dmg(garch, tgt, 'Rock Slide', F({ theirs: 1 }));
check('default (no setting) behaves like 2 on field', rs2 === dmg(garch, tgt, 'Rock Slide', F({ theirs: 2 })));
check('Rock Slide vs 1 foe is not reduced (x1/0.75)', close(rs1 / rs2, 1 / 0.75), `${rs2} -> ${rs1}`);
check('your own ally count does not matter for Rock Slide', dmg(garch, tgt, 'Rock Slide', F({ theirs: 1, yours: 1 })) === rs1);

// --- allAdjacent (Earthquake): foes + your ally
const eq22 = dmg(garch, tgt, 'Earthquake', F());
check('Earthquake, 1 foe but you have an ally: still a spread move', dmg(garch, tgt, 'Earthquake', F({ theirs: 1, yours: 2 })) === eq22);
check('Earthquake, 2 foes and no ally: spread', dmg(garch, tgt, 'Earthquake', F({ theirs: 2, yours: 1 })) === eq22);
const eq11 = dmg(garch, tgt, 'Earthquake', F({ theirs: 1, yours: 1 }));
check('Earthquake, 1 foe and no ally: no reduction', close(eq11 / eq22, 1 / 0.75), `${eq22} -> ${eq11}`);

// --- Singles is already single-target, and matches a lone target in Doubles
check('Singles Rock Slide equals Doubles vs a lone foe', dmg(garch, tgt, 'Rock Slide', F({ gameType: 'Singles' })) === rs1);
check('active setting is ignored in Singles', dmg(garch, tgt, 'Rock Slide', F({ gameType: 'Singles', theirs: 2 })) === rs1);

// --- non-spread moves never change
check('single-target move ignores the setting', dmg(garch, tgt, 'Dragon Claw', F({ theirs: 1 })) === dmg(garch, tgt, 'Dragon Claw', F()));

// --- screens keep their Doubles value (2/3) even with a lone target; Singles uses 1/2
const claw = (f) => dmg(garch, tgt, 'Dragon Claw', f);
const rDouble = claw(F({ theirs: 1, reflect: true })) / claw(F({ theirs: 1 }));
const rSingle = claw(F({ gameType: 'Singles', reflect: true })) / claw(F({ gameType: 'Singles' }));
check('Reflect with one foe left in Doubles is still x2/3', close(rDouble, 2 / 3, 0.03), rDouble.toFixed(3));
check('Reflect in Singles is x1/2', close(rSingle, 1 / 2, 0.03), rSingle.toFixed(3));

// --- Expanding Force only spreads in Psychic Terrain; a lone foe means no cut
const efTarget = mk('Gyarados', 'Intimidate', { hp: 32 }); // not Dark, so Psychic hits
const ef = (f) => dmg(mk('Gardevoir', 'Trace', { spa: 32 }), efTarget, 'Expanding Force', f);
const ef2 = ef(F({ terrain: 'Psychic' }));
const ef1 = ef(F({ terrain: 'Psychic', theirs: 1 }));
check('Expanding Force vs a lone foe in Psychic Terrain: no spread cut', close(ef1 / ef2, 1 / 0.75), `${ef2} -> ${ef1}`);

// --- the opponent attacking you reads YOUR side's count
const opp = mk('Garchomp', 'Rough Skin', { atk: 32 });
const me = mk('Incineroar', 'Intimidate', { hp: 32 });
const back2 = dmg(opp, me, 'Rock Slide', F(), true);
const back1 = dmg(opp, me, 'Rock Slide', F({ yours: 1 }), true);
check('Opponent Rock Slide into your lone Pokémon: no cut', close(back1 / back2, 1 / 0.75), `${back2} -> ${back1}`);
check('...and the opponent having one Pokémon does not matter for that move', dmg(opp, me, 'Rock Slide', F({ theirs: 1 }), true) === back2);
const backEq = dmg(opp, me, 'Earthquake', F({ yours: 1, theirs: 1 }), true);
check('Opponent Earthquake, you have 1 and they have 1: no cut', close(backEq / dmg(opp, me, 'Earthquake', F(), true), 1 / 0.75));

// --- KO text still works with the single-target move
const r = calcMove(garch, tgt, 'Rock Slide', false, F({ theirs: 1 }), false);
check('KO text and description still produced', r.ok && r.ko.length > 0 && r.desc.length > 0, r.ko);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
