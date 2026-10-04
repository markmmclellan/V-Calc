import { MEGA_STONES, toID } from '@smogon/calc';
import { abilitiesOf } from './abilities';
import { blankSet, gen, SP_MAX, STAT_KEYS, type PokemonSet, type StatKey, type StatTable } from './model';

const STAT_ALIASES: Record<string, StatKey> = {
  hp: 'hp',
  atk: 'atk',
  attack: 'atk',
  def: 'def',
  defense: 'def',
  spa: 'spa',
  spatk: 'spa',
  spd: 'spd',
  spdef: 'spd',
  spe: 'spe',
  speed: 'spe',
};

/** Resolve a name against a smogon-calc data table case-insensitively; returns canonical name or undefined. */
function canon(kind: 'species' | 'items' | 'abilities' | 'moves', name: string): string | undefined {
  return gen[kind].get(toID(name))?.name;
}

/** Mega stone -> the Mega species it produces for this base species. */
export function megaFor(base: string, item: string): string | undefined {
  const table = (MEGA_STONES as Record<string, Record<string, string>>)[item];
  return table?.[base];
}

/** Base species that can use this stone (for exporting a Mega back to a paste). */
export function baseForMega(megaSpecies: string): { base: string; stone: string } | undefined {
  for (const [stone, m] of Object.entries(MEGA_STONES as Record<string, Record<string, string>>)) {
    for (const [base, mega] of Object.entries(m)) if (mega === megaSpecies) return { base, stone };
  }
  return undefined;
}

function parseStatLine(body: string): Partial<StatTable> {
  const out: Partial<StatTable> = {};
  for (const part of body.split('/')) {
    const m = part.trim().match(/^(\d+)\s*([A-Za-z. ]+)$/);
    if (!m) continue;
    const key = STAT_ALIASES[m[2].toLowerCase().replace(/[^a-z]/g, '')];
    if (key) out[key] = parseInt(m[1], 10);
  }
  return out;
}

export interface ParseResult {
  sets: PokemonSet[];
  warnings: string[];
}

/**
 * Parse Showdown-style pastes.
 * Champions uses Stat Points (0-32 per stat, 66 total). Showdown may write them on an "EVs:" line.
 * Lines labelled "SPs:"/"Stat Points:" are taken as-is. On an "EVs:" line, values <= 32 are taken as
 * Stat Points; if any value exceeds 32 the line is treated as real EVs and converted (ceil(ev / 8)).
 */
export function parsePaste(text: string): ParseResult {
  const warnings: string[] = [];
  const sets: PokemonSet[] = [];
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const set = blankSet('Garchomp');
    set.moves = [];
    set.critMoves = [];

    // --- header: "Nick (Species) (M) @ Item"
    let header = lines[0];
    let item = '';
    const at = header.lastIndexOf(' @ ');
    if (at >= 0) {
      item = header.slice(at + 3).trim();
      header = header.slice(0, at).trim();
    }
    header = header.replace(/\s*\((M|F)\)\s*$/i, '').trim();
    let speciesName = header;
    const paren = header.match(/^(.*)\(([^()]+)\)\s*$/);
    if (paren) {
      speciesName = paren[2].trim();
      set.nickname = paren[1].trim() || undefined;
    }
    let species = canon('species', speciesName);
    if (!species) {
      warnings.push(`Unknown Pokemon "${speciesName}"`);
      continue;
    }
    const itemName = item ? canon('items', item) : '';
    if (item && !itemName) warnings.push(`${species}: unknown item "${item}"`);
    set.item = itemName ?? '';
    const mega = set.item ? megaFor(species, set.item) : undefined;
    if (mega && gen.species.get(toID(mega))) species = mega;
    set.species = species;
    set.ability = abilitiesOf(species)[0] ?? '';

    let spLine: Partial<StatTable> | null = null;
    let evLine: Partial<StatTable> | null = null;

    for (const line of lines.slice(1)) {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^Ability:\s*(.+)$/i))) {
        const a = canon('abilities', m[1]);
        if (a) set.ability = a;
        else warnings.push(`${species}: unknown ability "${m[1]}"`);
      } else if ((m = line.match(/^(?:SPs?|Stat Points?):\s*(.+)$/i))) {
        spLine = parseStatLine(m[1]);
      } else if ((m = line.match(/^EVs?:\s*(.+)$/i))) {
        evLine = parseStatLine(m[1]);
      } else if ((m = line.match(/^(\w+)\s+Nature/i))) {
        const n = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
        set.nature = n;
      } else if (/^(IVs?|Level|Shiny|Happiness|Tera Type|Gender|Pokeball|Hidden Power):/i.test(line)) {
        // not used in Champions (fixed level 50 / IV 31)
      } else if ((m = line.match(/^[-–•]\s*(.+)$/))) {
        let mv = m[1].trim().split('/')[0].trim();
        if (/^Hidden Power/i.test(mv)) mv = 'Hidden Power';
        const name = canon('moves', mv);
        if (name) {
          set.moves.push(name);
          set.critMoves.push(false);
        } else warnings.push(`${species}: unknown move "${mv}"`);
      }
    }

    if (spLine) {
      for (const k of STAT_KEYS) set.sp[k] = Math.min(SP_MAX, spLine[k] ?? 0);
    } else if (evLine) {
      const isEV = Object.values(evLine).some((v) => (v ?? 0) > SP_MAX);
      for (const k of STAT_KEYS) {
        const v = evLine[k] ?? 0;
        set.sp[k] = Math.min(SP_MAX, isEV ? Math.ceil(v / 8) : v);
      }
    }

    while (set.moves.length < 4) {
      set.moves.push('');
      set.critMoves.push(false);
    }
    set.moves = set.moves.slice(0, 4);
    sets.push(set);
  }
  return { sets, warnings };
}

