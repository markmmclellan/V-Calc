import type { BoostTable, PokemonSet } from './model';

/** Stat stage changes a status move causes, so one click can apply them instead of using the Battle state dropdowns. */
export type Boosts = Partial<BoostTable>;

export interface StatEffect {
  self?: Boosts; // changes to the user
  foe?: Boosts; // changes to the opposing Pokémon
  ally?: Boosts; // changes to the user's partner (Doubles)
  hpCost?: number; // % of max HP the user loses
  foeCurse?: boolean; // a Ghost-type user's Curse: the opponent is cursed
  haze?: boolean; // reset every stat stage
  copyFoe?: boolean; // Psych Up
  invertFoe?: boolean; // Topsy-Turvy
}

const ALL: Boosts = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };

/** Every stat-changing status move in Champions (checked against Smogon's move text by scripts/statmoves-test.mjs). */
const MOVES: Record<string, StatEffect> = {
  // the user
  'Acid Armor': { self: { def: 2 } },
  Agility: { self: { spe: 2 } },
  Amnesia: { self: { spd: 2 } },
  'Belly Drum': { self: { atk: 12 }, hpCost: 50 }, // to +6
  'Bulk Up': { self: { atk: 1, def: 1 } },
  'Calm Mind': { self: { spa: 1, spd: 1 } },
  Charge: { self: { spd: 1 } },
  'Clangorous Soul': { self: ALL, hpCost: 100 / 3 },
  Coil: { self: { atk: 1, def: 1 } },
  'Cosmic Power': { self: { def: 1, spd: 1 } },
  'Cotton Guard': { self: { def: 3 } },
  'Dragon Dance': { self: { atk: 1, spe: 1 } },
  Howl: { self: { atk: 1 }, ally: { atk: 1 } },
  'Iron Defense': { self: { def: 2 } },
  'Nasty Plot': { self: { spa: 2 } },
  'No Retreat': { self: ALL },
  'Quiver Dance': { self: { spa: 1, spd: 1, spe: 1 } },
  'Rock Polish': { self: { spe: 2 } },
  'Shell Smash': { self: { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 } },
  Shelter: { self: { def: 2 } },
  'Shift Gear': { self: { spe: 2, atk: 1 } },
  Stockpile: { self: { def: 1, spd: 1 } },
  'Stuff Cheeks': { self: { def: 2 } },
  'Swords Dance': { self: { atk: 2 } },
  'Tidy Up': { self: { atk: 1, spe: 1 } },
  // the opponent
  'Baby-Doll Eyes': { foe: { atk: -1 } },
  Charm: { foe: { atk: -2 } },
  'Cotton Spore': { foe: { spe: -2 } },
  'Eerie Impulse': { foe: { spa: -2 } },
  'Fake Tears': { foe: { spd: -2 } },
  'Feather Dance': { foe: { atk: -2 } },
  Flatter: { foe: { spa: 1 } },
  'Metal Sound': { foe: { spd: -2 } },
  'Noble Roar': { foe: { atk: -1, spa: -1 } },
  'Parting Shot': { foe: { atk: -1, spa: -1 } },
  'Scary Face': { foe: { spe: -2 } },
  Screech: { foe: { def: -2 } },
  'Spicy Extract': { foe: { atk: 2, def: -2 } },
  'Strength Sap': { foe: { atk: -1 } },
  'String Shot': { foe: { spe: -2 } },
  Swagger: { foe: { atk: 2 } },
  'Tearful Look': { foe: { atk: -1, spa: -1 } },
  Tickle: { foe: { atk: -1, def: -1 } },
  'Toxic Thread': { foe: { spe: -2 } },
  // the partner (Doubles)
  'Aromatic Mist': { ally: { spd: 1 } },
  Coaching: { ally: { atk: 1, def: 1 } },
  Decorate: { ally: { atk: 2, spa: 2 } },
  // everyone / copying
  Haze: { haze: true },
  'Psych Up': { copyFoe: true },
  'Topsy-Turvy': { invertFoe: true },
};

/** The stat effect of a move for this user, or null if it isn't a stat-changing move. */
export function statEffect(move: string, ctx: { types: string[]; weather?: string }): StatEffect | null {
  if (move === 'Curse') {
    return ctx.types.includes('Ghost') ? { hpCost: 50, foeCurse: true } : { self: { atk: 1, def: 1, spe: -1 } };
  }
  if (move === 'Growth') {
    const sun = ctx.weather === 'Sun' || ctx.weather === 'Harsh Sunshine';
    return { self: sun ? { atk: 2, spa: 2 } : { atk: 1, spa: 1 } };
  }
  return MOVES[move] ?? null;
}

/** Names of the moves in the table (for tests). */
export const STAT_MOVE_NAMES = [...Object.keys(MOVES), 'Curse', 'Growth'];

