// Dev helper: the stat-move button (src/lib/statMoves.ts): table vs Smogon's text, and the apply logic.
import fs from 'node:fs';
import { applyStatEffect, describeEffect, STAT_MOVE_NAMES, statEffect } from '../src/lib/statMoves.ts';
import { blankSet, zeroBoosts } from '../src/lib/model.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const ref = JSON.parse(fs.readFileSync('public/data/smogon.json', 'utf8'));
const byName = new Map(ref.moves.map((m) => [m.name, m]));
const plain = { types: ['Normal'], weather: '' };

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
check('damaging and unknown moves have no stat button', statEffect('Earthquake', plain) === null && statEffect('Protect', plain) === null && statEffect('', plain) === null && statEffect('Draco Meteor', plain) === null);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
