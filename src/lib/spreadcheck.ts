import { NATURES, toID } from '@smogon/calc';
import { calcMove, type FieldState, type MoveResult } from './calc';
import type { BattleFormat, MetaEntry } from './data';
import { calcStats, moveInfo, natureMods, STAT_LABEL, type PokemonSet, type StatKey, type StatTable } from './model';
import { baseForMega, megaFor } from './showdown';

/**
 * Spread check: from hits you saw in battle, work out which op.gg spread (and nature, and optionally item) the
 * opponent's Pokémon is running.
 * - 'attack': their moves hit your Pokémon for an exact number of HP (your HP is shown exactly in game).
 * - 'defense': your moves took a percentage of their HP (their HP bar only shows a percentage).
 * Each candidate is a full op.gg spread, so on defense it doesn't matter whether they put points in HP or Def/SpD:
 * the whole spread either produces the damage you saw or it doesn't. Several hits narrow it down further, since a
 * candidate has to fit every one of them.
 */
export type CheckMode = 'attack' | 'defense';

export interface Hit {
  move: string;
  crit: boolean;
  /** HP lost ('attack') or percent of HP lost ('defense'). */
  observed: number;
  /** Your Pokémon in this hit: the one that got hit ('attack') or the one that attacked ('defense'). */
  mine: PokemonSet;
}

export interface CheckInput {
  mode: CheckMode;
  /** The opponent's Pokémon, whose spread is unknown. */
  theirs: PokemonSet;
  hits: Hit[];
  field: FieldState;
  entry: MetaEntry | undefined;
  format: BattleFormat;
  /** Also try their common items instead of only the one set. */
  tryItems: boolean;
}

export interface Candidate {
  sp: StatTable;
  nature: string;
  item: string;
  /** Combined op.gg usage of spread x nature x item (only for ranking). */
  weight: number;
  /** Share of the matching candidates' combined usage, 0-1. */
  share: number;
  /** The stats the hits depend on, e.g. "Atk 182" or "HP 183 · Def 115". */
  stats: string;
  /** This candidate's damage range for each hit ("120–142 HP" or "45.1–53.2%"). */
  ranges: string[];
}

export interface InvestRange {
  label: string; // "+ nature", "neutral nature", "− nature"
  from: number;
  to: number;
}

export interface CheckResult {
  error?: string;
  /** What the set as currently entered would do, per hit. */
  current: string[];
  currentMatches?: boolean;
  matches: Candidate[];
  tested: number;
  /** 'attack' with one attacking stat only: every Stat Point amount in it that fits, per nature effect. */
  invest: InvestRange[];
  investStat?: StatKey;
}

/** Which of the attacker's stats a move uses. */
function attackStat(move: string): StatKey | undefined {
  const info = moveInfo(move);
  if (!info || info.category === 'Status') return undefined;
  if (toID(move) === 'bodypress') return 'def';
  return info.category === 'Physical' ? 'atk' : 'spa';
}

/** Which of the defender's stats a move hits (Psyshock and friends hit Def). */
function defenseStat(move: string): StatKey | undefined {
  const info = moveInfo(move);
  if (!info || info.category === 'Status') return undefined;
  if (['psyshock', 'psystrike', 'secretsword'].includes(toID(move))) return 'def';
  return info.category === 'Physical' ? 'def' : 'spd';
}

/** A nature that raises (+1), lowers (-1) or leaves alone (0) `stat`, without touching the stats in `avoid`. */
function natureFor(stat: StatKey, effect: -1 | 0 | 1, avoid: StatKey[]): string | undefined {
  if (effect === 0) return 'Serious';
  for (const name of Object.keys(NATURES)) {
    const { plus, minus } = natureMods(name);
    if (!plus || !minus) continue;
    if (effect === 1 && plus === stat && !avoid.includes(minus)) return name;
    if (effect === -1 && minus === stat && !avoid.includes(plus)) return name;
  }
  return undefined;
}

