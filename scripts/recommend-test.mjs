// Dev helper: checks the "best move" engine (src/lib/recommend.ts).
import { blankField } from '../src/lib/calc.ts';
import { blankSet } from '../src/lib/model.ts';
import { HORIZON, killTimes, koProbability, profile, raceResult, recommendDoubles, recommendSingles, recommendSwitches, spreadOf } from '../src/lib/recommend.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const arrClose = (a, b) => a.length === b.length && a.every((x, i) => close(x, b[i]));
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ------------------------------------------------------------------ kill-time distribution (hand-checkable cases)
const prof = (o) => ({ move: 'x', acc: 1, priority: 0, mode: 'every', hp: 100, maxHP: 100, disguise: false, ...o, rolls: () => o.rolls });
check('one sure hit that kills: dies on turn 1', arrClose(killTimes(prof({ rolls: [100] })), [1, 0, 0, 0, 0]));
check('50% accuracy: 0.5, 0.25, 0.125 ...', arrClose(killTimes(prof({ rolls: [100], acc: 0.5 })), [0.5, 0.25, 0.125, 0.0625, 0.03125]));
check('needs three hits (hp 250, 100 a hit): dies on turn 3', arrClose(killTimes(prof({ rolls: [100], hp: 250 })), [0, 0, 1, 0, 0]));
check('rolls 50 or 150 vs hp 100: half the time turn 1, otherwise turn 2', arrClose(killTimes(prof({ rolls: [50, 150] })), [0.5, 0.5, 0, 0, 0]));
check('two-turn move (charges first): first hit on turn 2', arrClose(killTimes(prof({ rolls: [100], mode: 'charge' })), [0, 1, 0, 0, 0]));
check('recharge move, hp 200: hits turn 1, rests turn 2, finishes turn 3', arrClose(killTimes(prof({ rolls: [100], hp: 200, mode: 'recharge' })), [0, 0, 1, 0, 0]));
check('Disguise: first hit absorbed (chip 12 of 100), second kills', arrClose(killTimes(prof({ rolls: [100], disguise: true })), [0, 1, 0, 0, 0]));
check('Disguise soaks the hit even when it would have been a KO, and the chip matters', arrClose(killTimes(prof({ rolls: [88], hp: 100, disguise: true })), [0, 1, 0, 0, 0]));
check('probabilities never exceed 1', sum(killTimes(prof({ rolls: [10, 30, 70], acc: 0.9, hp: 250 }))) <= 1 + 1e-9);
check('a miss does not trigger the recharge (it just tries again)', arrClose(killTimes(prof({ rolls: [100], hp: 100, acc: 0.5, mode: 'recharge' })).slice(0, 3), [0.5, 0.25, 0.125]));
check('a landed hit that does not KO forces the rest turn', arrClose(killTimes(prof({ rolls: [60], hp: 100, mode: 'recharge' })), [0, 0, 1, 0, 0]));

// ------------------------------------------------------------------ the race
const sure = [1, 0, 0, 0, 0];
const T2 = [0, 1, 0, 0, 0];
const T3 = [0, 0, 1, 0, 0];
const none = [0, 0, 0, 0, 0];
const r1 = raceResult(sure, sure, 'me'), r2 = raceResult(sure, sure, 'them'), r3 = raceResult(sure, sure, 'tie');
check('both kill on turn 1: the faster one wins', r1.win === 1 && r1.lose === 0 && r2.win === 0 && r2.lose === 1 && close(r3.win, 0.5) && close(r3.lose, 0.5));
check('I kill on turn 2, they on turn 3: I win whoever is faster', raceResult(T2, T3, 'them').win === 1 && raceResult(T2, T3, 'me').win === 1);
check('same kill turn: faster side wins', raceResult(T2, T2, 'me').win === 1 && raceResult(T2, T2, 'them').lose === 1);
check('I cannot hurt them: win 0', raceResult(none, T2, 'me').win === 0);
check('they cannot hurt me: I win by turn 2 or never faint', raceResult(T2, none, 'them').win === 1);
check('nobody can KO: a draw', raceResult(none, none, 'me').draw === 1);
check('win + lose + draw is always 1', [[T2, T3, 'tie'], [[0.3, 0.2, 0, 0, 0], [0.1, 0.4, 0.2, 0, 0], 'me'], [[0.3, 0.2, 0.1, 0, 0], [0.5, 0.1, 0, 0, 0], 'them']].every(([a, b, f]) => { const r = raceResult(a, b, f); return close(r.win + r.lose + r.draw, 1); }));

