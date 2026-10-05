// Dev helper: Mimikyu's Disguise. The first hit it takes does nothing and costs it 1/8 max HP (Smogon's Champions dex),
// so it takes one more hit than the raw damage suggests, in the damage panel's KO text and in "what to bring".
import { analyze } from '../src/lib/bring.ts';
import { blankField, calcMove, disguiseIntact } from '../src/lib/calc.ts';
import { blankSet } from '../src/lib/model.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const mk = (species, moves, ability, sp = {}) => ({ ...blankSet(species), ability, nature: 'Serious', moves: [...moves, '', '', '', ''].slice(0, 4), sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp } });
const singles = () => ({ ...blankField(), gameType: 'Singles' });
const mimi = (species = 'Mimikyu') => mk(species, ['Play Rough', 'Shadow Claw'], 'Disguise');
const kingambit = mk('Kingambit', ['Iron Head'], 'Defiant', { atk: 32 });   // 129-154%: a clean OHKO normally
const garchomp = mk('Garchomp-Mega-Z', ['Earthquake'], 'Levitate', { atk: 32 }); // ~53-63%: a 2HKO normally

// ---- the helper
check('intact Mimikyu with Disguise is protected', disguiseIntact(kingambit, mimi(), 'Iron Head'));
check('ticking "Disguise broken" (abilityOn) removes the protection', !disguiseIntact(kingambit, { ...mimi(), abilityOn: true }, 'Iron Head'));
check('Mimikyu-Busted is not protected', !disguiseIntact(kingambit, mimi('Mimikyu-Busted'), 'Iron Head'));
check('a Pokémon without Disguise is not protected', !disguiseIntact(kingambit, mk('Mimikyu', ['Play Rough'], 'Technician'), 'Iron Head'));
check('Mold Breaker ignores Disguise', !disguiseIntact(mk('Excadrill', ['Iron Head'], 'Mold Breaker'), mimi(), 'Iron Head'));
check('multi-hit moves are not adjusted (only the first hit is blocked)', !disguiseIntact(kingambit, mimi(), 'Population Bomb') && !disguiseIntact(kingambit, mimi(), 'Double Kick') && !disguiseIntact(kingambit, mimi(), 'Bullet Seed'));
check('other Pokémon are never affected', !disguiseIntact(kingambit, mk('Garchomp', ['Earthquake'], 'Rough Skin'), 'Iron Head'));

// ---- the damage panel's KO text
const intact = calcMove(kingambit, mimi(), 'Iron Head', false, singles());
const busted = calcMove(kingambit, mimi('Mimikyu-Busted'), 'Iron Head', false, singles());
check('busted Mimikyu: still a plain OHKO', /OHKO/.test(busted.ko) && !/Disguise/.test(busted.ko), busted.ko);
check('intact Mimikyu: NOT a one-shot, needs 2 hits and says why', /2HKO/.test(intact.ko) && /Disguise/.test(intact.ko) && !/(^|[^2])OHKO/.test(intact.ko), intact.ko);
check('the damage numbers themselves are unchanged (per hit)', intact.minPct === busted.minPct && intact.maxPct === busted.maxPct, `${intact.minPct}-${intact.maxPct}%`);
check('the long description carries the same KO text', intact.desc.endsWith(intact.ko), '');
const eqIntact = calcMove(garchomp, mimi(), 'Earthquake', false, singles());
const eqBusted = calcMove(garchomp, mimi('Mimikyu-Busted'), 'Earthquake', false, singles());
check('a 2HKO becomes a 3HKO while the Disguise is up', /3HKO/.test(eqIntact.ko) && /2HKO/.test(eqBusted.ko), `${eqIntact.ko} | busted: ${eqBusted.ko}`);
const mold = calcMove(mk('Excadrill', ['Iron Head'], 'Mold Breaker', { atk: 32 }), mimi(), 'Iron Head', false, singles());
check('Mold Breaker: the Disguise is ignored (still a plain KO text)', !/Disguise/.test(mold.ko), mold.ko);

// ---- "what to bring"
const a = analyze([kingambit], [mimi()], 'single');
const c = a.cells[0][0];
check('vs intact Mimikyu the engine needs 2 hits, not 1', c.mine.turns === 2 && c.mine.disguise === true, `${c.mine.move} ${Math.round(c.mine.pct)}% -> ${c.mine.turns} hits`);
const ab = analyze([kingambit], [mimi('Mimikyu-Busted')], 'single');
check('vs busted Mimikyu it is a 1-hit KO', ab.cells[0][0].mine.turns === 1 && !ab.cells[0][0].mine.disguise);
const ag = analyze([garchomp], [mimi()], 'single');
check('2HKO becomes 3 hits (first blocked, 1/8 chip, then 2 more)', ag.cells[0][0].mine.turns === 3, `${Math.round(ag.cells[0][0].mine.pct)}% -> ${ag.cells[0][0].mine.turns}`);
check("Mimikyu's own attacks are never slowed", analyze([mimi()], [kingambit], 'single').cells[0][0].mine.disguise !== true);
// the extra hit can flip a close race
const race = analyze([kingambit], [mk('Mimikyu', ['Shadow Claw'], 'Disguise', { atk: 32, spe: 32 })], 'single').cells[0][0];
const noDisguise = analyze([kingambit], [mk('Mimikyu-Busted', ['Shadow Claw'], 'Disguise', { atk: 32, spe: 32 })], 'single').cells[0][0];
check('the extra hit makes the matchup look worse for the attacker', race.score <= noDisguise.score, `intact ${race.score.toFixed(2)} vs busted ${noDisguise.score.toFixed(2)}`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
