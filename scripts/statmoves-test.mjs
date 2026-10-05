// Dev helper: the stat-move button (src/lib/statMoves.ts): table vs Smogon's text, and the apply logic.
import fs from 'node:fs';
import { applyStatEffect, DAMAGING_STAT_MOVE_NAMES, describeEffect, selfBoostsAfterHit, STAT_MOVE_NAMES as ALL_NAMES, statEffect } from '../src/lib/statMoves.ts';
import { blankSet, moveInfo, zeroBoosts } from '../src/lib/model.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const ref = JSON.parse(fs.readFileSync('public/data/smogon.json', 'utf8'));
const byName = new Map(ref.moves.map((m) => [m.name, m]));
const plain = { types: ['Normal'], weather: '' };
// the status moves and the damaging moves are checked separately (Smogon words them differently)
const STAT_MOVE_NAMES = ALL_NAMES.filter((n) => !DAMAGING_STAT_MOVE_NAMES.includes(n));

// ------------------------------------------------------------------ the table vs Smogon's descriptions
const STATS = { Attack: 'atk', Defense: 'def', 'Special Attack': 'spa', 'Special Defense': 'spd', Speed: 'spe' };
const statsIn = (text) => [...text.matchAll(/Special Attack|Special Defense|Attack|Defense|Speed/g)].map((m) => STATS[m[0]]);

const missing = STAT_MOVE_NAMES.filter((n) => !byName.has(n));
check('every move in the table exists in Champions', missing.length === 0, missing.join(', '));

const bad = [];
for (const name of STAT_MOVE_NAMES) {
  const m = byName.get(name);
  const e = statEffect(name, { types: ['Normal'], weather: '' });
  if (!m || !e) continue;
  const text = m.description;
  const check1 = (side, boosts, whoWord) => {
    for (const [k, v] of Object.entries(boosts)) {
      const stat = Object.entries(STATS).find(([, key]) => key === k)[0];
      if (!text.includes(stat)) bad.push(`${name}: ${side} ${k} not mentioned`);
      const n = Math.min(Math.abs(v), name === 'Belly Drum' ? 12 : 6);
      if (!new RegExp(`\\b${n} stages?\\b`).test(text) && !(name === 'Clangorous Soul' || name === 'No Retreat' || name === 'Howl')) bad.push(`${name}: ${k} ${v} but the text has no "${n} stage(s)"`);
      if (v > 0 && !/Raises|raises/.test(text)) bad.push(`${name}: raises but text never says so`);
      if (v < 0 && !/Lowers|lowers/.test(text)) bad.push(`${name}: lowers but text never says so`);
      if (whoWord && !text.includes(whoWord)) bad.push(`${name}: expected "${whoWord}" in the text`);
    }
  };
  if (e.self) check1('self', e.self, 'user');
  if (e.foe) check1('foe', e.foe, name === 'Flatter' || name === 'Swagger' || name === 'Spicy Extract' ? "target's" : "target's");
  if (e.ally) check1('ally', e.ally, name === 'Howl' ? 'allies' : "target's");
}
check('every number and direction in the table agrees with Smogon\'s text', bad.length === 0, bad.slice(0, 5).join(' | '));

