import { blankField, calcMove, disguiseIntact, type FieldState } from './calc';
import type { PokemonSet } from './model';
import { effectiveSpeed, movePriority } from './speed';
import { megaVariants } from './showdown';
import { cleanSet } from './teams';

export type Format = 'single' | 'double';

/** BSS rules: bring 3 of 6 in Singles, 4 of 6 in Doubles. */
export const BRING_COUNT: Record<Format, number> = { single: 3, double: 4 };

/** One side's best attack in a matchup. */
export interface Strike {
  move: string; // '' when it has no damaging move that works
  pct: number; // average roll, as a % of the target's max HP
  turns: number; // hits needed to KO from full HP (Infinity = can't); includes the hit Disguise absorbs
  priority: number;
  disguise?: boolean; // the target is an intact Mimikyu: its first hit is blocked and it loses 1/8 max HP
}

export type Verdict = 'strong' | 'favored' | 'even' | 'unfavored' | 'loses';

/** Your Pokémon vs one of theirs, 1v1 from full HP. */
export interface Cell {
  score: number; // -1 (you lose clearly) .. +1 (you win clearly); exactly antisymmetric
  mine: Strike;
  theirs: Strike;
  first: 'me' | 'them' | 'tie';
  verdict: Verdict;
}

export interface Reason {
  index: number; // into your team
  form: 'mega' | 'base' | null; // null = can't Mega Evolve; 'base' = holds a Mega Stone but another pick is the one that evolves
  beats: { j: number; note: string }[];
  struggles: number[]; // opposing indices it does badly against
  synergy: string[]; // Doubles: why it works with its lead partner
}
export interface Threat {
  j: number; // into their team
  answer: number; // your best chosen answer
  verdict: Verdict;
  theirMove: string;
  theirPct: number;
}
export interface Analysis {
  format: Format;
  cells: Cell[][]; // [yours][theirs]
  bring: number[]; // your picks, leads first
  leads: number[]; // 1 in Singles, 2 in Doubles (subset of bring)
  reasons: Reason[]; // same order as bring
  threats: Threat[]; // worst first
  weights: number[]; // how dangerous each of theirs is (1..2)
  value: number;
  /** Your Pokémon as they are judged: the picks in the form they'll be in, the rest as their Mega (if they have one). */
  sets: PokemonSet[];
  /** Which of your picks Mega Evolves (only one can per battle), or null. */
  mega: number | null;
  /** True when two or more of your picks hold Mega Stones, so only one of them actually evolves. */
  conflict: boolean;
  /** Score any group of yours (with the best choice of which stone holder evolves). */
  evaluate: (group: number[]) => { value: number; mega: number | null };
}

const MAX_TURNS = 10; // needing more hits than this counts as "can't KO"
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function verdictOf(score: number): Verdict {
  return score >= 0.75 ? 'strong' : score >= 0.25 ? 'favored' : score > -0.25 ? 'even' : score > -0.75 ? 'unfavored' : 'loses';
}

/** A neutral field for team preview: no weather, terrain, screens or boosts. */
export function previewField(format: Format): FieldState {
  return { ...blankField(), gameType: format === 'single' ? 'Singles' : 'Doubles' };
}

function bestStrike(att: PokemonSet, def: PokemonSet, field: FieldState, reversed: boolean): Strike {
  let best: Strike = { move: '', pct: 0, turns: Infinity, priority: 0 };
  for (const m of att.moves) {
    if (!m) continue;
    const r = calcMove(att, def, m, false, field, reversed);
    if (!r.ok) continue; // status move, or it does nothing (immune, blocked)
    const pct = (r.minPct + r.maxPct) / 2;
    if (pct > best.pct) {
      // Mimikyu's Disguise soaks up the first hit and chips it for 1/8, so it needs one more hit than the damage suggests
      const disguise = disguiseIntact(att, def, m);
      const turns = disguise ? 1 + Math.ceil((100 - 12.5) / pct - 1e-9) : Math.ceil(100 / pct - 1e-9);
      best = { move: m, pct, turns: turns > MAX_TURNS ? Infinity : turns, priority: movePriority(att, m, field)?.priority ?? 0, disguise };
    }
  }
  return best;
}

/** Turn race: fewer hits to KO wins, and moving first is worth half a turn. */
export function pairScore(mine: Strike, theirs: Strike, first: Cell['first']): number {
  const a = mine.turns;
  const b = theirs.turns;
  if (!isFinite(a) && !isFinite(b)) return 0;
  if (!isFinite(a)) return -1;
  if (!isFinite(b)) return 1;
  const aEff = a - (first === 'me' ? 0.5 : first === 'tie' ? 0.25 : 0);
  const bEff = b - (first === 'them' ? 0.5 : first === 'tie' ? 0.25 : 0);
  return clamp((bEff - aEff) / 2, -1, 1);
}