export function exportSet(set: PokemonSet): string {
  let species = set.species;
  let item = set.item;
  const mb = baseForMega(species);
  if (mb) {
    species = mb.base;
    if (!item) item = mb.stone;
  }
  const head = set.nickname && set.nickname !== species ? `${set.nickname} (${species})` : species;
  const lines = [item ? `${head} @ ${item}` : head];
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  lines.push('Level: 50');
  const sp = STAT_KEYS.filter((k) => set.sp[k] > 0).map(
    (k) => `${set.sp[k]} ${k === 'hp' ? 'HP' : k[0].toUpperCase() + k.slice(1)}`,
  );
  if (sp.length) lines.push(`EVs: ${sp.join(' / ')}`);
  if (set.nature && set.nature !== 'Serious') lines.push(`${set.nature} Nature`);
  for (const mv of set.moves) if (mv) lines.push(`- ${mv}`);
  return lines.join('\n');
}

export const exportTeam = (sets: PokemonSet[]) => sets.map(exportSet).join('\n\n');

/**
 * Create a paste on pokepast.es by submitting its own create form in a new tab.
 * A plain form POST navigation isn't subject to CORS, so no proxy is needed.
 */
export function shareToPokepaste(sets: PokemonSet[], title = 'V-Calc team'): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://pokepast.es/create';
  form.target = '_blank';
  form.style.display = 'none';
  const fields: Record<string, string> = {
    paste: exportTeam(sets),
    title,
    author: '',
    notes: 'Exported from V-Calc. Pokemon Champions team: the numbers on each "EVs" line are Stat Points (max 32 per stat, 66 total).',
  };
  for (const [name, value] of Object.entries(fields)) {
    const el = document.createElement(name === 'paste' || name === 'notes' ? 'textarea' : 'input');
    el.name = name;
    el.value = value;
    form.appendChild(el);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/**
 * Give a Pokemon an item. Mirrors Showdown: holding a Mega Stone switches it to (or from) the Mega form, and the
 * ability follows the form change.
 */
export function withItem(set: PokemonSet, item: string): PokemonSet {
  const canon = gen.items.get(toID(item))?.name ?? item;
  const current = baseForMega(set.species);
  const base = current?.base ?? set.species;
  const mega = megaFor(base, canon);
  let next = set.species;
  if (mega && gen.species.get(toID(mega))) next = mega;
  else if (current) next = current.base;
  if (next === set.species) return { ...set, item };
  const abs = abilitiesOf(next);
  return { ...set, item, species: next, ability: mega ? abs[0] ?? set.ability : abs.includes(set.ability) ? set.ability : abs[0] ?? '' };
}

/**
 * The two forms of a Pokémon holding its Mega Stone: Mega Evolved, and still in its base form (same item, with an
 * ability that is legal for the form, like the editor's Mega button). Null if it can't Mega Evolve.
 */
export function megaVariants(set: PokemonSet): { mega: PokemonSet; base: PokemonSet } | null {
  const current = baseForMega(set.species);
  const baseName = current?.base ?? set.species;
  const megaName = set.item ? megaFor(baseName, set.item) : undefined;
  if (!megaName || !gen.species.get(toID(megaName))) return null;
  const as = (species: string, mega: boolean): PokemonSet => {
    if (species === set.species) return set;
    const abs = abilitiesOf(species);
    return { ...set, species, ability: mega ? abs[0] ?? set.ability : abs.includes(set.ability) ? set.ability : abs[0] ?? '' };
  };
  return { mega: as(megaName, true), base: as(baseName, false) };
}