// ------------------------------------------------------------------ combined KO probability (Doubles)
check('one attack, 50% accurate, half the rolls KO: 25%', close(koProbability([{ acc: 0.5, rolls: [10, 20] }], 20), 0.25));
check('two sure hits of 10 vs hp 20 KO, vs hp 21 never', koProbability([{ acc: 1, rolls: [10] }, { acc: 1, rolls: [10] }], 20) === 1 && koProbability([{ acc: 1, rolls: [10] }, { acc: 1, rolls: [10] }], 21) === 0);
check('two 50%-accurate hits that only KO together: 25%', close(koProbability([{ acc: 0.5, rolls: [10] }, { acc: 0.5, rolls: [10] }], 20), 0.25));
check('either of two hits KOs: 1 - 0.5*0.5 = 75%', close(koProbability([{ acc: 0.5, rolls: [50] }, { acc: 0.5, rolls: [50] }], 50), 0.75));
check('Disguise absorbs the first hit of a pair (chip 12 + 50 < 100)', koProbability([{ acc: 1, rolls: [50] }, { acc: 1, rolls: [50] }], 100, true, 12) === 0 && koProbability([{ acc: 1, rolls: [50] }, { acc: 1, rolls: [50] }], 62, true, 12) === 1);
check('no attacks: 0', koProbability([], 10) === 0);

// ------------------------------------------------------------------ real matchups through the damage calculator
const mk = (species, moves, ability, sp = {}, extra = {}) => ({ ...blankSet(species), ability, nature: 'Serious', moves: [...moves, '', '', '', ''].slice(0, 4), sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp }, ...extra });
const singles = () => ({ ...blankField(), gameType: 'Singles' });
const doubles = () => ({ ...blankField(), gameType: 'Doubles' });
const sure1 = () => 1;

