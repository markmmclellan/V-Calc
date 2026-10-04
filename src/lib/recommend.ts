import { toID } from '@smogon/calc';
import { calcMove, disguiseIntact, type FieldState } from './calc';
import { gen, type BoostTable, type PokemonSet } from './model';
import { compareSpeed, effectiveSpeed, movePriority } from './speed';

/** Accuracy of a move as a probability 0..1 (1 for moves that never miss). */
export type AccuracyOf = (move: string) => number;

/** How many turns ahead the Singles matchup is simulated. */
export const HORIZON = 5;

// ---------------------------------------------------------------------------------------------------------------------
// What the damage calculator can't tell us about a move.

type Boosts = Partial<BoostTable>;

/** Stat changes the user gets every time the move hits (deterministic ones only, which matter for repeated use). */
const SELF_BOOSTS: Record<string, Boosts> = {
  'Draco Meteor': { spa: -2 },
  'Overheat': { spa: -2 },
  'Leaf Storm': { spa: -2 },
  'Make It Rain': { spa: -2 },
  Superpower: { atk: -1, def: -1 },
  'Close Combat': { def: -1, spd: -1 },
  'Armor Cannon': { def: -1, spd: -1 },
  'Headlong Rush': { def: -1, spd: -1 },
  'Clanging Scales': { def: -1 },
  'Scale Shot': { def: -1 },
  'Torch Song': { spa: 1 },
  'Psyshield Bash': { def: 1 },
};

/** After a hit the user must skip its next turn. */
const RECHARGE = new Set(['Hyper Beam', 'Giga Impact', 'Blast Burn', 'Frenzy Plant', 'Hydro Cannon', 'Meteor Assault', 'Rock Wrecker']);

/** Charge on one turn, hit on the next. */
const TWO_TURN = new Set(['Solar Beam', 'Solar Blade', 'Fly', 'Dig', 'Dive', 'Bounce', 'Sky Attack', 'Meteor Beam', 'Electro Shot']);

/** Moves whose value isn't in their damage, so they are listed but not scored. */
export const SITUATIONAL: Record<string, string> = {
  'Fake Out': 'first turn only, and it makes the target flinch',
  'First Impression': 'first turn only',
  'Upper Hand': 'only works against a priority move',
  Counter: 'depends on the damage taken',
  'Mirror Coat': 'depends on the damage taken',
  'Metal Burst': 'depends on the damage taken',
  Comeuppance: 'depends on the damage taken',
  'Future Sight': 'hits two turns later',
};

type Mode = 'every' | 'recharge' | 'charge';

/** Whether a two-turn move has to charge first in this weather. */
export function chargesFirst(move: string, field: FieldState): boolean {
  if (!TWO_TURN.has(move)) return false;
  if ((move === 'Solar Beam' || move === 'Solar Blade') && (field.weather === 'Sun' || field.weather === 'Harsh Sunshine')) return false;
  if (move === 'Electro Shot' && (field.weather === 'Rain' || field.weather === 'Heavy Rain')) return false;
  return true;
}

const modeOf = (move: string, field: FieldState): Mode => (RECHARGE.has(move) ? 'recharge' : chargesFirst(move, field) ? 'charge' : 'every');

/** How many times an attack has been used after `turns` turns (assuming earlier ones landed). */
function attacksIn(mode: Mode, turns: number): number {
  if (turns <= 0) return 0;
  return mode === 'every' ? turns : mode === 'charge' ? Math.floor(turns / 2) : Math.ceil(turns / 2);
}

