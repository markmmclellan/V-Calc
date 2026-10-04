// Dev helper: checks the "what to bring" engine (src/lib/bring.ts).
import fs from 'node:fs';
import { analyze, groupValue, pairScore, pairSynergy, verdictOf, BRING_COUNT } from '../src/lib/bring.ts';
import { blankSet } from '../src/lib/model.ts';
import { abilitiesOf } from '../src/lib/abilities.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const mk = (species, moves, { ability, item = '', sp = {}, nature = 'Serious' } = {}) => ({
  ...blankSet(species), item, nature, ability: ability ?? '', moves: [...moves, '', '', '', ''].slice(0, 4),
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp },
});

// ------------------------------------------------------------------ pairScore (the turn race)
const strike = (turns, pct = 100 / turns) => ({ move: 'x', pct, turns, priority: 0 });
check('1HKO vs 3HKO, both move first-equal => you win clearly', pairScore(strike(1), strike(3), 'tie') > 0.5);
check('same turns: whoever moves first wins', pairScore(strike(2), strike(2), 'me') > 0 && pairScore(strike(2), strike(2), 'them') < 0);
check('same turns and speed tie => 0', pairScore(strike(2), strike(2), 'tie') === 0);
check('no way to hurt them, they can hurt you => -1', pairScore(strike(Infinity, 0), strike(3), 'me') === -1);
check('you can hurt them, they cannot => +1', pairScore(strike(3), strike(Infinity, 0), 'them') === 1);
check('neither can hurt the other => 0', pairScore(strike(Infinity, 0), strike(Infinity, 0), 'me') === 0);
check('score is always within -1..1', [1, 2, 5, 9].every((a) => [1, 2, 5, 9].every((b) => Math.abs(pairScore(strike(a), strike(b), 'me')) <= 1)));
check('exactly antisymmetric (swap roles => negate)', [[1, 3, 'me'], [2, 2, 'tie'], [4, 1, 'them'], [2, Infinity, 'me']].every(([a, b, f]) => pairScore(strike(a), strike(b), f) === -pairScore(strike(b), strike(a), f === 'me' ? 'them' : f === 'them' ? 'me' : 'tie')));
check('verdict bands', verdictOf(1) === 'strong' && verdictOf(0.3) === 'favored' && verdictOf(0) === 'even' && verdictOf(-0.5) === 'unfavored' && verdictOf(-1) === 'loses');

// ------------------------------------------------------------------ real matchups through the damage calc
const data = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
void data;
const garchomp = mk('Garchomp-Mega-Z', ['Draco Meteor', 'Earthquake'], { sp: { spa: 32, hp: 2, spe: 32 }, nature: 'Modest' });
const incin = mk('Incineroar', ['Flare Blitz', 'Fake Out', 'Knock Off'], { ability: 'Intimidate', sp: { hp: 32, atk: 32 } });
const gyara = mk('Gyarados', ['Waterfall', 'Protect'], { ability: 'Intimidate', sp: { atk: 32, hp: 2 } });
const statusOnly = mk('Blissey', ['Protect', 'Toxic'], { sp: { hp: 32 } });
const groundOnly = mk('Garchomp', ['Earthquake'], { sp: { atk: 32 } });
const flyer = mk('Charizard', ['Air Slash'], { sp: { spa: 32 } });

const frail = mk('Pikachu', ['Protect', 'Thunder Wave']);
let a = analyze([frail], [garchomp], 'single');
check('a frail Pokémon with only status moves loses to a strong attacker', a.cells[0][0].score === -1 && a.cells[0][0].mine.move === '', `score ${a.cells[0][0].score}`);
a = analyze([statusOnly], [incin], 'single');
check('two Pokémon that cannot KO each other within 10 hits is a stalemate (0), not a loss', a.cells[0][0].score === 0, `Blissey vs Incineroar: ${a.cells[0][0].score}, their best ${a.cells[0][0].theirs.move} ${Math.round(a.cells[0][0].theirs.pct)}%`);
a = analyze([groundOnly], [flyer], 'single');
check('Ground-only attacker cannot hurt a Flying type (immune is not a move)', a.cells[0][0].mine.move === '' && a.cells[0][0].score < 0, `${a.cells[0][0].mine.move || '(no move)'} score ${a.cells[0][0].score.toFixed(2)}`);

// antisymmetry through the calc: swap the two teams
const A = [garchomp, incin, gyara, flyer];
const B = [incin, gyara, groundOnly, garchomp];
for (const f of ['single', 'double']) {
  const ab = analyze(A, B, f), ba = analyze(B, A, f);
  let worst = 0;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) worst = Math.max(worst, Math.abs(ab.cells[i][j].score + ba.cells[j][i].score));
  check(`${f}: swapping the teams exactly negates every matchup`, worst < 1e-9, `largest error ${worst}`);
}

