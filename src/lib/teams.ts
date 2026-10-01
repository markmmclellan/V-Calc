import { toID } from '@smogon/calc';
import { blankSet, gen, SP_MAX, STAT_KEYS, zeroBoosts, type PokemonSet } from './model';

const STORAGE_KEY = 'champions-calc:teams:v1';

/** A named team. Only the build is stored; battle state (boosts, status, HP...) is dropped. */
export interface SavedTeam {
  id: string;
  name: string;
  sets: PokemonSet[];
  savedAt: number;
}

function read(): SavedTeam[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as SavedTeam[]) : [];
  } catch {
    return [];
  }
}

// Replaced (never mutated) on every change so useSyncExternalStore can compare snapshots.
let store: SavedTeam[] = read();
const listeners = new Set<() => void>();

export const getTeams = () => store;
export const subscribeTeams = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

function commit(next: SavedTeam[]) {
  store = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: teams still work for this session */
  }
  listeners.forEach((l) => l());
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** A copy of a set with its battle state reset, so saved and loaded teams always start clean. */
export function cleanSet(s: PokemonSet): PokemonSet {
  return {
    ...s,
    sp: { ...s.sp },
    moves: [...s.moves],
    critMoves: s.moves.map(() => false),
    boosts: zeroBoosts(),
    status: '',
    hpPercent: 100,
    abilityOn: false,
    alliesFainted: undefined,
  };
}

export function saveTeam(name: string, sets: PokemonSet[]): string {
  const team: SavedTeam = { id: newId(), name, sets: sets.map(cleanSet), savedAt: Date.now() };
  commit([...store, team]);
  return team.id;
}

export const updateTeam = (id: string, sets: PokemonSet[]) =>
  commit(store.map((t) => (t.id === id ? { ...t, sets: sets.map(cleanSet), savedAt: Date.now() } : t)));

export const renameTeam = (id: string, name: string) => commit(store.map((t) => (t.id === id ? { ...t, name } : t)));

export const deleteTeam = (id: string) => commit(store.filter((t) => t.id !== id));

export const exportTeams = () => JSON.stringify({ app: 'v-calc', version: 1, teams: store }, null, 2);

const int = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

/** Rebuild a set from untrusted JSON: only known fields survive, and values are clamped to legal ranges. */
function sanitizeSet(raw: unknown): PokemonSet | null {
  const r = raw as Partial<PokemonSet> | null;
  if (!r || typeof r.species !== 'string' || !gen.species.get(toID(r.species))) return null;
  const s = blankSet(r.species);
  if (typeof r.nickname === 'string') s.nickname = r.nickname.slice(0, 30);
  if (typeof r.item === 'string') s.item = r.item;
  if (typeof r.ability === 'string') s.ability = r.ability;
  if (typeof r.nature === 'string') s.nature = r.nature;
  for (const k of STAT_KEYS) s.sp[k] = int(r.sp?.[k], 0, SP_MAX);
  if (Array.isArray(r.moves)) s.moves = [0, 1, 2, 3].map((i) => String(r.moves?.[i] ?? ''));
  return s;
}

/** Merge teams from an export file; returns how many were added. Malformed teams are skipped. */
export function importTeams(json: string): number {
  const data = JSON.parse(json) as { teams?: unknown };
  if (!data || !Array.isArray(data.teams)) throw new Error('Not a V-Calc teams file');
  const added: SavedTeam[] = [];
  for (const t of data.teams as Partial<SavedTeam>[]) {
    if (!t || typeof t.name !== 'string' || !Array.isArray(t.sets)) continue;
    const sets = t.sets.slice(0, 6).map(sanitizeSet).filter((s): s is PokemonSet => !!s);
    if (!sets.length) continue;
    // compare in sanitized form so field order and extra fields can't hide a duplicate
    const sig = (list: PokemonSet[]) => JSON.stringify(list.map(sanitizeSet));
    const dupe = [...store, ...added].some((o) => o.name === t.name && sig(o.sets) === sig(sets));
    if (!dupe) added.push({ id: newId(), name: t.name.slice(0, 60), sets, savedAt: Date.now() });
  }
  if (added.length) commit([...store, ...added]);
  return added.length;
}