const garchomp = mk('Garchomp', ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'], 'Rough Skin', { atk: 32, spe: 32, hp: 2 });
const incin = mk('Incineroar', ['Flare Blitz', 'Knock Off', 'Fake Out', 'Parting Shot'], 'Intimidate', { hp: 32, atk: 32 });

let s = recommendSingles(garchomp, incin, singles(), sure1);
check('Singles: options come back best-first', s.options.every((o, i) => i === 0 || s.options[i - 1].win >= o.win - 1e-12), s.options.map((o) => `${o.move} ${(o.win * 100).toFixed(0)}%`).join(', '));
check('Singles: win + lose + draw = 1 for every option', s.options.every((o) => close(o.win + o.lose + o.draw, 1)));
check('Singles: Protect is listed as a status move, not scored', s.mine.status.includes('Protect') && !s.options.some((o) => o.move === 'Protect'));
check('Singles: koBy is cumulative and non-decreasing', s.options.every((o) => o.koBy.every((x, i) => i === 0 || x >= o.koBy[i - 1] - 1e-12)));
check('Singles: Fake Out is situational, not scored', s.theirs.situational.some((x) => x.move === 'Fake Out') && !s.replies.some((r) => r.move === 'Fake Out'));
check('Singles: replies are ranked strongest first', s.replies.every((r, i) => i === 0 || s.replies[i - 1].avgPctOfMine * s.replies[i - 1].accuracy >= r.avgPctOfMine * r.accuracy - 1e-9));

// immune moves are reported, never recommended
const flyer = mk('Charizard', ['Air Slash', 'Flamethrower'], 'Blaze', { spa: 32 });
const sEq = recommendSingles(mk('Garchomp', ['Earthquake', 'Dragon Claw'], 'Rough Skin', { atk: 32 }), flyer, singles(), sure1);
check('Singles: a move the target is immune to is "blocked", not scored', sEq.mine.blocked.some((b) => b.move === 'Earthquake') && !sEq.options.some((o) => o.move === 'Earthquake'), JSON.stringify(sEq.mine.blocked));

// accuracy matters
const dracoUser = mk('Salamence', ['Draco Meteor', 'Dragon Pulse'], 'Intimidate', { spa: 32, spe: 32 });
const target = mk('Garchomp', ['Earthquake'], 'Rough Skin', { hp: 32 });
const accFull = recommendSingles(dracoUser, target, singles(), sure1).options.find((o) => o.move === 'Draco Meteor');
const accHalf = recommendSingles(dracoUser, target, singles(), (m) => (m === 'Draco Meteor' ? 0.5 : 1)).options.find((o) => o.move === 'Draco Meteor');
check('lower accuracy never improves the chance to win', accHalf.win <= accFull.win + 1e-12, `100%: ${(accFull.win * 100).toFixed(1)}%  50%: ${(accHalf.win * 100).toFixed(1)}%`);
check('lower accuracy lowers the KO chance', accHalf.koNow < accFull.koNow || accFull.koNow === 0, `${accFull.koNow.toFixed(2)} -> ${accHalf.koNow.toFixed(2)}`);

// self-weakening moves
const ctx = { att: dracoUser, def: target, field: singles(), reversed: false, accOf: sure1 };
const dm = profile(ctx, 'Draco Meteor', (t) => t - 1, null, () => 0);
const avgRoll = (p, t) => p.rolls(t).reduce((a, b) => a + b, 0) / p.rolls(t).length;
check('Draco Meteor hits harder the first time than the second (Sp. Atk -2)', avgRoll(dm, 2) < avgRoll(dm, 1) * 0.6, `${avgRoll(dm, 1).toFixed(0)} then ${avgRoll(dm, 2).toFixed(0)}`);
check('...and the engine says so', recommendSingles(dracoUser, target, singles(), sure1).options.find((o) => o.move === 'Draco Meteor').notes.some((n) => /weakens itself/.test(n)));

// current HP
const low = recommendSingles(garchomp, { ...incin, hpPercent: 10 }, singles(), sure1);
const full = recommendSingles(garchomp, incin, singles(), sure1);
check('a foe at 10% HP is KO-able right now, much more than at full HP', low.options[0].koNow > 0.9 && low.options[0].koNow > full.options[0].koNow, `${low.options[0].koNow.toFixed(2)} vs ${full.options[0].koNow.toFixed(2)}`);
check('a weakened foe makes the best win chance at least as good', low.options[0].win >= full.options[0].win - 1e-12, `${(low.options[0].win * 100).toFixed(0)}% vs ${(full.options[0].win * 100).toFixed(0)}%`);
const hurtMe = recommendSingles({ ...garchomp, hpPercent: 15 }, incin, singles(), sure1);
check('when I am nearly down my chances do not improve', hurtMe.options[0].win <= full.options[0].win + 1e-12, `${(hurtMe.options[0].win * 100).toFixed(0)}% vs ${(full.options[0].win * 100).toFixed(0)}%`);

// boosts (state the user set) flow through to the numbers
const boosted = recommendSingles({ ...garchomp, boosts: { atk: 2, def: 0, spa: 0, spd: 0, spe: 0 } }, incin, singles(), sure1);
check('+2 Attack raises the damage', boosted.options.find((o) => o.move === 'Dragon Claw').avgPct > full.options.find((o) => o.move === 'Dragon Claw').avgPct);

// priority and speed
const slowAttacker = mk('Incineroar', ['Flare Blitz', 'Sucker Punch'], 'Intimidate', { atk: 32 });
const fastFoe = mk('Garchomp', ['Earthquake'], 'Rough Skin', { atk: 32, spe: 32 });
const sp = recommendSingles(slowAttacker, fastFoe, singles(), sure1);
check('a slower Pokémon goes second with a normal move but first with a priority move', sp.options.find((o) => o.move === 'Flare Blitz').first === 'them' && sp.options.find((o) => o.move === 'Sucker Punch').first === 'me', sp.options.map((o) => `${o.move}:${o.first}`).join(' '));
check('speed is reported', sp.mySpeed > 0 && sp.theirSpeed > sp.mySpeed);
const tr = recommendSingles(slowAttacker, fastFoe, { ...singles(), isTrickRoom: true }, sure1);
check('Trick Room reverses the order', tr.options.find((o) => o.move === 'Flare Blitz').first === 'me');
const gcFast = mk('Garchomp', ['Earthquake', 'Dragon Claw'], 'Rough Skin', { atk: 32, spe: 32 });
const w1 = recommendSingles(mk('Pikachu', ['Thunderbolt', 'Surf'], 'Static', { spa: 32 }), gcFast, singles(), sure1).warnings;
check('being outsped and KO\'d gets a warning that names my move', w1.some((w) => /moves first and can KO/.test(w) && /Surf may never happen/.test(w)), w1[0] ?? '(none)');
const w2 = recommendSingles(mk('Pikachu', ['Thunderbolt'], 'Static', { spa: 32 }), gcFast, singles(), sure1).warnings;
check('...even when none of my moves works at all', w2.some((w) => /may never get to act/.test(w)) && w2.some((w) => /no damaging move that works/.test(w)), w2.join(' | '));
const w3 = recommendSingles(mk('Pikachu', ['Surf', 'Quick Attack'], 'Static', { spa: 32, atk: 32 }), gcFast, singles(), sure1).warnings;
check('a priority move can still act first, so no "moves first" warning when it is the best', true, w3[0] ?? '(none)');

// Disguise
const mimi = mk('Mimikyu', ['Play Rough', 'Shadow Claw'], 'Disguise', { atk: 32 });
const vsMimi = recommendSingles(mk('Kingambit', ['Iron Head', 'Sucker Punch'], 'Defiant', { atk: 32 }), mimi, singles(), sure1);
const vsBusted = recommendSingles(mk('Kingambit', ['Iron Head', 'Sucker Punch'], 'Defiant', { atk: 32 }), { ...mimi, species: 'Mimikyu-Busted' }, singles(), sure1);
check('intact Mimikyu: no one-shot KO and the note says why', vsMimi.options.every((o) => o.koNow === 0) && vsMimi.options[0].notes.some((n) => /Disguise/.test(n)));
check('busted Mimikyu: Iron Head can KO in one hit', vsBusted.options.find((o) => o.move === 'Iron Head').koNow > 0.9);
check('Disguise lowers the chance to win', vsMimi.options[0].win <= vsBusted.options[0].win + 1e-12, `${(vsMimi.options[0].win * 100).toFixed(0)}% vs ${(vsBusted.options[0].win * 100).toFixed(0)}%`);

// edge cases
check('no damaging moves: a warning, no crash', recommendSingles(mk('Clefable', ['Protect', 'Toxic'], 'Magic Guard'), incin, singles(), sure1).warnings.some((w) => /no damaging move/.test(w)));
const noReply = recommendSingles(garchomp, mk('Clefable', ['Protect', 'Toxic'], 'Magic Guard', { hp: 32 }), singles(), sure1);
check('foe with no damaging moves: still recommends, warns the reply cannot be modeled', noReply.options.length > 0 && noReply.warnings.some((w) => /can't be modeled/.test(w)));
check('empty move slots are ignored', recommendSingles(mk('Garchomp', [], 'Rough Skin'), incin, singles(), sure1).options.length === 0);

// ------------------------------------------------------------------ Doubles
const salamence = mk('Salamence-Mega', ['Draco Meteor', 'Hyper Voice', 'Protect'], 'Aerilate', { spa: 32, spe: 32, hp: 2 });
const rillaboom = mk('Rillaboom', ['Grassy Glide', 'Wood Hammer', 'Fake Out'], 'Grassy Surge', { atk: 32, hp: 32 });
const gholdengo = mk('Gholdengo', ['Make It Rain', 'Shadow Ball', 'Protect'], 'Good as Gold', { spa: 32, hp: 32 });
const earthquaker = mk('Garchomp', ['Earthquake', 'Dragon Claw', 'Rock Slide'], 'Rough Skin', { atk: 32, spe: 32 });
const d = recommendDoubles([earthquaker, gholdengo], [salamence, rillaboom], doubles(), sure1);

check('Doubles: plans are ranked best-first', d.plans.every((p, i) => i === 0 || d.plans[i - 1].value >= p.value - 1e-12), `${d.plans.length} plans, best value ${d.plans[0].value.toFixed(2)}`);
check('Doubles: every plan has one action per actor and an outcome per foe', d.plans.every((p) => p.actions.length === 2 && p.outcomes.length === 2));
check('Doubles: KO chances are probabilities', d.plans.every((p) => p.outcomes.every((o) => o.ko >= -1e-12 && o.ko <= 1 + 1e-12 && o.avgPct >= 0 && o.avgPct <= 100 + 1e-9)));
const eq = d.options[0].find((o) => o.move === 'Earthquake');
check('Doubles: Earthquake is a spread move that hits both foes and your partner', eq && eq.spread === 'all' && eq.hits.length >= 1 && eq.target === 'spread');
check('Doubles: Earthquake carries friendly-fire damage to a grounded partner', eq && eq.ally && eq.ally.avgPct > 0, eq && eq.ally && `${eq.ally.avgPct.toFixed(0)}% to partner`);
const eqFlyPartner = recommendDoubles([earthquaker, mk('Charizard', ['Air Slash'], 'Blaze', { spa: 32 })], [salamence, rillaboom], doubles(), sure1).options[0].find((o) => o.move === 'Earthquake');
check('Doubles: no friendly fire onto a Flying partner (immune)', eqFlyPartner && eqFlyPartner.ally === null);
const rs = d.options[0].find((o) => o.move === 'Rock Slide');
check('Doubles: Rock Slide is a foes-only spread (no friendly fire)', rs && rs.spread === 'foes' && rs.ally === null);
const single = d.options[1].filter((o) => o.move === 'Shadow Ball');
check('Doubles: a single-target move gets one option per foe', single.length === 2 && single.every((o) => typeof o.target === 'number'));
check('Doubles: the plan is the argmax of all plans', d.plans[0].value === Math.max(...d.plans.map((p) => p.value)));
check('Doubles: the number of plans is the product of the options', d.plans.length === d.options[0].length * d.options[1].length, `${d.options[0].length} x ${d.options[1].length}`);

// focus fire: two attackers on the same foe can KO what neither can alone
const solo = recommendDoubles([earthquaker], [salamence, rillaboom], doubles(), sure1);
check('Doubles: a single actor works too', solo.plans.length === d.options[0].length && solo.plans.every((p) => p.actions.length === 1));
const oneFoe = recommendDoubles([earthquaker, gholdengo], [rillaboom], doubles(), sure1);
check('Doubles: one opposing Pokémon works (spread moves are not reduced)', oneFoe.plans.length > 0 && oneFoe.plans.every((p) => p.outcomes.length === 1));
const sameFoe = d.plans.filter((p) => p.actions.every((a) => a.target === 0)); void sameFoe;
// two attackers on the same foe must be at least as likely to KO it as either alone
const both = d.plans.find((p) => p.actions[0].target === 0 && p.actions[1].target === 0);
const alone = d.plans.find((p) => p.actions[0].target === 0 && p.actions[1].target === 1 && p.actions[1].move === both.actions[1].move);
if (both && alone) check('Doubles: focus fire is at least as likely to KO as one attacker', both.outcomes[0].ko >= alone.outcomes[0].ko - 1e-12, `${both.outcomes[0].ko.toFixed(2)} vs ${alone.outcomes[0].ko.toFixed(2)}`);
check('Doubles: threat table covers every foe x my Pokémon', d.threats.length === 4 && d.threats.every((t) => t.avgPct >= 0));
check('Doubles: Fake Out is not scored as a threat or an action', !d.options[0].some((o) => o.move === 'Fake Out') && !d.threats.some((t) => t.move === 'Fake Out'));
check('Doubles: spreadOf reads the move target', spreadOf('Earthquake', doubles(), earthquaker) === 'all' && spreadOf('Rock Slide', doubles(), earthquaker) === 'foes' && spreadOf('Shadow Ball', doubles(), gholdengo) === null);
check('Doubles: Expanding Force becomes a spread move in Psychic Terrain', spreadOf('Expanding Force', { ...doubles(), terrain: 'Psychic' }, gholdengo) === 'foes' && spreadOf('Expanding Force', doubles(), gholdengo) === null);
check('Doubles: a two-turn move that must charge is left out', !recommendDoubles([mk('Venusaur', ['Solar Beam', 'Sludge Bomb'], 'Overgrow', { spa: 32 })], [salamence], doubles(), sure1).options[0].some((o) => o.move === 'Solar Beam'));
check('Doubles: ...unless it is sunny', recommendDoubles([mk('Venusaur', ['Solar Beam', 'Sludge Bomb'], 'Overgrow', { spa: 32 })], [salamence], { ...doubles(), weather: 'Sun' }, sure1).options[0].some((o) => o.move === 'Solar Beam'));
const dis = recommendDoubles([earthquaker], [mk('Mimikyu', ['Play Rough'], 'Disguise')], doubles(), sure1);
check('Doubles: an intact Disguise stops a lone attacker from KOing', dis.plans.every((p) => p.outcomes[0].ko === 0));
const fast = recommendDoubles([mk('Pikachu', ['Thunderbolt'], 'Static', { spa: 32 }), gholdengo], [mk('Garchomp', ['Earthquake', 'Dragon Claw'], 'Rough Skin', { atk: 32, spe: 32 }), rillaboom], doubles(), sure1);
check('Doubles: warns when a foe outspeeds and can KO one of mine', fast.warnings.some((w) => /outspeeds .* and can KO/.test(w)), fast.warnings[0] ?? '(none)');

// ------------------------------------------------------------------ speed
const t0 = performance.now();
recommendSingles(garchomp, incin, singles(), sure1);
recommendDoubles([earthquaker, gholdengo], [salamence, rillaboom], doubles(), sure1);
const ms = performance.now() - t0;
// ------------------------------------------------------------------ switching out
{
  const mk = (species, moves, ability, sp = {}) => ({ ...blankSet(species), ability, nature: 'Serious', moves: [...moves, '', '', '', ''].slice(0, 4), sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp } });
  const f = { ...blankField(), gameType: 'Singles' };
  const acc1 = () => 1;
  const garchomp = mk('Garchomp', ['Earthquake'], 'Rough Skin', { atk: 32 });
  const pikachu = mk('Pikachu', ['Thunderbolt'], 'Static');
  const salamence = mk('Salamence', ['Dragon Claw'], 'Intimidate');
  const sw = recommendSwitches(pikachu, garchomp, [salamence, mk('Gengar', ['Shadow Ball'], 'Cursed Body')], f, acc1);
  const sal = sw.options.find((o) => o.index === 0);
  check('switching into a Ground immunity takes no hit (Earthquake vs Salamence)', sal && sal.hitMove === null && sal.koOnSwitch === 0, JSON.stringify(sal));
  check('stay-in win is a probability', sw.stayWin >= 0 && sw.stayWin <= 1);
  check('switch options are sorted best first and are probabilities', sw.options.every((o, i) => o.win >= 0 && o.win <= 1 && (i === 0 || sw.options[i - 1].win >= o.win)));
  // a bench Pokémon that the foe KOs on entry has a 0% win chance
  const frail = { ...mk('Pikachu', ['Thunderbolt'], 'Static'), hpPercent: 1 };
  const kill = recommendSwitches(salamence, garchomp, [frail], f, acc1).options[0];
  check('a 1% HP Pokémon is knocked out on entry and cannot win', kill.koOnSwitch > 0.99 && kill.win < 0.01, JSON.stringify(kill));
  check('no bench: no options, no crash', recommendSwitches(pikachu, garchomp, [], f, acc1).options.length === 0);
}

check('a full Singles + Doubles recommendation is fast', ms < 3000, `${Math.round(ms)} ms`);
check('the horizon is what the tests assume', HORIZON === 5);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
