// Generates src/lib/vendor/kochance.js from @smogon/calc's own KO-chance code (MIT licensed).
// The library's end-of-turn math is private, so it can't be extended from outside. This copies it verbatim
// and adds one hook (`extra`) for residual effects the library doesn't model: Ingrain, Aqua Ring, Curse and binding.
// Re-run after upgrading @smogon/calc:  node scripts/gen-kochance.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'node_modules/@smogon/calc/dist/desc.js'), 'utf8');

/** Source text of a top-level `function name(...) { ... }` (brace matched, no braces in strings there). */
function fn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
const trapping = src.match(/var TRAPPING = \[[\s\S]*?\];/)[0];
const read = src.match(/var __read = [\s\S]*?\n\};\n/)[0];

let hazards = fn('getHazards');
const oldSpikes = `if (!defender.hasType('Flying') &&
        !defender.hasAbility('Magic Guard', 'Levitate', 'Eelevate') &&
        !defender.hasItem('Air Balloon')) {`;
if (!hazards.includes(oldSpikes)) throw new Error('getHazards spikes condition changed; update gen-kochance.mjs');
// Gravity and Iron Ball ground a Pokemon, so Spikes hit it even if it is Flying / Levitating / holding an Air Balloon.
hazards = hazards
  .replace('function getHazards(gen, defender, defenderSide) {', 'function getHazards(gen, defender, defenderSide, field) {')
  .replace(oldSpikes, "if (!defender.hasAbility('Magic Guard') && isGrounded(defender, field)) {");

let getKO = fn('getKOChance');
let eot = fn('getEndOfTurn');

// thread the `extra` argument through
getKO = getKO.replace('getHazards(gen, defender, field.defenderSide);', 'getHazards(gen, defender, field.defenderSide, field);');
getKO = getKO.replace('function getKOChance(gen, attacker, defender, move, field, damageObj, err) {', 'function getKOChance(gen, attacker, defender, move, field, damageObj, err, extra) {');
getKO = getKO.replace('getEndOfTurn(gen, attacker, defender, move, field);', 'getEndOfTurn(gen, attacker, defender, move, field, extra);');
eot = eot.replace('function getEndOfTurn(gen, attacker, defender, move, field) {', 'function getEndOfTurn(gen, attacker, defender, move, field, extra) {');

// Mimikyu's Disguise: the first hit deals nothing and costs it 1/8 max HP, so one extra hit is needed. Modeled as
// 1/8 chip damage up front (like a hazard) plus one more hit in every "nHKO" label. Each replacement must match.
function must(text, from, to) {
  if (!text.includes(from)) throw new Error(`getKOChance changed upstream; update the Disguise patch for: ${from.slice(0, 70)}`);
  return text.replace(from, to);
}
getKO = must(
  getKO,
  'if (damage[0] >= defender.maxHP() && move.timesUsed === 1 && move.timesUsedWithMetronome === 1) {',
  'if (damage[0] >= defender.maxHP() && move.timesUsed === 1 && move.timesUsedWithMetronome === 1 && !(extra && extra.disguise)) {',
);
getKO = must(
  getKO,
  'var hazards = getHazards(gen, defender, field.defenderSide, field);',
  `var hazards = getHazards(gen, defender, field.defenderSide, field);
    var hitShift = extra && extra.disguise ? 1 : 0;
    if (hitShift) {
        hazards.damage += Math.floor(defender.maxHP() / 8);
        hazards.texts.push('Disguise (blocks the first hit)');
    }`,
);
getKO = must(
  getKO,
  `var KOTurnText = n === 1 ? 'OHKO'
            : (multipleTurns ? "KO in ".concat(n, " turns") : "".concat(n, "HKO"));`,
  `var shown = n + hitShift;
        var KOTurnText = shown === 1 ? 'OHKO'
            : (multipleTurns ? "KO in ".concat(shown, " turns") : "".concat(shown, "HKO"));`,
);
getKO = must(getKO, 'text += "OHKO".concat(hazardsText);', 'text += KOTurnText.concat(hazardsText);');

const hook = `    if (extra) {
        var xMaxHP = defender.maxHP();
        if (extra.curse && !defender.hasAbility('Magic Guard')) {
            damage -= Math.floor(xMaxHP / 4);
            texts.push('Curse damage');
        }
        if (extra.bound && !defender.hasAbility('Magic Guard') && !TRAPPING.includes(move.name)) {
            damage -= Math.floor(xMaxHP / (extra.bindingBand ? 6 : 8));
            texts.push('binding damage');
        }
        var xRoot = function (n) { return defender.hasItem('Big Root') ? Math.trunc(n * 5324 / 4096) : n; };
        if (extra.ingrain && !healBlock) {
            damage += xRoot(Math.floor(xMaxHP / 16));
            texts.push('Ingrain recovery');
        }
        if (extra.aquaRing && !healBlock) {
            damage += xRoot(Math.floor(xMaxHP / 16));
            texts.push('Aqua Ring recovery');
        }
    }
`;
const tail = 'return { damage: damage, texts: texts };';
const at = eot.lastIndexOf(tail);
if (at < 0) throw new Error('end of getEndOfTurn not found');
eot = eot.slice(0, at) + hook.trimStart().replace(/^/, '    ') + '    ' + eot.slice(at);

const body = [
  trapping,
  fn('combine'),
  hazards,
  eot,
  fn('computeKOChance'),
  fn('predictTotal'),
  fn('serializeText'),
  getKO,
]
  .join('\n')
  .replace(/\(0, util_2\.isGrounded\)/g, 'isGrounded')
  .replace(/\(0, util_1\.error\)/g, 'error');

const out = `// @ts-nocheck
// GENERATED by scripts/gen-kochance.mjs from @smogon/calc (MIT License, (c) smogon). Do not edit by hand.
${read}
function error(err, msg) {
    if (err) throw new Error(msg);
}
function isGrounded(pokemon, field) {
    return (field.isGravity || pokemon.hasItem('Iron Ball') ||
        (!pokemon.hasType('Flying') &&
            !pokemon.hasAbility('Levitate', 'Eelevate') &&
            !pokemon.hasItem('Air Balloon')));
}
${body}

export { getKOChance };
`;
fs.mkdirSync(path.join(root, 'src/lib/vendor'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/lib/vendor/kochance.js'), out);
console.log(`wrote src/lib/vendor/kochance.js (${out.split('\n').length} lines)`);