// ------------------------------------------------------------------ selection
const mineTeam = [garchomp, incin, gyara, flyer, groundOnly, statusOnly];
const theirTeam = [incin, gyara, garchomp, flyer, groundOnly, statusOnly];
for (const f of ['single', 'double']) {
  const an = analyze(mineTeam, theirTeam, f);
  const n = BRING_COUNT[f];
  check(`${f}: brings exactly ${n}`, an.bring.length === n && new Set(an.bring).size === n);
  check(`${f}: leads are among the picks (${f === 'single' ? 1 : 2})`, an.leads.length === (f === 'single' ? 1 : 2) && an.leads.every((l) => an.bring.includes(l)));
  check(`${f}: picks start with the leads`, an.leads.every((l, k) => an.bring[k] === l));
  // brute force: no other group of the same size scores higher
  const all = [];
  const rec = (s, cur) => { if (cur.length === n) return void all.push([...cur]); for (let i = s; i < mineTeam.length; i++) rec(i + 1, [...cur, i]); };
  rec(0, []);
  const best = Math.max(...all.map((g) => groupValue(an.cells, g, an.weights, f)));
  const chosen = groupValue(an.cells, [...an.bring], an.weights, f);
  check(`${f}: chosen group is the best of all ${all.length} possible`, Math.abs(best - chosen) < 1e-9, `chosen ${chosen.toFixed(3)} best ${best.toFixed(3)}`);
  check(`${f}: every reason refers to a pick and a real opponent`, an.reasons.length === n && an.reasons.every((r, k) => r.index === an.bring[k] && r.beats.every((b) => b.j >= 0 && b.j < theirTeam.length)));
  check(`${f}: threats point at real opponents and are not "favored"`, an.threats.every((t) => t.j < theirTeam.length && an.bring.includes(t.answer) && an.cells[t.answer][t.j].score < 0.25));
}

// smaller teams
const small = analyze([garchomp, incin], theirTeam, 'single');
check('team smaller than the pick count: brings them all', small.bring.length === 2);
const none = analyze([], theirTeam, 'double');
check('empty team does not crash', none.bring.length === 0 && none.threats.length === 0);
const noOpp = analyze(mineTeam, [], 'single');
check('no opponents does not crash', noOpp.bring.length === 3 && noOpp.cells.every((r) => r.length === 0));

// a dominant opponent must be called out when nothing you bring can handle it
const monster = mk('Garchomp-Mega-Z', ['Draco Meteor', 'Earthquake'], { sp: { spa: 32, spe: 32, hp: 2 }, nature: 'Modest' });
const weak = [mk('Pikachu', ['Protect']), mk('Mr. Mime', ['Protect']), mk('Charizard', ['Protect'])];
const t = analyze(weak, [monster], 'single');
check('unbeatable opponent shows up as a threat', t.threats.length === 1 && t.threats[0].j === 0 && (t.threats[0].verdict === 'loses'), JSON.stringify(t.threats[0]));
const weights = t.weights[0];
check('an opponent that beats your whole team weighs the most', weights === 2, String(weights));

// ------------------------------------------------------------------ Doubles lead synergy
const syn = pairSynergy(incin, garchomp);
check('Fake Out + Intimidate give a synergy bonus', syn.bonus > 0.3 && syn.notes.some((n) => n.includes('Fake Out')) && syn.notes.some((n) => n.includes('Intimidate')), syn.notes.join(' | '));
check('synergy is capped', pairSynergy(mk('Incineroar', ['Fake Out', 'Tailwind', 'Follow Me', 'Helping Hand'], { ability: 'Intimidate' }), mk('Indeedee', ['Trick Room', 'Fake Out'])).bonus <= 0.6);
check('no synergy for two plain attackers', pairSynergy(garchomp, flyer).bonus === 0);

// ------------------------------------------------------------------ only one Mega Evolution per battle
import { megaVariants } from '../src/lib/showdown.ts';

const stoneHolder = (species, item, moves, sp) => mk(species, moves, { item, sp });
const mg = (species) => species; void mg;
const v1 = megaVariants(mk('Garchomp-Mega-Z', ['Earthquake'], { item: 'Garchompite Z' }));
check('a Mega holding its stone has both forms', v1 && v1.mega.species === 'Garchomp-Mega-Z' && v1.base.species === 'Garchomp', v1 && `${v1.mega.species} / ${v1.base.species}`);
const v2 = megaVariants(mk('Garchomp', ['Earthquake'], { item: 'Garchompite Z' }));
check('a base form holding the stone also has both', v2 && v2.mega.species === 'Garchomp-Mega-Z' && v2.base.species === 'Garchomp');
check('no stone, no Mega variants', megaVariants(mk('Garchomp-Mega-Z', ['Earthquake'])) === null && megaVariants(mk('Garchomp', ['Earthquake'], { item: 'Leftovers' })) === null);
const vx = megaVariants(mk('Charizard-Mega-Y', ['Flamethrower'], { item: 'Charizardite Y', ability: 'Drought' }));
check('the stone decides which Mega (Charizardite Y -> Mega Y)', vx && vx.mega.species === 'Charizard-Mega-Y', vx && vx.mega.species);
check('the base form of a Mega gets a legal ability (Drought is not one)', vx && ['Blaze', 'Solar Power'].includes(vx.base.ability) && vx.mega.ability === 'Drought', vx && `${vx.base.ability} / ${vx.mega.ability}`);