function matchup(me: PokemonSet, them: PokemonSet, field: FieldState): Cell {
  const mine = bestStrike(me, them, field, false);
  const theirs = bestStrike(them, me, field, true);
  const mySpeed = effectiveSpeed(me, field, field.attackerSide)?.speed ?? 0;
  const theirSpeed = effectiveSpeed(them, field, field.defenderSide)?.speed ?? 0;
  let first: Cell['first'];
  if (mine.priority !== theirs.priority) first = mine.priority > theirs.priority ? 'me' : 'them';
  else first = mySpeed === theirSpeed ? 'tie' : mySpeed > theirSpeed ? 'me' : 'them';
  const score = pairScore(mine, theirs, first);
  return { score, mine, theirs, first, verdict: verdictOf(score) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Doubles synergy between two Pokémon that lead together. Small, explainable bonuses: not a simulation.

const SYNERGY: { note: string; bonus: number; has: (s: PokemonSet) => boolean }[] = [
  { note: 'Fake Out', bonus: 0.25, has: (s) => s.moves.includes('Fake Out') },
  { note: 'Intimidate', bonus: 0.15, has: (s) => s.ability === 'Intimidate' },
  { note: 'Tailwind', bonus: 0.2, has: (s) => s.moves.includes('Tailwind') },
  { note: 'Trick Room', bonus: 0.15, has: (s) => s.moves.includes('Trick Room') },
  { note: 'redirection (Follow Me / Rage Powder)', bonus: 0.2, has: (s) => s.moves.includes('Follow Me') || s.moves.includes('Rage Powder') },
  { note: 'Helping Hand', bonus: 0.1, has: (s) => s.moves.includes('Helping Hand') },
];
const SYNERGY_CAP = 0.6;

export function pairSynergy(a: PokemonSet, b: PokemonSet): { bonus: number; notes: string[] } {
  const notes: string[] = [];
  let bonus = 0;
  for (const s of SYNERGY) {
    const who = [a, b].filter(s.has);
    if (!who.length) continue;
    bonus += s.bonus;
    notes.push(`${who.map((w) => w.nickname || w.species).join(' and ')}: ${s.note}`);
  }
  return { bonus: Math.min(bonus, SYNERGY_CAP), notes };
}

// ---------------------------------------------------------------------------------------------------------------------

/** How well a chosen group handles every one of theirs. In Doubles a second good answer is worth a little extra. */
export function groupValue(cells: Cell[][], group: number[], weights: number[], format: Format): number {
  const cols = weights.length;
  let total = 0;
  for (let j = 0; j < cols; j++) {
    const s = group.map((i) => cells[i][j].score).sort((x, y) => y - x);
    total += weights[j] * ((s[0] ?? -1) + (format === 'double' && s.length > 1 ? 0.35 * s[1] : 0));
  }
  // small tie-break: prefer groups that are strong overall
  const strength = group.reduce((acc, i) => acc + weightedMean(cells[i], weights), 0);
  return total + 0.1 * strength;
}

function weightedMean(row: Cell[], weights: number[]): number {
  const w = weights.reduce((a, b) => a + b, 0) || 1;
  return row.reduce((acc, c, j) => acc + c.score * weights[j], 0) / w;
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, cur: number[]) => {
    if (cur.length === k) return void out.push([...cur]);
    for (let i = start; i < n; i++) pick(i + 1, [...cur, i]);
  };
  pick(0, []);
  return out;
}

const label = (s: PokemonSet) => s.nickname || s.species;

/**
 * Work out which of `mine` to bring against `theirs` (each up to 6, from team preview).
 * Every Pokémon is judged as it is built, at full HP with no field effects.
 *
 * Only one Pokémon can Mega Evolve per battle. A stone holder is therefore judged both ways, and a group is scored with
 * the best choice of which one evolves; any other stone holder in the group plays as its base form. The opponent's
 * Pokémon are judged as entered (so every stone holder of theirs counts as Mega Evolved, the cautious assumption).
 */
export function analyze(mineRaw: PokemonSet[], theirsRaw: PokemonSet[], format: Format): Analysis {
  const given = mineRaw.map(cleanSet);
  const theirs = theirsRaw.map(cleanSet);
  const field = previewField(format);

  const variants = given.map((s) => megaVariants(s));
  const megaSets = given.map((s, i) => (variants[i] ? cleanSet(variants[i]!.mega) : s));
  const baseSets = variants.map((v) => (v ? cleanSet(v.base) : null));
  const megaRows = megaSets.map((me) => theirs.map((them) => matchup(me, them, field)));
  const baseRows = baseSets.map((base) => (base ? theirs.map((them) => matchup(base, them, field)) : null));
  const canMega = (i: number) => baseRows[i] !== null;

  // opposing Pokémon that beat most of your team count for more
  const weights = theirs.map((_, j) => {
    const avgLoss = given.length ? given.reduce((acc, _m, i) => acc - megaRows[i][j].score, 0) / given.length : 0;
    return 1 + clamp(avgLoss, 0, 1);
  });

  /** A group's value with the best choice of who Mega Evolves (nobody is also allowed). */
  const evaluate = (g: number[]) => {
    const holders = g.filter(canMega);
    const options = holders.length ? [...holders, -1] : [-1];
    let best = { value: -Infinity, mega: null as number | null, cells: megaRows };
    for (const m of options) {
      const cells = megaRows.map((row, i) => (g.includes(i) && canMega(i) && i !== m ? baseRows[i]! : row));
      const value = groupValue(cells, g, weights, format);
      if (value > best.value + 1e-9) best = { value, mega: m >= 0 ? m : null, cells };
    }
    return best;
  };

  const n = Math.min(BRING_COUNT[format], given.length);
  let group = given.map((_, i) => i);
  if (given.length && theirs.length) {
    let bestValue = -Infinity;
    for (const g of combos(given.length, n)) {
      const v = evaluate(g).value;
      if (v > bestValue + 1e-9) {
        bestValue = v;
        group = g;
      }
    }
  } else {
    group = group.slice(0, n);
  }

  const chosen = group.length && theirs.length ? evaluate(group) : { value: 0, mega: null as number | null, cells: megaRows };
  const cells = chosen.cells;
  const picked = new Set(group);
  const sets = given.map((_, i) => (picked.has(i) && canMega(i) && i !== chosen.mega ? baseSets[i]! : megaSets[i]));
  const form = (i: number): Reason['form'] => (!canMega(i) ? null : picked.has(i) && i !== chosen.mega ? 'base' : 'mega');
  const conflict = group.filter(canMega).length > 1;

  // leads: one in Singles, the best pair in Doubles
  let leads: number[] = [];
  let synergyNotes: string[] = [];
  if (group.length) {
    if (format === 'single' || group.length < 2) {
      leads = [group.reduce((a, b) => (weightedMean(cells[b], weights) > weightedMean(cells[a], weights) + 1e-9 ? b : a))];
    } else {
      let best = -Infinity;
      const totalWeight = weights.reduce((x, y) => x + y, 0);
      for (const [a, b] of combos(group.length, 2).map((c) => c.map((x) => group[x]))) {
        const syn = pairSynergy(sets[a], sets[b]);
        // a synergy bonus of 0.25 counts like improving the pair's score by 0.125 against everything they have
        const v = groupValue(cells, [a, b], weights, 'double') + syn.bonus * 0.5 * totalWeight;
        if (v > best + 1e-9) {
          best = v;
          leads = [a, b];
          synergyNotes = syn.notes;
        }
      }
    }
  }

  const bring = [...leads, ...group.filter((i) => !leads.includes(i)).sort((a, b) => weightedMean(cells[b], weights) - weightedMean(cells[a], weights))];

  const reasons: Reason[] = bring.map((i) => {
    const beats = theirs
      .map((_, j) => ({ j, c: cells[i][j] }))
      .filter(({ c }) => c.score >= 0.25)
      .sort((a, b) => b.c.score - a.c.score)
      .slice(0, 4)
      .map(({ j, c }) => ({
        j,
        note: `${c.mine.move} ${Math.round(c.mine.pct)}%${c.first === 'me' ? ', outspeeds' : c.first === 'them' ? ', slower' : ''}`,
      }));
    const struggles = theirs
      .map((_, j) => ({ j, s: cells[i][j].score }))
      .filter(({ s }) => s <= -0.75)
      .sort((a, b) => a.s - b.s)
      .slice(0, 3)
      .map(({ j }) => j);
    return { index: i, form: form(i), beats, struggles, synergy: format === 'double' && leads.includes(i) ? synergyNotes : [] };
  });

  const threats: Threat[] = [];
  theirs.forEach((_, j) => {
    const answer = group.reduce((a, b) => (cells[b][j].score > cells[a][j].score ? b : a), group[0]);
    if (answer === undefined) return;
    const c = cells[answer][j];
    if (c.score < 0.25) threats.push({ j, answer, verdict: c.verdict, theirMove: c.theirs.move, theirPct: Math.round(c.theirs.pct) });
  });
  threats.sort((a, b) => cells[a.answer][a.j].score - cells[b.answer][b.j].score);

  return {
    format,
    cells,
    bring,
    leads,
    reasons,
    threats,
    weights,
    value: chosen.value,
    sets,
    mega: chosen.mega,
    conflict,
    evaluate: (g) => {
      const r = evaluate(g);
      return { value: r.value, mega: r.mega };
    },
  };
}

export { label as pokemonLabel };
