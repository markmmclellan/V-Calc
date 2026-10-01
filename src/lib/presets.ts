import { toID } from '@smogon/calc';
import { gen, type PokemonSet, type StatTable } from './model';

const STORAGE_KEY = 'champions-calc:presets:v1';

/** A saved build. Battle state (boosts, status, HP, "ability active") is deliberately not part of it. */
export interface Preset {
  id: string;
  name: string;
  species: string; // the exact form, so a Mega preset brings the Mega state with it
  item: string;
  ability: string;
  nature: string;
  sp: StatTable;
  moves: string[];
  alliesFainted?: number;
}

type Store = Record<string, Preset[]>; // preset key (base species id) -> presets

function read(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

// Replaced (never mutated) on every change so useSyncExternalStore can compare snapshots.
let store: Store = read();
const listeners = new Set<() => void>();

export const getPresets = () => store;
export const subscribePresets = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function commit(next: Store) {
  store = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: presets still work for this session */
  }
  listeners.forEach((l) => l());
}

/** One list per base Pokemon, shared by all of its forms (Megas, regional and cosmetic forms). */
export function presetKey(species: string): string {
  if (species.startsWith('Aegislash')) return 'aegislash';
  const sp = gen.species.get(toID(species));
  return toID(sp?.baseSpecies || species);
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function snapshot(name: string, set: PokemonSet, id = newId()): Preset {
  return {
    id,
    name,
    species: set.species,
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    sp: { ...set.sp },
    moves: [...set.moves],
    ...(set.alliesFainted ? { alliesFainted: set.alliesFainted } : {}),
  };
}

/** Apply a preset to a set, keeping its battle state. */
export function applyPreset(set: PokemonSet, p: Preset): PokemonSet {
  return {
    ...set,
    species: p.species,
    item: p.item,
    ability: p.ability,
    nature: p.nature,
    sp: { ...p.sp },
    moves: [...p.moves],
    critMoves: p.moves.map(() => false),
    alliesFainted: p.alliesFainted,
  };
}

export function addPreset(set: PokemonSet, name: string): string {
  const key = presetKey(set.species);
  const p = snapshot(name, set);
  commit({ ...store, [key]: [...(store[key] ?? []), p] });
  return p.id;
}

export function updatePreset(set: PokemonSet, id: string) {
  const key = presetKey(set.species);
  commit({ ...store, [key]: (store[key] ?? []).map((p) => (p.id === id ? snapshot(p.name, set, id) : p)) });
}

export function renamePreset(species: string, id: string, name: string) {
  const key = presetKey(species);
  commit({ ...store, [key]: (store[key] ?? []).map((p) => (p.id === id ? { ...p, name } : p)) });
}

export function deletePreset(species: string, id: string) {
  const key = presetKey(species);
  const rest = (store[key] ?? []).filter((p) => p.id !== id);
  const next = { ...store };
  if (rest.length) next[key] = rest;
  else delete next[key];
  commit(next);
}

/** Total number of saved presets across every Pokemon. */
export const countPresets = (s: Store = store): number => Object.values(s).reduce((n, list) => n + list.length, 0);

/** Delete every preset for every Pokemon. */
export function clearAllPresets() {
  commit({});
}

export const exportPresets = () => JSON.stringify({ app: 'v-calc', version: 1, presets: store }, null, 2);

const isStat = (v: unknown): v is StatTable =>
  !!v && typeof v === 'object' && ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');

/** Merge presets from an export file; returns how many were added. Malformed entries are skipped. */
export function importPresets(json: string): number {
  const data = JSON.parse(json) as { presets?: Store };
  if (!data || typeof data.presets !== 'object' || !data.presets) throw new Error('Not a V-Calc presets file');
  const next: Store = { ...store };
  let added = 0;
  for (const list of Object.values(data.presets)) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (!p || typeof p.name !== 'string' || typeof p.species !== 'string' || !isStat(p.sp) || !Array.isArray(p.moves)) continue;
      if (!gen.species.get(toID(p.species))) continue;
      const key = presetKey(p.species);
      const dupe = (next[key] ?? []).some((q) => q.name === p.name && JSON.stringify({ ...q, id: 0 }) === JSON.stringify({ ...p, id: 0 }));
      if (dupe) continue;
      next[key] = [
        ...(next[key] ?? []),
        {
          id: newId(),
          name: p.name.slice(0, 60),
          species: p.species,
          item: String(p.item ?? ''),
          ability: String(p.ability ?? ''),
          nature: String(p.nature ?? 'Serious'),
          sp: { ...p.sp },
          moves: p.moves.slice(0, 4).map(String),
          ...(p.alliesFainted ? { alliesFainted: Number(p.alliesFainted) } : {}),
        },
      ];
      added++;
    }
  }
  if (added) commit(next);
  return added;
}