const LABEL: Record<keyof BoostTable, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const ORDER: (keyof BoostTable)[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/** "+1 Atk/Spe", "+2 Atk/SpA/Spe · −1 Def/SpD", or "all +1". */
function boostText(b: Boosts): string {
  const entries = ORDER.filter((k) => b[k]).map((k) => [k, b[k] as number] as const);
  if (!entries.length) return '';
  if (entries.length === 5 && entries.every(([, v]) => v === entries[0][1])) return `all ${entries[0][1] > 0 ? '+' : '−'}${Math.abs(entries[0][1])}`;
  const groups = new Map<number, string[]>();
  for (const [k, v] of entries) groups.set(v, [...(groups.get(v) ?? []), LABEL[k]]);
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([v, names]) => `${v > 0 ? '+' : '−'}${Math.min(6, Math.abs(v))} ${names.join('/')}`)
    .join(' · ');
}

/** Short label for the button. */
export function describeEffect(e: StatEffect): string {
  if (e.haze) return 'reset all stats';
  if (e.copyFoe) return "copy foe's stats";
  if (e.invertFoe) return "flip foe's stats";
  const parts: string[] = [];
  if (e.self) parts.push(boostText(e.self));
  if (e.foe) parts.push(`foe ${boostText(e.foe)}`);
  if (e.ally) parts.push(`${e.self ? 'ally' : 'partner'} ${boostText(e.ally)}`);
  if (e.foeCurse) parts.push('curse foe');
  if (e.hpCost) parts.push(`−${Math.round(e.hpCost)}% HP`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------------------------------

export interface ApplyInput {
  me: PokemonSet;
  foe?: PokemonSet;
  ally?: PokemonSet; // my partner
  foePartner?: PokemonSet; // their partner (only Haze reaches it)
  effect: StatEffect;
}
export interface ApplyResult {
  ok: boolean;
  reason?: string; // why it did nothing
  me: PokemonSet;
  foe?: PokemonSet;
  ally?: PokemonSet;
  foePartner?: PokemonSet;
  foeCurse?: boolean;
}

const clamp6 = (n: number) => Math.max(-6, Math.min(6, n));
const ZERO: BoostTable = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function shift(boosts: BoostTable, delta: Boosts): { next: BoostTable; changed: boolean } {
  const next = { ...boosts };
  let changed = false;
  for (const k of ORDER) {
    const d = delta[k];
    if (!d) continue;
    const v = clamp6(boosts[k] + d);
    if (v !== boosts[k]) changed = true;
    next[k] = v;
  }
  return { next, changed };
}

const same = (a: BoostTable, b: BoostTable) => ORDER.every((k) => a[k] === b[k]);

/** Apply a move's stat changes to the Pokémon involved. Fails (changing nothing) where the game would. */
export function applyStatEffect(input: ApplyInput): ApplyResult {
  const { effect: e } = input;
  let { me, foe, ally, foePartner } = input;
  const fail = (reason: string): ApplyResult => ({ ok: false, reason, me: input.me, foe: input.foe, ally: input.ally, foePartner: input.foePartner });

  if (e.haze) {
    const all = [me, foe, ally, foePartner].filter((p): p is PokemonSet => !!p);
    if (all.every((p) => same(p.boosts, ZERO))) return fail('Nobody has stat changes to reset');
    const clear = (p?: PokemonSet) => (p ? { ...p, boosts: { ...ZERO } } : p);
    return { ok: true, me: clear(me)!, foe: clear(foe), ally: clear(ally), foePartner: clear(foePartner) };
  }
  if (e.copyFoe) {
    if (!foe) return fail('Select an opposing Pokémon first');
    if (same(me.boosts, foe.boosts)) return fail('Nothing to copy');
    return { ok: true, me: { ...me, boosts: { ...foe.boosts } }, foe, ally, foePartner };
  }
  if (e.invertFoe) {
    if (!foe) return fail('Select an opposing Pokémon first');
    if (same(foe.boosts, ZERO)) return fail('The opponent has no stat changes to flip');
    const flipped = { ...foe.boosts };
    for (const k of ORDER) flipped[k] = -flipped[k] || 0;
    return { ok: true, me, foe: { ...foe, boosts: flipped }, ally, foePartner };
  }

  if (e.hpCost && me.hpPercent <= e.hpCost) return fail(`Fails: needs more than ${Math.round(e.hpCost)}% HP`);

  let changed = false;
  if (e.self) {
    const r = shift(me.boosts, e.self);
    changed ||= r.changed;
    me = { ...me, boosts: r.next };
  }
  if (e.foe) {
    if (!foe) return fail('Select an opposing Pokémon first');
    const r = shift(foe.boosts, e.foe);
    changed ||= r.changed;
    foe = { ...foe, boosts: r.next };
  }
  if (e.ally) {
    if (ally) {
      const r = shift(ally.boosts, e.ally);
      changed ||= r.changed;
      ally = { ...ally, boosts: r.next };
    } else if (!e.self) {
      return fail('Needs a partner on the field (Doubles)');
    }
  }
  if (!changed && !e.foeCurse) return fail('Stat changes are already at the limit');
  if (e.hpCost) me = { ...me, hpPercent: Math.round((me.hpPercent - e.hpCost) * 100) / 100 };
  return { ok: true, me, foe, ally, foePartner, foeCurse: e.foeCurse };
}