function withBoosts(set: PokemonSet, delta: Boosts | undefined, times: number): PokemonSet {
  if (!delta || times <= 0) return set;
  const boosts = { ...set.boosts };
  for (const k of Object.keys(delta) as (keyof BoostTable)[]) boosts[k] = Math.max(-6, Math.min(6, boosts[k] + (delta[k] ?? 0) * times));
  return { ...set, boosts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Kill-time distribution of one attack used turn after turn.

/** One attack's effect on one target. `rolls(t)` are the damage rolls of its t-th scheduled attack. */
export interface Profile {
  move: string;
  acc: number; // 0..1
  priority: number;
  mode: Mode;
  rolls: (turn: number) => number[];
  hp: number; // target's current HP
  maxHP: number;
  disguise: boolean; // an intact Mimikyu: the first hit that lands deals nothing and costs it 1/8 max HP
}

/** pmf over turns 1..HORIZON of the turn the target first faints (mass beyond the horizon is simply missing). */
export function killTimes(p: Profile, horizon = HORIZON): number[] {
  const chip = Math.floor(p.maxHP / 8);
  const key = (c: number, up: number, rc: number) => (c * 2 + up) * 2 + rc;
  let alive = new Map<number, number>([[key(0, p.disguise ? 1 : 0, 0), 1]]);
  const out: number[] = [];
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (let t = 1; t <= horizon; t++) {
    const next = new Map<number, number>();
    let died = 0;
    const rolls = p.rolls(t);
    for (const [k, pr] of alive) {
      const rc = k & 1;
      const up = (k >> 1) & 1;
      const c = k >> 2;
      const acts = p.mode === 'charge' ? t % 2 === 0 : p.mode === 'recharge' ? rc === 0 : true;
      if (!acts) {
        add(next, key(c, up, 0), pr); // charging or recharging this turn
        continue;
      }
      add(next, key(c, up, 0), pr * (1 - p.acc)); // missed
      const hit = pr * p.acc;
      const rcAfter = p.mode === 'recharge' ? 1 : 0;
      if (up) {
        const nc = c + chip; // the Disguise absorbs the hit and breaks
        if (nc >= p.hp) died += hit;
        else add(next, key(nc, 0, rcAfter), hit);
      } else if (rolls.length) {
        const w = hit / rolls.length;
        for (const r of rolls) {
          const nc = c + r;
          if (nc >= p.hp) died += w;
          else add(next, key(nc, 0, rcAfter), w);
        }
      } else {
        add(next, key(c, 0, rcAfter), hit);
      }
    }
    out.push(died);
    alive = next;
  }
  return out;
}

export interface Race {
  win: number;
  lose: number;
  draw: number; // nobody faints within the horizon
}

/** Who wins a 1v1 where both keep using the same attack, given each side's kill-time distribution. */
export function raceResult(fm: number[], ft: number[], first: 'me' | 'them' | 'tie'): Race {
  const cum = (f: number[]) => {
    let s = 0;
    return f.map((x) => (s += x));
  };
  const Fm = cum(fm);
  const Ft = cum(ft);
  const ge = (F: number[], t: number) => 1 - (t >= 2 ? F[t - 2] : 0); // P(T >= t)
  const gt = (F: number[], t: number) => 1 - F[t - 1]; // P(T > t)
  const run = (meFirst: boolean) => {
    let win = 0;
    let lose = 0;
    for (let t = 1; t <= fm.length; t++) {
      if (meFirst) {
        win += fm[t - 1] * ge(Ft, t);
        lose += ft[t - 1] * gt(Fm, t);
      } else {
        lose += ft[t - 1] * ge(Fm, t);
        win += fm[t - 1] * gt(Ft, t);
      }
    }
    return { win, lose };
  };
  const meFirst = run(true);
  const themFirst = run(false);
  // on a speed tie the order is a coin flip each turn, so average the two cases
  const r =
    first === 'me' ? meFirst : first === 'them' ? themFirst : { win: (meFirst.win + themFirst.win) / 2, lose: (meFirst.lose + themFirst.lose) / 2 };
  return { win: r.win, lose: r.lose, draw: Math.max(0, 1 - r.win - r.lose) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Building profiles from the damage calculator.

export interface Classified {
  scored: string[]; // damaging moves that work
  blocked: { move: string; reason: string }[]; // damaging moves that do nothing (immune, blocked)
  status: string[]; // status moves
  situational: { move: string; why: string }[];
}

export function classify(att: PokemonSet, def: PokemonSet, field: FieldState, reversed: boolean): Classified {
  const out: Classified = { scored: [], blocked: [], status: [], situational: [] };
  for (const move of att.moves) {
    if (!move || out.scored.includes(move)) continue;
    const r = calcMove(att, def, move, false, field, reversed);
    if (r.category === 'Status') out.status.push(move);
    else if (SITUATIONAL[move]) out.situational.push({ move, why: SITUATIONAL[move] });
    else if (!r.ok) out.blocked.push({ move, reason: r.desc || 'no effect' });
    else out.scored.push(move);
  }
  return out;
}

interface Pair {
  att: PokemonSet;
  def: PokemonSet;
  field: FieldState;
  reversed: boolean;
  accOf: AccuracyOf;
}

/**
 * Profile of `move` used by `att` on `def`. The attacker's own stat changes from earlier uses (Draco Meteor...) and the
 * defender's (from its own repeated move) are applied per turn. `attPrior`/`defPrior` say how many earlier uses count.
 */
export function profile(
  ctx: Pair,
  move: string,
  attPrior: (turn: number) => number,
  defMove: string | null,
  defPrior: (turn: number) => number,
): Profile | null {
  const { att, def, field, reversed } = ctx;
  const mode = modeOf(move, field);
  const cache = new Map<string, number[]>();
  const calcAt = (a: PokemonSet, d: PokemonSet) => {
    const k = JSON.stringify([a.boosts, d.boosts]);
    let rolls = cache.get(k);
    if (!rolls) {
      rolls = calcMove(a, d, move, false, field, reversed).rolls;
      cache.set(k, rolls);
    }
    return rolls;
  };
  const base = calcMove(att, def, move, false, field, reversed);
  if (!base.ok) return null;
  const rolls = (turn: number) =>
    calcAt(withBoosts(att, SELF_BOOSTS[move], attPrior(turn)), withBoosts(def, defMove ? SELF_BOOSTS[defMove] : undefined, defPrior(turn)));
  return {
    move,
    acc: ctx.accOf(move),
    priority: movePriority(att, move, field)?.priority ?? 0,
    mode,
    rolls,
    hp: base.curHP,
    maxHP: base.defenderHP,
    disguise: disguiseIntact(att, def, move),
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const cumulative = (f: number[]) => {
  let s = 0;
  return f.map((x) => (s += x));
};

// ---------------------------------------------------------------------------------------------------------------------
// Singles: pick the move with the best chance to win the 1v1.

export interface SinglesOption {
  move: string;
  priority: number;
  accuracy: number;
  avgPct: number; // average roll as a % of the target's CURRENT HP (can exceed 100)
  koNow: number; // chance this attack KOs if it gets to act (accuracy included)
  koBy: number[]; // chance the target is down by turn 1, 2, 3 using only this move (they don't act)
  first: 'me' | 'them' | 'tie'; // against their strongest reply
  win: number;
  lose: number;
  draw: number;
  replyMove: string | null; // the reply that hurts this option's chances most
  notes: string[];
}
export interface Reply {
  move: string;
  accuracy: number;
  avgPctOfMine: number; // of my CURRENT HP
  koChance: number; // chance that it KOs me in one hit (accuracy included)
}
export interface SinglesResult {
  options: SinglesOption[]; // best first
  mine: Classified;
  theirs: Classified;
  mySpeed: number;
  theirSpeed: number;
  replies: Reply[]; // their damaging moves vs me, strongest first
  warnings: string[];
}

function pctOfHp(p: Profile, turn = 1): number {
  return p.hp > 0 ? (avg(p.rolls(turn)) / p.hp) * 100 : 0;
}

function koOnce(p: Profile): number {
  if (p.disguise) return 0; // the first hit is blocked
  const rolls = p.rolls(1);
  return rolls.length ? p.acc * (rolls.filter((r) => r >= p.hp).length / rolls.length) : 0;
}

export function recommendSingles(me: PokemonSet, foe: PokemonSet, field: FieldState, accOf: AccuracyOf): SinglesResult {
  const mine = classify(me, foe, field, false);
  const theirs = classify(foe, me, field, true);
  const mySpeed = effectiveSpeed(me, field, field.attackerSide)?.speed ?? 0;
  const theirSpeed = effectiveSpeed(foe, field, field.defenderSide)?.speed ?? 0;

  const myCtx: Pair = { att: me, def: foe, field, reversed: false, accOf };
  const theirCtx: Pair = { att: foe, def: me, field, reversed: true, accOf };

  // their replies as they stand now (no stat changes yet), for display and for the warnings
  const replies: Reply[] = theirs.scored
    .map((move) => profile(theirCtx, move, () => 0, null, () => 0))
    .filter((p): p is Profile => !!p)
    .map((p) => ({ move: p.move, accuracy: p.acc, avgPctOfMine: pctOfHp(p), koChance: koOnce(p) }))
    .sort((a, b) => b.avgPctOfMine * b.accuracy - a.avgPctOfMine * a.accuracy);

  const options: SinglesOption[] = [];
  for (const move of mine.scored) {
    const myMode = modeOf(move, field);
    const solo = profile(myCtx, move, (t) => attacksIn(myMode, t - 1), null, () => 0);
    if (!solo) continue;
    const koBy = cumulative(killTimes(solo)).slice(0, 3);
    const notes: string[] = [];
    if (solo.disguise) notes.push('Disguise blocks the first hit');
    if (solo.mode === 'charge') notes.push('charges for a turn first');
    if (solo.mode === 'recharge') notes.push('must recharge after hitting');
    if (SELF_BOOSTS[move]) notes.push('weakens itself when repeated');
    if (solo.acc < 1) notes.push(`${Math.round(solo.acc * 100)}% accurate`);

    // pit it against each of their damaging moves; they are assumed to pick whichever is worst for us
    const rivals = theirs.scored.length ? theirs.scored : [null];
    let worst: { race: Race; first: SinglesOption['first']; reply: string | null } | null = null;
    for (const reply of rivals) {
      const replyMode = reply ? modeOf(reply, field) : 'every';
      const myPri = solo.priority;
      const theirPri = reply ? (movePriority(foe, reply, field)?.priority ?? 0) : -99;
      const first: SinglesOption['first'] =
        myPri !== theirPri ? (myPri > theirPri ? 'me' : 'them') : ((): SinglesOption['first'] => {
          const c = compareSpeed(mySpeed, theirSpeed, field.isTrickRoom);
          return c === 'a' ? 'me' : c === 'b' ? 'them' : 'tie';
        })();
      const mineP = profile(myCtx, move, (t) => attacksIn(myMode, t - 1), reply, (t) => attacksIn(replyMode, first === 'them' ? t : t - 1))!;
      const fm = killTimes(mineP);
      let ft: number[] = new Array(HORIZON).fill(0);
      if (reply) {
        const theirP = profile(theirCtx, reply, (t) => attacksIn(replyMode, t - 1), move, (t) => attacksIn(myMode, first === 'me' ? t : t - 1));
        if (theirP) ft = killTimes(theirP);
      }
      const race = raceResult(fm, ft, first);
      if (!worst || race.win < worst.race.win - 1e-12) worst = { race, first, reply };
    }
    const w = worst!;
    options.push({
      move,
      priority: solo.priority,
      accuracy: solo.acc,
      avgPct: pctOfHp(solo),
      koNow: koOnce(solo),
      koBy,
      first: w.first,
      win: w.race.win,
      lose: w.race.lose,
      draw: w.race.draw,
      replyMove: w.reply,
      notes,
    });
  }
  options.sort((a, b) => b.win - a.win || a.lose - b.lose || b.koNow - a.koNow || b.avgPct - a.avgPct);

  const warnings: string[] = [];
  const top = options[0];
  const strongest = replies[0];
  if (strongest && strongest.koChance >= 0.5) {
    // do they act before my best move does?
    const myPri = top?.priority ?? 0;
    const theirPri = movePriority(foe, strongest.move, field)?.priority ?? 0;
    const theyFirst = theirPri !== myPri ? theirPri > myPri : compareSpeed(mySpeed, theirSpeed, field.isTrickRoom) === 'b';
    if (theyFirst) {
      const who = me.nickname || me.species;
      warnings.push(
        `${foe.nickname || foe.species} moves first and can KO ${who} (${Math.round(strongest.koChance * 100)}% with ${strongest.move}), so ${top ? `${top.move} may never happen` : `${who} may never get to act`}. Look at a priority move, Protect or a switch.`,
      );
    }
  }
  if (top && top.win < 0.5 && top.lose > top.win) warnings.push('This matchup looks unfavorable even with your best move.');
  if (!mine.scored.length) warnings.push(`${me.nickname || me.species} has no damaging move that works against ${foe.nickname || foe.species}.`);
  if (!theirs.scored.length && !theirs.situational.length) warnings.push(`${foe.nickname || foe.species} has no damaging move listed, so its reply can't be modeled.`);
  return { options, mine, theirs, mySpeed, theirSpeed, replies, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------
// Doubles: pick the best combined plan for this turn.

const SPREAD_TARGETS = new Set(['allAdjacentFoes', 'allAdjacent']);

export type Spread = 'foes' | 'all' | null;

/** Whether the move hits several Pokémon (and whether that includes your own partner). */
export function spreadOf(move: string, field: FieldState, attacker: PokemonSet): Spread {
  const target = (gen.moves.get(toID(move)) as { target?: string } | undefined)?.target;
  if (move === 'Expanding Force' && field.terrain === 'Psychic' && attacker.ability !== 'Levitate') return 'foes';
  if (!target || !SPREAD_TARGETS.has(target)) return null;
  return target === 'allAdjacent' ? 'all' : 'foes';
}

/** Chance that the summed damage of independent attacks reaches `hp` (each attack lands with its accuracy). */
export function koProbability(sources: { acc: number; rolls: number[] }[], hp: number, firstHitBlocked = false, chip = 0): number {
  if (!sources.length) return 0;
  let p = 0;
  const n = sources.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let pm = 1;
    const hit: number[][] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        pm *= sources[i].acc;
        hit.push(sources[i].rolls);
      } else pm *= 1 - sources[i].acc;
    }
    if (pm === 0) continue;
    // enumerate combinations of rolls over the attacks that landed
    let totals: number[] = [firstHitBlocked ? chip : 0];
    hit.forEach((rolls, idx) => {
      const useRolls = firstHitBlocked && idx === 0 ? [0] : rolls; // the first landed hit is absorbed by the Disguise
      const nextTotals: number[] = [];
      for (const t of totals) for (const r of useRolls) nextTotals.push(t + r);
      totals = nextTotals;
    });
    p += pm * (totals.filter((t) => t >= hp).length / totals.length);
  }
  return p;
}

export interface Hit {
  foe: number; // index into the foes
  move: string;
  acc: number;
  rolls: number[];
  hp: number;
  disguise: boolean;
  maxHP: number;
}
export interface DoublesOption {
  actor: number;
  move: string;
  target: number | 'spread'; // a foe index, or 'spread' for moves that hit them all
  spread: Spread;
  hits: Hit[]; // on foes
  ally: { rolls: number[]; acc: number; hp: number; ko: number; avgPct: number } | null; // friendly fire
}
export interface FoeOutcome {
  foe: number;
  ko: number; // chance this plan KOs it
  avgPct: number; // expected damage as a % of its current HP, capped at 100
}
export interface Plan {
  actions: DoublesOption[]; // one per actor of mine
  outcomes: FoeOutcome[];
  ally: { ko: number; avgPct: number } | null; // worst friendly fire among the actions
  value: number;
}
export interface Threat {
  foe: number;
  target: number; // index into mine
  move: string;
  avgPct: number; // of that Pokémon's current HP
  koChance: number;
  first: 'me' | 'them' | 'tie';
}
export interface DoublesResult {
  plans: Plan[]; // best first
  options: DoublesOption[][]; // per actor
  classified: Classified[]; // per actor (vs the first foe)
  threats: Threat[];
  warnings: string[];
}

const VALUE_DAMAGE = 0.6; // damage that doesn't KO is worth this much per full HP removed, a KO is worth 1

function outcomeValue(ko: number, avgPct: number): number {
  return ko + (1 - ko) * Math.min(1, avgPct / 100) * VALUE_DAMAGE;
}

export function recommendDoubles(mine: PokemonSet[], foes: PokemonSet[], field: FieldState, accOf: AccuracyOf): DoublesResult {
  const options: DoublesOption[][] = [];
  const classified: Classified[] = [];

  mine.forEach((me, actor) => {
    const partner = mine.length > 1 ? mine[1 - actor] : null;
    const cls = foes.length ? classify(me, foes[0], field, false) : { scored: [], blocked: [], status: [], situational: [] };
    // classification is per target; a move that works on either foe counts
    const scored = new Set<string>();
    const blocked: Classified['blocked'] = [];
    for (const move of me.moves) {
      if (!move || scored.has(move)) continue;
      const worksOn = foes.map((foe) => calcMove(me, foe, move, false, field, false)).filter((r) => r.ok);
      if (SITUATIONAL[move] || chargesFirst(move, field) || !worksOn.length) continue;
      scored.add(move);
    }
    classified.push({ ...cls, scored: [...scored], blocked: cls.blocked.filter((b) => !scored.has(b.move)).concat(blocked) });

    const opts: DoublesOption[] = [];
    for (const move of scored) {
      const spread = spreadOf(move, field, me);
      const hitsOn = (foeIdx: number): Hit | null => {
        const r = calcMove(me, foes[foeIdx], move, false, field, false);
        if (!r.ok) return null;
        return { foe: foeIdx, move, acc: accOf(move), rolls: r.rolls, hp: r.curHP, maxHP: r.defenderHP, disguise: disguiseIntact(me, foes[foeIdx], move) };
      };
      let ally: DoublesOption['ally'] = null;
      if (spread === 'all' && partner) {
        // friendly fire: the partner is the "defender", on our own side
        const f2: FieldState = { ...field, defenderSide: field.attackerSide };
        const r = calcMove(me, partner, move, false, f2, false);
        if (r.ok) {
          const acc = accOf(move);
          const ko = acc * (r.rolls.filter((x) => x >= r.curHP).length / (r.rolls.length || 1));
          ally = { rolls: r.rolls, acc, hp: r.curHP, ko, avgPct: r.curHP ? Math.min(100, ((avg(r.rolls) * acc) / r.curHP) * 100) : 0 };
        }
      }
      if (spread) {
        const hits = foes.map((_, i) => hitsOn(i)).filter((h): h is Hit => !!h);
        if (hits.length) opts.push({ actor, move, target: 'spread', spread, hits, ally });
      } else {
        foes.forEach((_, i) => {
          const h = hitsOn(i);
          if (h) opts.push({ actor, move, target: i, spread: null, hits: [h], ally: null });
        });
      }
    }
    options.push(opts);
  });

  // every combination of one action per actor
  const plans: Plan[] = [];
  const evaluate = (actions: DoublesOption[]): Plan => {
    const outcomes: FoeOutcome[] = foes.map((_, i) => {
      const hits = actions.flatMap((a) => a.hits.filter((h) => h.foe === i));
      const hp = hits[0]?.hp ?? 0;
      if (!hits.length) return { foe: i, ko: 0, avgPct: 0 };
      const blocked = hits.some((h) => h.disguise);
      const ko = koProbability(hits.map((h) => ({ acc: h.acc, rolls: h.rolls })), hp, blocked, blocked ? Math.floor(hits[0].maxHP / 8) : 0);
      const expected = hits.reduce((s, h) => s + h.acc * avg(h.rolls), 0);
      return { foe: i, ko, avgPct: hp ? Math.min(100, (expected / hp) * 100) : 0 };
    });
    const allies = actions.map((a) => a.ally).filter((x): x is NonNullable<DoublesOption['ally']> => !!x);
    const friendly = allies.length ? { ko: Math.max(...allies.map((a) => a.ko)), avgPct: Math.max(...allies.map((a) => a.avgPct)) } : null;
    let value = outcomes.reduce((s, o) => s + outcomeValue(o.ko, o.avgPct), 0);
    for (const a of allies) value -= outcomeValue(a.ko, a.avgPct);
    return { actions, outcomes, ally: friendly, value };
  };
  const lists = options.filter((o) => o.length);
  if (lists.length === 1) lists[0].forEach((a) => plans.push(evaluate([a])));
  else if (lists.length === 2) for (const a of lists[0]) for (const b of lists[1]) plans.push(evaluate([a, b]));
  plans.sort((x, y) => y.value - x.value);

  // what each foe can do to each of mine, and who gets there first
  const threats: Threat[] = [];
  foes.forEach((foe, fi) => {
    mine.forEach((me, mi) => {
      const ctx: Pair = { att: foe, def: me, field, reversed: true, accOf };
      let best: Threat | null = null;
      let bestExpected = -1;
      for (const move of foe.moves) {
        if (!move || SITUATIONAL[move]) continue;
        const p = profile(ctx, move, () => 0, null, () => 0);
        if (!p) continue;
        const pct = pctOfHp(p);
        if (pct * p.acc > bestExpected) {
          bestExpected = pct * p.acc;
          const mySpeed = effectiveSpeed(me, field, field.attackerSide)?.speed ?? 0;
          const theirSpeed = effectiveSpeed(foe, field, field.defenderSide)?.speed ?? 0;
          const c = compareSpeed(mySpeed, theirSpeed, field.isTrickRoom);
          best = { foe: fi, target: mi, move, avgPct: pct, koChance: koOnce(p), first: c === 'a' ? 'me' : c === 'b' ? 'them' : 'tie' };
        }
      }
      if (best) threats.push(best);
    });
  });

  const warnings: string[] = [];
  threats
    .filter((t) => t.first === 'them' && t.koChance >= 0.5)
    .forEach((t) => warnings.push(`${foes[t.foe].nickname || foes[t.foe].species} outspeeds ${mine[t.target].nickname || mine[t.target].species} and can KO it (${Math.round(t.koChance * 100)}% with ${t.move}).`));
  mine.forEach((me, i) => {
    if (!options[i].length) warnings.push(`${me.nickname || me.species} has no damaging move that works against either opponent.`);
  });
  return { plans, options, classified, threats, warnings };
}
