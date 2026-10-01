// Scrapes op.gg Pokemon Champions usage data into public/data/champions.json.
// op.gg renders everything server-side and embeds it as RSC JSON, so we just parse the page payload.
// Usage: npm run scrape            (all pokemon)
//        npm run scrape -- garchomp incineroar   (subset, for testing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rscPayload, grabObject } from './rsc.mjs';
import { scrapeSmogon } from './smogon.mjs';

const BASE = 'https://op.gg/pokemon-champions';
const UA = 'Mozilla/5.0 (compatible; ChampionsCalculator/0.1; personal use)';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'champions.json');
const CONCURRENCY = 4;

const STAT_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

/** "02-20-00-00-00-20" (hex, HP/Atk/Def/SpA/SpD/Spe) -> {hp:2,atk:32,...} */
function parseSpread(s) {
  const parts = s.split('-').map((h) => parseInt(h, 16));
  return Object.fromEntries(STAT_ORDER.map((k, i) => [k, parts[i] ?? 0]));
}

function pickFormat(detail, L) {
  if (!detail) return null;
  const byId = (arr) => new Map((arr ?? []).map((x) => [x.id, x]));
  const moves = byId(L.moves);
  const items = byId(L.items);
  const abilities = byId(L.abilities);
  const natures = byId(L.natures);
  const named = (list, map) =>
    (list ?? [])
      .map((u) => ({ name: map.get(u.id)?.name, usage: u.usagePercent }))
      .filter((u) => u.name);
  return {
    moves: named(detail.moves, moves),
    items: named(detail.items, items),
    abilities: named(detail.abilities, abilities),
    natures: named(detail.natures, natures),
    spreads: (detail.training ?? []).map((t) => ({ sp: parseSpread(t.spread), usage: t.usagePercent })),
    mega: (detail.mega?.use ?? []).map((m) => ({ key: m.key, usage: m.usagePercent })),
  };
}

const titleCase = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Every form's ability names, from the roster op.gg embeds in each pokedex page (same on all pages). */
function rosterAbilities(payload) {
  const roster = grabObject(payload, 'compareProps')?.pokemon;
  if (!roster) return null;
  const tr = grabObject(payload, 'abilityTranslations') ?? {};
  return Object.fromEntries(roster.map((p) => [p.key, (p.abilities ?? []).map((a) => tr[a]?.name ?? titleCase(a))]));
}

let rosterCache = null;

async function scrapeOne(key) {
  const html = await get(`${BASE}/pokedex/${key}`);
  if (!html) return null;
  const payload = rscPayload(html);
  const L = grabObject(payload, 'lookupData') ?? {};
  const single = grabObject(payload, 'singleDetail');
  const double = grabObject(payload, 'doubleDetail');
  const ranks = grabObject(payload, 'currentRanks') ?? {};
  rosterCache ??= rosterAbilities(payload);
  const opggUpdatedAt = payload.match(/"updatedAt":"([A-Z][a-z]{2} [^"]+)"/)?.[1] ?? null;
  const names = {};
  const images = {};
  for (const m of payload.matchAll(/\{"key":"([^"]+)","name":"([^"]+)","imageUrl":"([^"]+)"/g)) {
    names[m[1]] = m[2];
    images[m[1]] = m[3];
  }
  return {
    key,
    rank: { single: ranks.single ?? null, double: ranks.double ?? null },
    single: pickFormat(single, L),
    double: pickFormat(double, L),
    names,
    images,
    opggUpdatedAt,
  };
}

/** Scrape everything (or a subset of keys) and write public/data/champions.json. */
export async function scrape({ keys, onProgress = () => {} } = {}) {
  if (!keys?.length) {
    const tier = await get(`${BASE}/tier`);
    keys = [...new Set([...tier.matchAll(/href="\/pokemon-champions\/pokedex\/([^"#?\/]+)"/g)].map((m) => m[1]))];
  }
  onProgress(0, keys.length);

  const pokemon = {};
  const names = {};
  const images = {};
  let done = 0;
  let opggUpdatedAt = null;
  const queue = [...keys];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const key = queue.shift();
        try {
          const r = await scrapeOne(key);
          if (r) {
            Object.assign(names, r.names);
            Object.assign(images, r.images);
            delete r.images;
            if (r.opggUpdatedAt) opggUpdatedAt = r.opggUpdatedAt;
            delete r.opggUpdatedAt;
            delete r.names;
            pokemon[key] = r;
          } else console.warn(`  ! ${key}: not found`);
        } catch (e) {
          console.warn(`  ! ${key}: ${e.message}`);
        }
        onProgress(++done, keys.length);
      }
    }),
  );

  if (!Object.keys(pokemon).length) throw new Error('No data scraped; leaving existing file untouched');
  const out = { updatedAt: new Date().toISOString(), opggUpdatedAt, abilitiesByForm: rosterCache ?? {}, source: `${BASE}/tier`, names, images, pokemon };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, OUT);

  // Smogon's move/item/ability reference. A failure here must not lose the op.gg data that was just saved.
  let smogon = null;
  let smogonError = null;
  try {
    smogon = await scrapeSmogon({ onProgress: (d, t) => onProgress(keys.length + d, keys.length + t) });
  } catch (e) {
    smogonError = e instanceof Error ? e.message : String(e);
    console.warn(`  ! Smogon reference not updated: ${smogonError}`);
  }
  return { count: Object.keys(pokemon).length, updatedAt: out.updatedAt, smogon, smogonError };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scrape({
    keys: process.argv.slice(2),
    onProgress: (d, t) => d % 25 === 0 && console.log(`  ${d}/${t}`),
  })
    .then((r) => {
      console.log(`Wrote ${r.count} pokemon -> ${path.relative(process.cwd(), OUT)}`);
      if (r.smogon) console.log(`Wrote ${r.smogon.moves} moves, ${r.smogon.items} items, ${r.smogon.abilities} abilities from Smogon${r.smogon.failedDetails ? ` (${r.smogon.failedDetails} kept a short description)` : ''}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