// exact check on the simple one-sentence moves: parse "Raises/Lowers the user's/target's A, B and C by N stage(s)."
const exact = [];
let parsed = 0;
for (const name of STAT_MOVE_NAMES) {
  const m = byName.get(name);
  const e = statEffect(name, { types: ['Normal'], weather: '' });
  const g = m && m.description.match(/^(Raises|Lowers) the (user|target)'s ((?:Special Attack|Special Defense|Attack|Defense|Speed)(?:(?:, | and |, and )(?:Special Attack|Special Defense|Attack|Defense|Speed))*) by (\d+) stages?\.?$/);
  if (!g || !e) continue;
  parsed++;
  const sign = g[1] === 'Raises' ? 1 : -1;
  const want = Object.fromEntries(statsIn(g[3]).map((k) => [k, sign * +g[4]]));
  const got = g[2] === 'user' ? e.self : e.foe ?? e.ally;
  const norm = (o) => JSON.stringify(Object.entries(o ?? {}).sort());
  if (norm(want) !== norm(got)) exact.push(`${name}: Smogon says ${norm(want)}, table has ${norm(got)}`);
}
check(`exact match on the ${parsed} moves with a simple one-sentence effect`, exact.length === 0 && parsed >= 25, exact.slice(0, 4).join(' | '));

// completeness: any status move that begins "Raises/Lowers the user's/target's <stat>" must be in the table (or knowingly skipped)
const SKIP = { Memento: 'the user faints', Acupressure: 'random stat' };
const forgotten = ref.moves
  .filter((m) => m.category === 'Status' && /^(Raises|Lowers) the (user|target)'s (Special Attack|Special Defense|Attack|Defense|Speed)/.test(m.description))
  .map((m) => m.name)
  .filter((n) => !STAT_MOVE_NAMES.includes(n) && !SKIP[n]);
check('no stat-changing status move was left out of the table', forgotten.length === 0, forgotten.join(', '));

// ------------------------------------------------------------------ damaging moves with stat effects
const dmgBad = [];
for (const name of DAMAGING_STAT_MOVE_NAMES) {
  const m = byName.get(name);
  const e = statEffect(name, plain);
  if (!m) { dmgBad.push(`${name}: not in Champions`); continue; }
  if (m.category === 'Status') dmgBad.push(`${name}: is a status move`);
  const t = m.description;
  for (const [side, boosts] of [['self', e.self], ['foe', e.foe]]) {
    for (const [k, v] of Object.entries(boosts ?? {})) {
      const stat = Object.entries(STATS).find(([, key]) => key === k)[0];
      if (!t.includes(stat)) dmgBad.push(`${name}: ${stat} not in text`);
      if (name !== 'Ancient Power' && !new RegExp(`\\b${Math.abs(v)} stages?\\b`).test(t)) dmgBad.push(`${name}: no "${Math.abs(v)} stage(s)"`);
      if (!new RegExp(`${v > 0 ? 'raise|Raises' : 'lower|Lowers'}`).test(t)) dmgBad.push(`${name}: direction`);
      if (!t.includes(side === 'self' ? "user's" : "target's")) dmgBad.push(`${name}: wrong side`);
    }
  }
  const ch = t.match(/(\d+)% chance to (?:raise|lower)/);
  const pct = ch ? +ch[1] : 100;
  if ((e.chance ?? 100) !== pct && !e.note) dmgBad.push(`${name}: chance ${e.chance ?? 100} vs Smogon ${pct}`);
}
check(`all ${DAMAGING_STAT_MOVE_NAMES.length} damaging moves match Smogon's stat, size, side and chance`, dmgBad.length === 0, dmgBad.slice(0, 5).join(' | '));

// completeness: every damaging move whose text says it raises/lowers the user's or target's stats must be in the table
const KNOWN_SKIP = new Set(['Body Press', 'Foul Play', 'Rapid Spin', 'Spit Up', 'Syrup Bomb', 'Stored Power', 'Power Trip', 'Belch', 'Psych Up', 'Fling', 'Pluck', 'Bug Bite']);
const dmgForgotten = ref.moves
  .filter((m) => m.category !== 'Status' && /(\d+)% chance to (raise|lower) the (user|target)'s (Special Attack|Special Defense|Attack|Defense|Speed|Accuracy|Evasion)|^(Raises|Lowers) the (user|target)'s/.test(m.description))
  .map((m) => m.name)
  .filter((n) => !DAMAGING_STAT_MOVE_NAMES.includes(n) && !KNOWN_SKIP.has(n));
check('no damaging stat-changing move was left out', dmgForgotten.length === 0, dmgForgotten.join(', '));

check('Draco Meteor label', /−2 SpA/.test(describeEffect(statEffect('Draco Meteor', plain))), describeEffect(statEffect('Draco Meteor', plain)));
check('Close Combat label', /−1 Def\/SpD/.test(describeEffect(statEffect('Close Combat', plain))), describeEffect(statEffect('Close Combat', plain)));
check('chance-based label shows the odds', /20%/.test(describeEffect(statEffect('Shadow Ball', plain))), describeEffect(statEffect('Shadow Ball', plain)));
check('Fell Stinger label says when', /KO/.test(describeEffect(statEffect('Fell Stinger', plain))));
check('Draco Meteor lowers the user, twice stacks to -4', (() => {
  const me = blankSet('Salamence'); const foe = blankSet('Garchomp');
  const r1 = applyStatEffect({ me, foe, effect: statEffect('Draco Meteor', plain) });
  const r2 = applyStatEffect({ me: r1.me, foe: r1.foe, effect: statEffect('Draco Meteor', plain) });
  return r1.ok && r2.me.boosts.spa === -4 && r2.foe.boosts.spa === 0;
})());
check('Icy Wind lowers the foe, not the user', (() => {
  const r = applyStatEffect({ me: blankSet('Salamence'), foe: blankSet('Garchomp'), effect: statEffect('Icy Wind', plain) });
  return r.ok && r.foe.boosts.spe === -1 && r.me.boosts.spe === 0;
})());
check('engine only counts the reliable, damage-relevant self changes', JSON.stringify(selfBoostsAfterHit('Draco Meteor')) === '{"spa":-2}' && JSON.stringify(selfBoostsAfterHit('Close Combat')) === '{"def":-1,"spd":-1}' && selfBoostsAfterHit('Flame Charge') === undefined && selfBoostsAfterHit('Charge Beam') === undefined && selfBoostsAfterHit('Fell Stinger') === undefined && selfBoostsAfterHit('Icy Wind') === undefined);

// ------------------------------------------------------------------ the editor must actually show the button
// The damage library's raw Champions data has no `category` for 75 status moves (Nasty Plot, Shell Smash...), so the
// editor has to read the move through moveInfo(). This is the editor's exact condition for showing a button.
const noButton = STAT_MOVE_NAMES.filter((n) => !(moveInfo(n)?.category === 'Status' && statEffect(n, { types: ['Normal'], weather: '' })));
check('every move in the table gets a button (is a known status move)', noButton.length === 0, noButton.join(', '));
check('Nasty Plot, Shell Smash, Coil, Quiver Dance and Rock Polish specifically', ['Nasty Plot', 'Shell Smash', 'Coil', 'Quiver Dance', 'Rock Polish'].every((n) => moveInfo(n)?.category === 'Status'));
const wrongCat = ref.moves.filter((m) => moveInfo(m.name) && moveInfo(m.name).category !== m.category).map((m) => `${m.name}: smogon ${m.category}, ours ${moveInfo(m.name).category}`);
check(`the category matches Smogon for all ${ref.moves.length} moves`, wrongCat.length === 0, wrongCat.slice(0, 4).join(' | '));
check('moveInfo ignores unknown or empty names', moveInfo('') === undefined && moveInfo('Not A Move') === undefined && moveInfo('nasty plot')?.name === 'Nasty Plot');
check('damaging moves keep their base power', moveInfo('Earthquake').bp === 100 && moveInfo('Nasty Plot').bp === 0);

// ------------------------------------------------------------------ the special cases
const set = (o = {}) => ({ ...blankSet('Garchomp'), boosts: zeroBoosts(), hpPercent: 100, ...o });
const b = (o) => ({ ...zeroBoosts(), ...o });
const dd = statEffect('Dragon Dance', plain);
let r = applyStatEffect({ me: set(), effect: dd });
check('Dragon Dance: +1 Atk and +1 Spe', r.ok && r.me.boosts.atk === 1 && r.me.boosts.spe === 1 && r.me.boosts.def === 0, JSON.stringify(r.me.boosts));
const r2 = applyStatEffect({ me: r.me, effect: dd });
check('...and stacks: +2 / +2', r2.me.boosts.atk === 2 && r2.me.boosts.spe === 2);
const orig = set();
applyStatEffect({ me: orig, effect: dd });
check('the original Pokémon is never mutated', orig.boosts.atk === 0 && orig.hpPercent === 100);
r = applyStatEffect({ me: set({ boosts: b({ atk: 5 }) }), effect: statEffect('Swords Dance', plain) });
check('Swords Dance at +5 stops at +6', r.ok && r.me.boosts.atk === 6);
r = applyStatEffect({ me: set({ boosts: b({ atk: 6 }) }), effect: statEffect('Swords Dance', plain) });
check('Swords Dance at +6 does nothing and says why', !r.ok && /limit/.test(r.reason) && r.me.boosts.atk === 6, r.reason);
r = applyStatEffect({ me: set(), effect: statEffect('Shell Smash', plain) });
check('Shell Smash: +2 Atk/SpA/Spe and -1 Def/SpD', r.me.boosts.atk === 2 && r.me.boosts.spa === 2 && r.me.boosts.spe === 2 && r.me.boosts.def === -1 && r.me.boosts.spd === -1);
r = applyStatEffect({ me: set({ boosts: b({ def: -6 }) }), effect: statEffect('Shell Smash', plain) });
check('Shell Smash still works when Defense is already at -6 (the rest changes)', r.ok && r.me.boosts.def === -6 && r.me.boosts.atk === 2);

// HP costs
r = applyStatEffect({ me: set(), effect: statEffect('Belly Drum', plain) });
check('Belly Drum: Attack to +6 and half the HP', r.ok && r.me.boosts.atk === 6 && r.me.hpPercent === 50, `${r.me.boosts.atk} / ${r.me.hpPercent}%`);
r = applyStatEffect({ me: set({ hpPercent: 50 }), effect: statEffect('Belly Drum', plain) });
check('Belly Drum at 50% HP fails (it would faint)', !r.ok && /HP/.test(r.reason) && r.me.boosts.atk === 0, r.reason);
r = applyStatEffect({ me: set({ boosts: b({ atk: 6 }) }), effect: statEffect('Belly Drum', plain) });
check('Belly Drum with Attack already +6 fails and costs no HP', !r.ok && r.me.hpPercent === 100);
r = applyStatEffect({ me: set(), effect: statEffect('Clangorous Soul', plain) });
check('Clangorous Soul: everything +1, a third of the HP', r.ok && ['atk', 'def', 'spa', 'spd', 'spe'].every((k) => r.me.boosts[k] === 1) && Math.abs(r.me.hpPercent - 66.67) < 0.01, `${r.me.hpPercent}%`);
r = applyStatEffect({ me: set({ hpPercent: 30 }), effect: statEffect('Clangorous Soul', plain) });
check('Clangorous Soul at 30% HP fails', !r.ok);

// the opponent
const foe = set({ species: 'Salamence', boosts: b({ atk: 1 }) });
r = applyStatEffect({ me: set(), foe, effect: statEffect('Charm', plain) });
check('Charm drops the opponent\'s Attack by 2 (from +1 to -1) and leaves mine alone', r.ok && r.foe.boosts.atk === -1 && r.me.boosts.atk === 0);
r = applyStatEffect({ me: set(), effect: statEffect('Charm', plain) });
check('Charm with no opponent selected fails clearly', !r.ok && /opposing/.test(r.reason));
r = applyStatEffect({ me: set(), foe: set({ boosts: b({ atk: -6 }) }), effect: statEffect('Charm', plain) });
check('Charm at -6 does nothing', !r.ok && /limit/.test(r.reason));
r = applyStatEffect({ me: set(), foe, effect: statEffect('Spicy Extract', plain) });
check('Spicy Extract raises their Attack and drops their Defense', r.foe.boosts.atk === 3 && r.foe.boosts.def === -2);

// the partner
const partner = set({ species: 'Salamence' });
r = applyStatEffect({ me: set(), ally: partner, effect: statEffect('Coaching', plain) });
check('Coaching boosts the partner, not me', r.ok && r.ally.boosts.atk === 1 && r.ally.boosts.def === 1 && r.me.boosts.atk === 0);
r = applyStatEffect({ me: set(), effect: statEffect('Coaching', plain) });
check('Coaching with no partner fails and says to use Doubles', !r.ok && /partner/.test(r.reason));
r = applyStatEffect({ me: set(), effect: statEffect('Howl', plain) });
check('Howl without a partner still boosts me', r.ok && r.me.boosts.atk === 1);
r = applyStatEffect({ me: set(), ally: partner, effect: statEffect('Howl', plain) });
check('Howl with a partner boosts both', r.me.boosts.atk === 1 && r.ally.boosts.atk === 1);

// resets and copies
const messy = (o) => set({ boosts: b(o) });
r = applyStatEffect({ me: messy({ atk: 2 }), foe: messy({ spe: -1 }), ally: messy({ def: 3 }), foePartner: messy({ spa: 1 }), effect: statEffect('Haze', plain) });
check('Haze clears every Pokémon on the field', r.ok && [r.me, r.foe, r.ally, r.foePartner].every((p) => Object.values(p.boosts).every((v) => v === 0)));
r = applyStatEffect({ me: set(), foe: set(), effect: statEffect('Haze', plain) });
check('Haze with nothing to reset says so', !r.ok);
r = applyStatEffect({ me: messy({ atk: -1 }), foe: messy({ spa: 2, spe: 1 }), effect: statEffect('Psych Up', plain) });
check('Psych Up copies the opponent\'s stat changes', r.ok && r.me.boosts.spa === 2 && r.me.boosts.spe === 1 && r.me.boosts.atk === 0);
r = applyStatEffect({ me: set(), foe: messy({ atk: 2, spe: -1 }), effect: statEffect('Topsy-Turvy', plain) });
check('Topsy-Turvy flips the opponent\'s stat changes', r.ok && r.foe.boosts.atk === -2 && r.foe.boosts.spe === 1 && !Object.values(r.foe.boosts).some((v) => Object.is(v, -0)));
r = applyStatEffect({ me: set(), foe: set(), effect: statEffect('Topsy-Turvy', plain) });
check('Topsy-Turvy with nothing to flip fails', !r.ok);

// moves whose effect depends on the user or the weather
const ghost = statEffect('Curse', { types: ['Ghost', 'Fairy'] });
const other = statEffect('Curse', { types: ['Normal'] });
check('Curse: a Ghost pays HP and curses the foe', ghost.hpCost === 50 && ghost.foeCurse === true && !ghost.self);
check('Curse: anyone else gets +1 Atk/+1 Def/-1 Spe', other.self.atk === 1 && other.self.def === 1 && other.self.spe === -1);
r = applyStatEffect({ me: set(), foe: set(), effect: ghost });
check('Ghost Curse applies even though no stat changes', r.ok && r.foeCurse === true && r.me.hpPercent === 50);
check('Growth is +1/+1 normally and +2/+2 in the sun', statEffect('Growth', plain).self.atk === 1 && statEffect('Growth', { types: [], weather: 'Sun' }).self.atk === 2 && statEffect('Growth', { types: [], weather: 'Harsh Sunshine' }).self.spa === 2);

// labels and lookup
const label = (n) => describeEffect(statEffect(n, plain));
check('label: Dragon Dance', label('Dragon Dance') === '+1 Atk/Spe', label('Dragon Dance'));
check('label: Swords Dance', label('Swords Dance') === '+2 Atk', label('Swords Dance'));
check('label: Shell Smash', label('Shell Smash') === '+2 Atk/SpA/Spe · −1 Def/SpD', label('Shell Smash'));
check('label: Clangorous Soul', label('Clangorous Soul') === 'all +1, −33% HP', label('Clangorous Soul'));
check('label: Belly Drum shows +6, not +12', label('Belly Drum') === '+6 Atk, −50% HP', label('Belly Drum'));
check('label: foe move', label('Charm') === 'foe −2 Atk', label('Charm'));
check('label: partner move', label('Coaching') === 'partner +1 Atk/Def', label('Coaching'));
check('label: Howl names both', label('Howl') === '+1 Atk, ally +1 Atk', label('Howl'));
check('label: Haze', label('Haze') === 'reset all stats');
check('plain damaging moves, Protect and unknown names have no stat button', statEffect('Earthquake', plain) === null && statEffect('Protect', plain) === null && statEffect('', plain) === null && statEffect('Not A Move', plain) === null);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
