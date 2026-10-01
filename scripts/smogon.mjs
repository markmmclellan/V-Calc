// Scrapes Smogon's Pokemon Champions dex (moves, items, abilities with descriptions) into public/data/smogon.json.
// The dex page embeds a short description for everything ("dump-basics"). The fuller text shown on each ability / item /
// move page comes from Smogon's own small JSON endpoint (POST /dex/_rpc/dump-<kind>), fetched once per entry.
// Usage: node scripts/smogon.mjs      (also runs as part of `npm run scrape`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = 'https://www.smogon.com/dex/champions/pokemon/salamence/';
const RPC = 'https://www.smogon.com/dex/_rpc';
const CONCURRENCY = 6;
const UA = 'Mozilla/5.0 (compatible; V-Calc/0.1; personal use)';
export const SMOGON_OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'smogon.json');

const CATEGORY = { Physical: 'Physical', Special: 'Special', 'Non-Damaging': 'Status' };

async function fetchPage(tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries) throw new Error(`${PAGE}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

/** Pull the reference tables out of a Smogon dex page. Throws if the page layout changed. */
export function parseBasics(html) {
  const m = html.match(/dexSettings = (\{[\s\S]*?\})\s*<\/script>/);
  if (!m) throw new Error('Smogon page has no dexSettings block (layout changed?)');
  const settings = JSON.parse(m[1]);
  const entry = (settings.injectRpcs ?? []).find((r) => JSON.stringify(r[0]).includes('dump-basics'));
  if (!entry) throw new Error('Smogon page has no dump-basics data (layout changed?)');
  return entry[1];
}

/** Smogon's page address for a name: "Mind's Eye" -> "minds-eye", "Mr. Mime" -> "mr-mime". */
export function aliasOf(name) {
  return name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The full description from one entry's own page, or null if it can't be fetched. */
async function fetchDetail(kind, name, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`${RPC}/dump-${kind}`, {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/json' },
        body: JSON.stringify({ alias: aliasOf(name), gen: 'champions' }),
      });
      if (res.status === 404 || res.status === 400) return null; // no such page
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()).description;
      return typeof d === 'string' && d.trim() ? d.trim() : null;
    } catch (e) {
      if (i === tries) return null;
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  return null;
}

/** Replace each entry's short description with the full one (kept as the fallback if the fetch fails). */
async function addFullDescriptions(ref, onProgress = () => {}) {
  const jobs = [
    ...ref.abilities.map((e) => ['ability', e]),
    ...ref.items.map((e) => ['item', e]),
    ...ref.moves.map((e) => ['move', e]),
  ];
  let done = 0;
  let failed = 0;
  const queue = [...jobs];
  onProgress(0, jobs.length);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const [kind, entry] = queue.shift();
        const full = await fetchDetail(kind, entry.name);
        if (full) entry.description = full;
        else failed++;
        onProgress(++done, jobs.length);
      }
    }),
  );
  return failed;
}

export function buildReference(basics) {
  const champions = (x) => (x.genfamily ?? []).includes('Champions') && x.isNonstandard === 'Standard';
  const abilities = basics.abilities.filter(champions).map((a) => ({ name: a.name, description: a.description ?? '' }));
  const items = basics.items
    .filter(champions)
    .filter((i) => i.name !== 'No Item')
    .map((i) => ({ name: i.name, description: i.description ?? '' }));
  const moves = basics.moves.filter(champions).map((mv) => ({
    name: mv.name,
    type: mv.type,
    category: CATEGORY[mv.category] ?? mv.category,
    power: mv.power || 0,
    accuracy: mv.accuracy === true ? 0 : mv.accuracy || 0, // 0 = never misses
    pp: mv.pp || 0,
    priority: mv.priority || 0,
    target: mv.target ?? '',
    description: mv.description ?? '',
  }));
  const byName = (a, b) => a.name.localeCompare(b.name);
  return { abilities: abilities.sort(byName), items: items.sort(byName), moves: moves.sort(byName) };
}

export async function scrapeSmogon({ onProgress } = {}) {
  const ref = buildReference(parseBasics(await fetchPage()));
  // refuse to overwrite good data with something obviously broken
  if (ref.moves.length < 300 || ref.items.length < 100 || ref.abilities.length < 100) {
    throw new Error(`Smogon data looks incomplete (${ref.moves.length} moves, ${ref.items.length} items, ${ref.abilities.length} abilities)`);
  }
  const failedDetails = await addFullDescriptions(ref, onProgress);
  const out = { updatedAt: new Date().toISOString(), source: PAGE, ...ref };
  fs.mkdirSync(path.dirname(SMOGON_OUT), { recursive: true });
  const tmp = SMOGON_OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, SMOGON_OUT);
  return { moves: ref.moves.length, items: ref.items.length, abilities: ref.abilities.length, failedDetails };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scrapeSmogon()
    .then((r) => {
      console.log(`Wrote ${r.moves} moves, ${r.items} items, ${r.abilities} abilities -> ${path.relative(process.cwd(), SMOGON_OUT)}`);
      if (r.failedDetails) console.log(`  (${r.failedDetails} entries kept their short description because the full text could not be fetched)`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
