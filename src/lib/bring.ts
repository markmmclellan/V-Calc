import { blankField, calcMove, type FieldState } from './calc';
import type { PokemonSet } from './model';
import { effectiveSpeed, movePriority } from './speed';
import { cleanSet } from './teams';

export type Format = 'single' | 'double';

/** BSS rules: bring 3 of 6 in Singles, 4 of 6 in Doubles. */
export const BRING_COUNT: Record<Format, number> = { single: 3, double: 4 };

/** One side's best attack in a matchup. */
export interface Strike {
  move: string; // '' when it has no damaging move that works
  pct: number; // average roll, as a % of the target's max HP
  turns: number; // hits needed to KO from full HP (Infinity = can't)
  priority: number;
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
      const turns = Math.ceil(100 / pct - 1e-9);
      best = { move: m, pct, turns: turns > MAX_TURNS ? Infinity : turns, priority: movePriority(att, m, field)?.priority ?? 0 };
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
 */
export function analyze(mineRaw: PokemonSet[], theirsRaw: PokemonSet[], format: Format): Analysis {
  const mine = mineRaw.map(cleanSet);
  const theirs = theirsRaw.map(cleanSet);
  const field = previewField(format);
  const cells = mine.map((me) => theirs.map((them) => matchup(me, them, field)));

  // opposing Pokémon that beat most of your team count for more
  const weights = theirs.map((_, j) => {
    const avgLoss = mine.length ? mine.reduce((acc, _m, i) => acc - cells[i][j].score, 0) / mine.length : 0;
    return 1 + clamp(avgLoss, 0, 1);
  });

  const n = Math.min(BRING_COUNT[format], mine.length);
  let group = mine.map((_, i) => i);
  let value = 0;
  if (mine.length && theirs.length) {
    let best = -Infinity;
    for (const g of combos(mine.length, n)) {
      const v = groupValue(cells, g, weights, format);
      if (v > best + 1e-9) {
        best = v;
        group = g;
      }
    }
    value = best;
  } else {
    group = group.slice(0, n);
  }

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
        const syn = pairSynergy(mine[a], mine[b]);
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
    return { index: i, beats, struggles, synergy: format === 'double' && leads.includes(i) ? synergyNotes : [] };
  });

  const threats: Threat[] = [];
  theirs.forEach((_, j) => {
    const answer = group.reduce((a, b) => (cells[b][j].score > cells[a][j].score ? b : a), group[0]);
    if (answer === undefined) return;
    const c = cells[answer][j];
    if (c.score < 0.25) threats.push({ j, answer, verdict: c.verdict, theirMove: c.theirs.move, theirPct: Math.round(c.theirs.pct) });
  });
  threats.sort((a, b) => cells[a.answer][a.j].score - cells[b.answer][b.j].score);

  return { format, cells, bring, leads, reasons, threats, weights, value };
}

export { label as pokemonLabel };