// a team where most Pokémon hold a stone: the picks may include several holders but only one can be the Mega
const holders = [
  stoneHolder('Garchomp', 'Garchompite Z', ['Dragon Claw', 'Earthquake'], { atk: 32, spe: 32, hp: 2 }),
  stoneHolder('Salamence', 'Salamencite', ['Draco Meteor', 'Hyper Voice'], { spa: 32, spe: 32, hp: 2 }),
  stoneHolder('Charizard', 'Charizardite Y', ['Flamethrower', 'Air Slash'], { spa: 32, spe: 32, hp: 2 }),
  stoneHolder('Gyarados', 'Gyaradosite', ['Waterfall', 'Crunch'], { atk: 32, hp: 32, spe: 2 }),
  mk('Incineroar', ['Flare Blitz', 'Fake Out'], { ability: 'Intimidate', sp: { hp: 32, atk: 32 } }),
  mk('Gholdengo', ['Make It Rain', 'Shadow Ball'], { sp: { spa: 32, hp: 32, spe: 2 } }),
];
const opp = [incin, gyara, garchomp, flyer, groundOnly, mk('Salamence-Mega', ['Draco Meteor', 'Hyper Voice'], { sp: { spa: 32, spe: 32 } })];
for (const f of ['single', 'double']) {
  const an = analyze(holders, opp, f);
  const evolving = an.reasons.filter((r) => r.form === 'mega');
  const baseHolders = an.reasons.filter((r) => r.form === 'base');
  check(`${f}: at most one pick is a Mega`, evolving.length <= 1, `${evolving.length} Mega, ${baseHolders.length} stone holder(s) playing as base`);
  check(`${f}: mega index matches the pick that evolves`, evolving.length === 0 ? an.mega === null : an.mega === evolving[0].index);
  check(`${f}: every other picked stone holder is judged as its BASE form`, baseHolders.every((r) => !/Mega/.test(an.sets[r.index].species)), baseHolders.map((r) => an.sets[r.index].species).join(', '));
  check(`${f}: the Mega is judged as a Mega`, evolving.every((r) => /Mega/.test(an.sets[r.index].species)), evolving.map((r) => an.sets[r.index].species).join(', '));
  check(`${f}: conflict flag is true exactly when 2+ stone holders are picked`, an.conflict === (an.reasons.filter((r) => r.form).length > 1));
  // brute force over every group, with the Mega assignment each group can make
  const all = [];
  const rec = (s, cur) => { if (cur.length === BRING_COUNT[f]) return void all.push([...cur]); for (let i = s; i < holders.length; i++) rec(i + 1, [...cur, i]); };
  rec(0, []);
  const best = Math.max(...all.map((g) => an.evaluate(g).value));
  check(`${f}: chosen group is the best of all ${all.length}, counting the one-Mega rule`, Math.abs(best - an.evaluate([...an.bring]).value) < 1e-9, `best ${best.toFixed(3)}`);
  check(`${f}: evaluate() agrees with the analysis on who evolves`, an.evaluate([...an.bring]).mega === an.mega);
  // the old behavior (every holder treated as Mega at once) can only score a group at least as high, so the rule never helps
  const inflated = Math.max(...all.map((g) => groupValue(analyze(holders.map((h) => (megaVariants(h) ? megaVariants(h).mega : h)), opp, f).cells, g, an.weights, f)));
  check(`${f}: the one-Mega rule never makes a group look better than "everyone is Mega"`, an.value <= inflated + 1e-9, `rule ${an.value.toFixed(3)} <= all-Mega ${inflated.toFixed(3)}`);
}

// a group forced to contain two holders (team of only two Pokémon): one evolves, the other plays as base
const two = analyze([holders[0], holders[1]], opp, 'single');
check('two stone holders, nothing else to pick: exactly one is the Mega', two.reasons.filter((r) => r.form === 'mega').length === 1 && two.reasons.filter((r) => r.form === 'base').length === 1 && two.conflict, two.reasons.map((r) => `${two.sets[r.index].species}:${r.form}`).join(', '));
const solo = analyze([holders[0]], opp, 'single');
check('a lone stone holder can be the Mega', solo.reasons[0].form === 'mega' && /Mega/.test(solo.sets[0].species) && !solo.conflict, `${solo.sets[0].species}`);
check('without stones nothing changes: no Mega, no conflict, no forms', analyze(mineTeam, theirTeam, 'single').mega === null && analyze(mineTeam, theirTeam, 'single').reasons.every((r) => r.form === null));

// ------------------------------------------------------------------ speed
const t0 = performance.now();
analyze(mineTeam, theirTeam, 'single');
analyze(mineTeam, theirTeam, 'double');
const ms = performance.now() - t0;
check('a full 6v6 analysis in both formats is fast', ms < 3000, `${Math.round(ms)} ms`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
