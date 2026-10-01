// Dev helper: reordering team slots keeps the selected Pokemon and the partner attached to the same Pokemon.
//   npx tsx scripts/reorder-test.mjs
import { moveSlot } from '../src/components/TeamSide.tsx';

const names = ['A', 'B', 'C', 'D', 'E', 'F'];
const mkTeam = (n, active, partner) => ({ sets: names.slice(0, n).map((species) => ({ species })), active, partner });
const order = (t) => t.sets.map((s) => s.species).join('');
let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) { fails++; console.log('FAIL', label, detail); } };

// exhaustive: every team size, every from/to, every active/partner combination
let cases = 0;
for (let n = 2; n <= 6; n++)
  for (let from = 0; from < n; from++)
    for (let to = 0; to < n; to++)
      for (let active = 0; active < n; active++)
        for (let partner of [undefined, ...Array.from({ length: n }, (_, i) => i)]) {
          if (partner === active) continue;
          const t = mkTeam(n, active, partner);
          const r = moveSlot(t, from, to);
          cases++;
          const label = `n=${n} ${from}->${to} active=${active} partner=${partner}`;
          check(label + ' [same Pokemon, no losses]', [...order(r)].sort().join('') === [...order(t)].sort().join(''));
          check(label + ' [moved Pokemon lands at "to"]', r.sets[to].species === t.sets[from].species, order(r));
          check(label + ' [active follows its Pokemon]', r.sets[r.active].species === t.sets[active].species, order(r));
          if (partner === undefined) check(label + ' [no partner stays none]', r.partner === undefined);
          else check(label + ' [partner follows its Pokemon]', r.sets[r.partner].species === t.sets[partner].species, order(r));
          if (from === to) check(label + ' [no-op returns same team]', r === t);
        }

// a few readable examples
const show = (label, t, from, to) => { const r = moveSlot(t, from, to); console.log(label.padEnd(30), order(t), '->', order(r), `| active ${t.sets[t.active].species}@${t.active} -> @${r.active}`, r.partner === undefined ? '' : `| partner ${t.sets[t.partner].species}@${t.partner} -> @${r.partner}`); };
show('drag 1st onto 4th', mkTeam(6, 0, 2), 0, 3);
show('drag 5th onto 2nd', mkTeam(6, 4, 1), 4, 1);
show('drag a bystander across', mkTeam(6, 1, 3), 0, 5);

// out-of-range input is ignored
check('out-of-range ignored', moveSlot(mkTeam(3, 0), 0, 5).sets.length === 3 && order(moveSlot(mkTeam(3, 0), 0, 5)) === 'ABC');
console.log(`\n${cases} combinations checked.`, fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
