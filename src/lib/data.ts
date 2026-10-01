import { toID } from '@smogon/calc';
import { blankSet, gen, SP_MAX, zeroSP, type PokemonSet, type StatTable } from './model';
import { speciesCandidates } from './names';
import { abilitiesOf, setFormAbilities } from './abilities';
import { megaFor } from './showdown';

export type BattleFormat = 'single' | 'double';

export interface UsageRow {
  name: string;
  usage: number;
}
export interface SpreadRow {
  sp: StatTable;
  usage: number;
}
export interface FormatData {
  moves: UsageRow[];
  items: UsageRow[];
  abilities: UsageRow[];
  natures: UsageRow[];
  spreads: SpreadRow[];
  mega: { key: string; usage: number }[];
}
interface RawEntry {
  key: string;
  rank: { single: number | null; double: number | null };
  single: FormatData | null;
  double: FormatData | null;
}
interface RawFile {
  abilitiesByForm?: Record<string, string[]>;
  updatedAt: string;
  opggUpdatedAt?: string | null;
  source: string;
  names: Record<string, string>;
  images?: Record<string, string>;
  pokemon: Record<string, RawEntry>;
}

export interface MetaEntry {
  key: string;
  species: string; // smogon-calc species name
  displayName: string;
  rank: { single: number | null; double: number | null };
  data: Record<BattleFormat, FormatData | null>;
}

export interface Meta {
  updatedAt: string; // when we scraped
  opggUpdatedAt: string | null; // op.gg's own "Updated" label, as displayed on their site
  entries: MetaEntry[];
  bySpecies: Map<string, MetaEntry>; // keyed by toID(species)
}

export function resolveSpecies(key: string, displayName?: string): string | undefined {
  for (const c of speciesCandidates(key, displayName)) {
    const s = gen.species.get(toID(c));
    if (s) return s.name;
  }
  return undefined;
}

/**
 * Ask the local dev server to re-scrape op.gg (see refreshEndpoint in vite.config.ts).
 * Resolves when the new champions.json is written; throws if the endpoint is unavailable.
 */
/**
 * Whether the local dev/preview server's scraper endpoint exists. It answers a plain GET with 405; a static host
 * (GitHub Pages) answers 404, and a single-page-app fallback answers 200. Anything but 405 means "hosted copy".
 */
export async function canRefreshFromOpgg(): Promise<boolean> {
  try {
    return (await fetch(`${import.meta.env.BASE_URL}api/refresh`)).status === 405;
  } catch {
    return false;
  }
}

export async function refreshFromOpgg(onProgress: (done: number, total: number) => void): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/refresh`, { method: 'POST' });
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok && !ct.includes('ndjson')) {
    throw new Error(res.status === 404 || res.status === 405 ? 'Refresh needs the dev server (npm run dev)' : `HTTP ${res.status}`);
  }
  if (!ct.includes('ndjson') || !res.body) throw new Error('Refresh needs the dev server (npm run dev)');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') onProgress(msg.done, msg.total);
      else if (msg.type === 'error') throw new Error(msg.message);
      else if (msg.type === 'done') return;
    }
  }
  throw new Error('Refresh ended unexpectedly');
}

export async function loadMeta(): Promise<Meta> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/champions.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error('champions.json missing - run "npm run scrape"');
  const raw = (await res.json()) as RawFile;
  const forms = new Map<string, string[]>();
  for (const [key, list] of Object.entries(raw.abilitiesByForm ?? {})) {
    const sp = resolveSpecies(key, raw.names[key]);
    if (sp) forms.set(toID(sp), list);
  }
  setFormAbilities(forms);
  const entries: MetaEntry[] = [];
  for (const p of Object.values(raw.pokemon)) {
    const species = resolveSpecies(p.key, raw.names[p.key]);
    if (!species) continue;
    entries.push({
      key: p.key,
      species,
      displayName: raw.names[p.key] ?? species,
      rank: p.rank,
      data: { single: p.single, double: p.double },
    });
  }
  entries.sort((a, b) => (a.rank.single ?? 999) - (b.rank.single ?? 999));
  const bySpecies = new Map(entries.map((e) => [toID(e.species), e]));
  return { updatedAt: raw.updatedAt, opggUpdatedAt: raw.opggUpdatedAt ?? null, entries, bySpecies };
}

/** Find the meta entry for a species, falling back from Mega forms to their base. */
export function metaFor(meta: Meta, species: string): MetaEntry | undefined {
  const direct = meta.bySpecies.get(toID(species));
  if (direct) return direct;
  const base = gen.species.get(toID(species))?.baseSpecies;
  return base ? meta.bySpecies.get(toID(base)) : undefined;
}

/** Build a full set from the most-used op.gg choices for a Pokemon. */
export function setFromMeta(entry: MetaEntry, format: BattleFormat, itemOverride?: string): PokemonSet {
  const d = entry.data[format] ?? entry.data[format === 'single' ? 'double' : 'single'];
  const set = blankSet(entry.species);
  if (!d) return set;
  // Top item (skip mega stones so the default set isn't auto-mega unless it is the most used)
  const item = itemOverride ?? d.items[0]?.name ?? '';
  set.item = item;
  const mega = item ? megaFor(entry.species, item) : undefined;
  if (mega && gen.species.get(toID(mega))) set.species = mega;
  // A Mega has its own ability, so usage data for the base form doesn't apply to it.
  const legal = abilitiesOf(set.species);
  const top = d.abilities[0]?.name;
  set.ability = !mega && top && (!legal.length || legal.includes(top)) ? top : legal[0] ?? top ?? '';
  set.nature = d.natures[0]?.name ?? 'Serious';
  set.sp = d.spreads[0] ? { ...d.spreads[0].sp } : zeroSP();
  for (const k of Object.keys(set.sp) as (keyof StatTable)[]) set.sp[k] = Math.min(SP_MAX, set.sp[k]);
  set.moves = [0, 1, 2, 3].map((i) => d.moves[i]?.name ?? '');
  return set;
}
