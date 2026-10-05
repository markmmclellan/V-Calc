// Dev helper: checks the Smogon reference data, the search, and that our hand-typed negative-priority table
// agrees with Smogon's Champions dex (that check caught Magic Room / Wonder Room being wrongly -7).
import fs from 'node:fs';
import { searchEntries } from '../src/lib/reference.ts';
import { aliasOf } from './smogon.mjs';
import { movePriority } from '../src/lib/speed.ts';
import { blankField } from '../src/lib/calc.ts';
import { blankSet } from '../src/lib/model.ts';

const ref = JSON.parse(fs.readFileSync('public/data/smogon.json', 'utf8'));
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

check('has moves, items, abilities', ref.moves.length > 400 && ref.items.length > 100 && ref.abilities.length > 150, `${ref.moves.length}/${ref.items.length}/${ref.abilities.length}`);
check('every entry has a description', [...ref.moves, ...ref.items, ...ref.abilities].every((e) => e.description), '');
check('no "No Item" entry', !ref.items.some((i) => i.name === 'No Item'));

// full descriptions (fetched per entry from Smogon, not the short list text)
const desc = (list, n) => list.find((e) => e.name === n)?.description ?? '';
check('Mold Breaker has the full list of negated abilities', desc(ref.abilities, 'Mold Breaker').includes('Armor Tail') && desc(ref.abilities, 'Mold Breaker').includes('Wonder Skin') && desc(ref.abilities, 'Mold Breaker').length > 1000, `${desc(ref.abilities, 'Mold Breaker').length} chars`);
check('Intimidate lists the immune abilities', desc(ref.abilities, 'Intimidate').includes('Inner Focus') && desc(ref.abilities, 'Intimidate').includes('substitute'));
check('Fake Out has the full wording', desc(ref.moves, 'Fake Out').includes("first turn on the field"));
check('most abilities have more than a one-line description', ref.abilities.filter((a) => a.description.length > 90).length > 100, `${ref.abilities.filter((a) => a.description.length > 90).length} of ${ref.abilities.length} over 90 chars`);
check('alias rule: apostrophes, periods, spaces', [["Mind's Eye", 'minds-eye'], ['Mr. Mime', 'mr-mime'], ['Will-O-Wisp', 'will-o-wisp'], ['Fake Out', 'fake-out'], ['Good as Gold', 'good-as-gold']].every(([n, a]) => aliasOf(n) === a));
check('searching the full text works ("Wonder Skin" finds Mold Breaker)', searchEntries(ref.abilities, 'wonder skin negated').some((e) => e.name === 'Mold Breaker'));

const names = (list, q) => searchEntries(list, q).map((e) => e.name);
check('"1.5x speed" finds Choice Scarf (matches the × sign)', names(ref.items, '1.5x speed').includes('Choice Scarf'));
check('"1.5×" works too', names(ref.items, '1.5×').includes('Choice Scarf'));
check('"lowers speed" finds Icy Wind', names(ref.moves, 'lowers speed').includes('Icy Wind'));
check('"lowers speed", "lowering speed", "lower speed" all find Icy Wind', ['lowers speed', 'lowering speed', 'lower speed'].every((q) => names(ref.moves, q).includes('Icy Wind')));
check('"raises attack" finds Swords Dance', names(ref.moves, 'raises attack').includes('Swords Dance'), names(ref.moves, 'raises attack').slice(0, 4).join(', '));
check('stemming does not break exact names', names(ref.moves, 'earthquake')[0] === 'Earthquake' && names(ref.moves, 'surf')[0] === 'Surf');
check('name matches rank first', names(ref.moves, 'quick')[0].toLowerCase().startsWith('quick'), names(ref.moves, 'quick').slice(0, 3).join(', '));
check('multi-word query needs every word', !names(ref.abilities, 'intimidate zzzz').length);
check('empty query returns everything', searchEntries(ref.moves, '  ').length === ref.moves.length);

// priority: every Smogon move's priority must equal what the turn-order code reports
const field = blankField();
const set = { ...blankSet('Garchomp'), ability: 'Rough Skin' };
const wrong = ref.moves.filter((m) => (movePriority(set, m.name, field)?.priority ?? 0) !== m.priority);
check('turn-order priority matches Smogon for every move', wrong.length === 0, wrong.map((m) => `${m.name} smogon ${m.priority} ours ${movePriority(set, m.name, field)?.priority}`).join('; '));
const prankster = { ...blankSet('Whimsicott'), ability: 'Prankster' };
const pr = ref.moves.filter((m) => m.category === 'Status').filter((m) => (movePriority(prankster, m.name, field)?.priority ?? 0) !== m.priority + 1);
check(`Prankster adds +1 to all ${ref.moves.filter((m) => m.category === 'Status').length} status moves (including Nasty Plot, Tailwind...)`, pr.length === 0, pr.slice(0, 6).map((m) => m.name).join(', '));
check('Prankster does nothing to damaging moves', ref.moves.filter((m) => m.category !== 'Status').every((m) => (movePriority(prankster, m.name, field)?.priority ?? 0) === m.priority));
check('Magic Room / Wonder Room are normal priority', movePriority(set, 'Magic Room', field)?.priority === 0 && movePriority(set, 'Wonder Room', field)?.priority === 0);
check('Trick Room is -7', movePriority(set, 'Trick Room', field)?.priority === -7);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
