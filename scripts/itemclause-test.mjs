// Dev helper: Champions has an item clause, so auto-filled items on YOUR team skip ones a teammate already holds.
import { setFromMeta } from '../src/lib/data.ts';

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', label, detail); };

const row = (name) => ({ name, usage: 10 });
const entry = (items) => ({ species: 'Garchomp', displayName: 'Garchomp', data: { single: { items: items.map(row), abilities: [row('Rough Skin')], natures: [row('Jolly')], spreads: [], moves: [row('Earthquake')] } } });
const e = entry(['Sitrus Berry', 'Leftovers', 'Focus Sash']);

check('no teammates: the most used item', setFromMeta(e, 'single').item === 'Sitrus Berry');
check('first taken: rolls to the second', setFromMeta(e, 'single', undefined, ['Sitrus Berry']).item === 'Leftovers');
check('first two taken: rolls to the third', setFromMeta(e, 'single', undefined, ['Leftovers', 'Sitrus Berry']).item === 'Focus Sash');
check('an unrelated item taken changes nothing', setFromMeta(e, 'single', undefined, ['Choice Scarf']).item === 'Sitrus Berry');
check('every listed item taken: no item rather than a duplicate', setFromMeta(e, 'single', undefined, ['Sitrus Berry', 'Leftovers', 'Focus Sash']).item === '');
check('opponent (no list passed): unchanged', setFromMeta(e, 'single', undefined, undefined).item === 'Sitrus Berry');
check('an explicit item override still wins', setFromMeta(e, 'single', 'Life Orb', ['Life Orb']).item === 'Life Orb');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
