import type { EntryWithStatus } from '../types.js';

/**
 * Goal scopes — what "finishing the dex" means. The seed stores every slot
 * (forms × genders); a scope picks which slots count toward the goal:
 *
 * - `species`          — one of each species (the classic National Living Dex).
 * - `species-regional` — one of each species + each regional form.
 * - `all`              — every slot (all forms, both genders).
 * - `phased`           — the goal is `all`, worked in phases: species first,
 *                        then regional forms, then every remaining slot. The
 *                        planner targets the first phase that isn't complete.
 *
 * A group (species, or a regional form of a species) is *caught* when ANY of
 * its slots is caught; its representative is a caught slot if there is one,
 * else the canonical slot — so the planner never asks you to re-catch a
 * species just because you ticked the other gender.
 */
export type GoalScope = 'species' | 'species-regional' | 'all' | 'phased';
export const GOAL_SCOPES: readonly GoalScope[] = ['species', 'species-regional', 'all', 'phased'];

export interface PhaseInfo {
  n: number;
  of: number;
  label: string;
  /** Groups caught / total within this phase's goal. */
  caught: number;
  total: number;
}

export interface ScopedEntries {
  scope: GoalScope;
  entries: EntryWithStatus[];
  /** Present only for `phased`. */
  phase?: PhaseInfo;
}

const REGIONAL_SEGMENTS = new Set(['alola', 'alolan', 'galar', 'galarian', 'hisui', 'hisuian', 'paldea', 'paldean']);

/** Is this formSlug a regional form (Alolan/Galarian/Hisuian/Paldean)? */
export function isRegionalForm(formSlug: string): boolean {
  return formSlug.split('_').some((seg) => REGIONAL_SEGMENTS.has(seg));
}

const caught = (e: EntryWithStatus) => Boolean(e.status?.caught);

/**
 * One representative slot per group. Groups: every species (keyed by dex,
 * regional-form slots excluded), plus — when `regional` — one group per
 * distinct regional form. Representative: first caught slot, else the
 * canonical slot (default form first, then male/genderless before female — the
 * games' default display — then entryKey order for determinism).
 */
const GENDER_RANK: Record<string, number> = { male: 0, genderless: 1, female: 2 };

function representatives(entries: EntryWithStatus[], regional: boolean): EntryWithStatus[] {
  const groups = new Map<string, EntryWithStatus[]>();
  for (const e of entries) {
    const isReg = isRegionalForm(e.formSlug);
    if (isReg && !regional) continue; // regional slots don't represent the base species
    const key = isReg ? `${e.dex}:${e.formSlug}` : String(e.dex);
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  const out: EntryWithStatus[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) =>
      Number(caught(b)) - Number(caught(a)) ||
      Number(b.formSlug === 'default') - Number(a.formSlug === 'default') ||
      (GENDER_RANK[a.gender] ?? 9) - (GENDER_RANK[b.gender] ?? 9) ||
      a.entryKey.localeCompare(b.entryKey));
    out.push(members[0]!);
  }
  return out.sort((a, b) => a.entryKey.localeCompare(b.entryKey));
}

const count = (reps: EntryWithStatus[]) => reps.filter(caught).length;

/** Apply a goal scope: the slots the planner should plan over (see GoalScope). */
export function scopeEntries(entries: EntryWithStatus[], scope: GoalScope): ScopedEntries {
  if (scope === 'all') return { scope, entries };
  if (scope === 'species') return { scope, entries: representatives(entries, false) };
  if (scope === 'species-regional') return { scope, entries: representatives(entries, true) };

  // phased — species, then +regional forms, then everything.
  const species = representatives(entries, false);
  if (count(species) < species.length) {
    return { scope, entries: species, phase: { n: 1, of: 3, label: 'Species', caught: count(species), total: species.length } };
  }
  const regional = representatives(entries, true);
  if (count(regional) < regional.length) {
    return { scope, entries: regional, phase: { n: 2, of: 3, label: 'Regional forms', caught: count(regional), total: regional.length } };
  }
  const done = entries.filter(caught).length;
  return { scope, entries, phase: { n: 3, of: 3, label: 'Every form & gender', caught: done, total: entries.length } };
}

/** Parse an untrusted scope string (query param); null when invalid. */
export function parseGoalScope(raw: string | undefined, fallback: GoalScope): GoalScope | null {
  if (raw === undefined || raw === '') return fallback;
  return (GOAL_SCOPES as readonly string[]).includes(raw) ? (raw as GoalScope) : null;
}