export function checkSpread(input: CheckInput): CheckResult {
  const { mode, theirs, field, entry, format } = input;
  const empty: CheckResult = { current: [], matches: [], tested: 0, invest: [] };
  const hits = input.hits.filter((h) => h.move);
  if (!hits.length) return { ...empty, error: 'Pick a move.' };
  const stats: StatKey[] = [];
  for (const h of hits) {
    const s = mode === 'attack' ? attackStat(h.move) : defenseStat(h.move);
    if (!s) return { ...empty, error: `${h.move} isn't a damaging move.` };
    if (!(h.observed > 0)) return { ...empty, error: mode === 'attack' ? `Enter the HP ${h.move} took.` : `Enter the % of HP ${h.move} took.` };
    if (mode === 'attack' && toID(h.move) === 'foulplay') return { ...empty, error: "Foul Play uses your Attack, not theirs, so it can't tell their spread." };
    if (!stats.includes(s)) stats.push(s);
  }

  // One hit, calculated with their Pokémon replaced by `variant`.
  const run = (h: Hit, variant: PokemonSet): MoveResult =>
    mode === 'attack' ? calcMove(variant, h.mine, h.move, h.crit, field, true) : calcMove(h.mine, variant, h.move, h.crit, field, false);
  const fits = (h: Hit, r: MoveResult): boolean => {
    if (!r.ok) return false;
    if (mode === 'attack') return r.rolls.includes(Math.round(h.observed));
    // Their HP bar shows whole percentages, and both the before and after values are rounded, so allow 1%.
    return r.rolls.some((d) => Math.abs((d / r.defenderHP) * 100 - h.observed) <= 1);
  };
  const fitsAll = (variant: PokemonSet): MoveResult[] | null => {
    const out: MoveResult[] = [];
    for (const h of hits) {
      const r = run(h, variant);
      if (!fits(h, r)) return null;
      out.push(r);
    }
    return out;
  };
  const rangeText = (r: MoveResult) => (mode === 'attack' ? `${r.min}–${r.max} HP` : `${r.minPct}–${r.maxPct}%`);

  const now = hits.map((h) => run(h, theirs));
  const bad = now.find((r) => !r.ok);
  if (bad) return { ...empty, error: `${bad.move}: ${bad.desc || 'does no damage here'}.` };
  const result: CheckResult = { ...empty, current: now.map(rangeText), currentMatches: now.every((r, i) => fits(hits[i], r)) };

  const keys: StatKey[] = mode === 'attack' ? stats : ['hp', ...stats];
  const statsLine = (sp: StatTable, nature: string): string => {
    const s = calcStats(theirs.species, nature, sp);
    return s ? keys.map((k) => `${STAT_LABEL[k]} ${s[k]}`).join(' · ') : '';
  };

  // Candidates from op.gg: spread x nature (x item).
  const d = entry?.data[format] ?? entry?.data[format === 'single' ? 'double' : 'single'];
  if (d?.spreads.length) {
    const natures = d.natures.length ? d.natures : [{ name: theirs.nature, usage: 100 }];
    // Mega Stones would change the species, so a Mega keeps its stone and the others never get one.
    const items =
      input.tryItems && !baseForMega(theirs.species)
        ? d.items.filter((i) => i.name === theirs.item || !megaFor(theirs.species, i.name)).slice(0, 10)
        : [{ name: theirs.item, usage: 100 }];
    if (!items.some((i) => i.name === theirs.item)) items.unshift({ name: theirs.item, usage: 1 });
    // Candidates that give the same result are grouped: only the stats the hits depend on (and the item) matter.
    const groups = new Map<string, Candidate>();
    for (const s of d.spreads) {
      for (const n of natures) {
        for (const it of items) {
          result.tested++;
          const variant: PokemonSet = { ...theirs, sp: { ...s.sp }, nature: n.name, item: it.name };
          const rs = fitsAll(variant);
          if (!rs) continue;
          const weight = s.usage * n.usage * it.usage;
          const line = statsLine(variant.sp, n.name);
          const key = `${line}|${it.name}`;
          const old = groups.get(key);
          if (old) old.weight += weight;
          else groups.set(key, { sp: variant.sp, nature: n.name, item: it.name, weight, share: 0, stats: line, ranges: rs.map(rangeText) });
        }
      }
    }
    const list = [...groups.values()].sort((a, b) => b.weight - a.weight);
    const total = list.reduce((a, c) => a + c.weight, 0);
    for (const c of list) c.share = total ? c.weight / total : 0;
    result.matches = list;
  }

  // On attack, also try every amount of Stat Points in the attacking stat, so you see what fits even off the list.
  if (mode === 'attack' && stats.length === 1) {
    const stat = stats[0];
    result.investStat = stat;
    const effects: [-1 | 0 | 1, string][] = [
      [1, '+ nature'],
      [0, 'neutral nature'],
      [-1, '− nature'],
    ];
    for (const [effect, label] of effects) {
      const nature = natureFor(stat, effect, ['hp', stat]);
      if (!nature) continue;
      const ok: number[] = [];
      for (let p = 0; p <= 32; p++) if (fitsAll({ ...theirs, nature, sp: { ...theirs.sp, [stat]: p } })) ok.push(p);
      if (ok.length) result.invest.push({ label, from: ok[0], to: ok[ok.length - 1] });
    }
  }
  return result;
}

/** "2/32/0/0/0/32" in HP/Atk/Def/SpA/SpD/Spe order. */
export const spreadText = (sp: StatTable) => [sp.hp, sp.atk, sp.def, sp.spa, sp.spd, sp.spe].join('/');
