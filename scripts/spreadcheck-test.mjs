// Dev helper: Spread check. Take a hidden "true" op.gg spread, compute a damage roll with it, then check that the
// spread check finds that spread (both when they hit you and when you hit them).
import fs from 'node:fs';
import { blankField, calcMove } from '../src/lib/calc.ts';
import { resolveSpecies } from '../src/lib/data.ts';
import { blankSet } from '../src/lib/model.ts';
import { checkSpread, spreadText } from '../src/lib/spreadcheck.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const raw = JSON.parse(fs.readFileSync('public/data/champions.json', 'utf8'));
const entryOf = (key) => {
  const p = raw.pokemon[key];
  return { key, species: resolveSpecies(key, raw.names[key]), displayName: raw.names[key], rank: p.rank, data: { single: p.single, double: p.double } };
};
const field = { ...blankField(), gameType: 'Singles' };
const mk = (species, moves, extra = {}) => ({ ...blankSet(species), moves: [...moves, '', '', '', ''].slice(0, 4), ...extra });

const chomp = entryOf('garchomp');
const d = chomp.data.single;
const physical = d.spreads.find((s) => s.sp.atk === 32);
const special = d.spreads.find((s) => s.sp.spa === 32);
const bulky = d.spreads.find((s) => s.sp.hp === 32 && s.sp.def === 32);
const me = mk('Kingambit', ['Sucker Punch', 'Iron Head'], { ability: 'Defiant', sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } });

// ---- they hit me: a physical Garchomp (Adamant, 32 Atk) uses Earthquake. The editor still has a 0 Atk guess.
const truth = mk('Garchomp', ['Earthquake'], { ability: 'Rough Skin', nature: 'Adamant', sp: { ...physical.sp } });
const hit = calcMove(truth, me, 'Earthquake', false, field, true);
const guess = { ...truth, nature: 'Timid', sp: { ...special.sp } };
const a = checkSpread({ mode: 'attack', theirs: guess, hits: [{ move: 'Earthquake', crit: false, observed: hit.rolls[8], mine: me }], field, entry: chomp, format: 'single', tryItems: false });
check('current guess does not fit', a.currentMatches === false, a.current.join());
check('finds matches', a.matches.length > 0, `${a.matches.length} of ${a.tested}`);
// one roll can fit more than one nature (rolls overlap), but the true set must be there and nothing without Atk
check('the true set is a match', a.matches.some((m) => m.sp.atk === 32 && m.nature === 'Adamant'));
check('every match has (nearly) full Atk', a.matches.every((m) => m.sp.atk >= 30), a.matches.map((m) => `${spreadText(m.sp)} ${m.nature}`).join(', '));
check('investment range says + nature at 32', a.invest.some((r) => r.label === '+ nature' && r.to === 32), JSON.stringify(a.invest));
check('a min roll at 32 Atk + nature does not fit 0 Atk', !a.invest.some((r) => r.from === 0 && r.label === 'neutral nature'));

// ---- I hit them: Kingambit's Iron Head on a bulky Garchomp (32 HP / 32 Def, Impish)
const tank = mk('Garchomp', ['Earthquake'], { ability: 'Rough Skin', nature: 'Impish', sp: { ...bulky.sp } });
const mine = calcMove(me, tank, 'Iron Head', false, field, false);
const pct = Math.round((mine.rolls[5] / mine.defenderHP) * 100);
const b = checkSpread({ mode: 'defense', theirs: guess, hits: [{ move: 'Iron Head', crit: false, observed: pct, mine: me }], field, entry: chomp, format: 'single', tryItems: false });
check('defense: finds matches', b.matches.length > 0, `${pct}% → ${b.matches.length} groups`);
check('defense: the bulky Impish spread is among them', b.matches.some((m) => m.sp.hp === 32 && m.sp.def === 32 && m.nature === 'Impish'), b.matches.slice(0, 4).map((m) => `${spreadText(m.sp)} ${m.nature} ${m.stats}`).join(' | '));
check('defense: a frail 0 HP / 0 Def spread is ruled out', !b.matches.some((m) => m.sp.hp <= 2 && m.sp.def <= 2 && !['Impish', 'Bold', 'Relaxed', 'Lax'].includes(m.nature)));

// ---- item check: Life Orb explains extra damage (Choice Band isn't in Champions)
const banded = { ...truth, item: 'Life Orb' };
const bandHit = calcMove(banded, me, 'Earthquake', false, field, true);
const c = checkSpread({ mode: 'attack', theirs: { ...guess, item: '' }, hits: [{ move: 'Earthquake', crit: false, observed: bandHit.rolls[15], mine: me }], field, entry: chomp, format: 'single', tryItems: true });
check('item search explains it with Life Orb only', c.matches.length > 0 && c.matches.every((m) => m.item === 'Life Orb'), c.matches.slice(0, 3).map((m) => `${m.item} ${m.nature}`).join(', '));

// ---- two hits narrow it down: a second, max roll rules out whatever only fit the first
const two = checkSpread({ mode: 'attack', theirs: guess, hits: [{ move: 'Earthquake', crit: false, observed: hit.rolls[8], mine: me }, { move: 'Earthquake', crit: false, observed: hit.rolls[15], mine: me }], field, entry: chomp, format: 'single', tryItems: false });
check('two hits: still finds the true set', two.matches.some((m) => m.sp.atk === 32 && m.nature === 'Adamant'), two.matches.map((m) => `${spreadText(m.sp)} ${m.nature}`).join(', '));
check('two hits: Jolly no longer fits', !two.matches.some((m) => m.nature === 'Jolly'));
check('two hits: a range per hit', two.matches[0]?.ranges.length === 2);

// ---- errors
check('status move is rejected', !!checkSpread({ mode: 'attack', theirs: guess, hits: [{ move: 'Swords Dance', crit: false, observed: 50, mine: me }], field, entry: chomp, format: 'single', tryItems: false }).error);
check('no number is rejected', !!checkSpread({ mode: 'attack', theirs: guess, hits: [{ move: 'Earthquake', crit: false, observed: 0, mine: me }], field, entry: chomp, format: 'single', tryItems: false }).error);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
