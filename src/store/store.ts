import type { Entry, EntryFilters, EntryWithStatus, Status, StatusPatch, Summary } from '../types.js';

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Persistence boundary. PgStore is the production implementation; MemoryStore
 * backs contract tests and the e2e harness. Both must pass the shared contract
 * suite in test/store-contract.ts — keep behaviour identical.
 */
export interface Store {
  upsertEntries(entries: Entry[]): Promise<UpsertResult>;
  listEntries(filters: EntryFilters): Promise<EntryWithStatus[]>;
  listEntryKeys(): Promise<Set<string>>;
  getSummary(gen?: number): Promise<Summary>;
  /** Returns null when entryKey does not exist. */
  setStatus(patch: StatusPatch): Promise<Status | null>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function applyStatusPatch(existing: Status | null, patch: StatusPatch, now: () => Date): Status {
  const caughtAt = patch.caught
    ? (existing?.caught ? existing.caughtAt : now().toISOString())
    : null;
  return {
    entryKey: patch.entryKey,
    caught: patch.caught,
    caughtAt,
    gameOrigin: patch.gameOrigin !== undefined ? patch.gameOrigin : (existing?.gameOrigin ?? null),
    method: patch.method !== undefined ? patch.method : (existing?.method ?? null),
    notes: patch.notes !== undefined ? patch.notes : (existing?.notes ?? null),
  };
}

export function compareEntries(a: Entry, b: Entry): number {
  if (a.dex !== b.dex) return a.dex - b.dex;
  const aDefault = a.formSlug === 'default' ? 0 : 1;
  const bDefault = b.formSlug === 'default' ? 0 : 1;
  if (aDefault !== bDefault) return aDefault - bDefault;
  if (a.formSlug !== b.formSlug) return a.formSlug < b.formSlug ? -1 : 1;
  const genderOrder = { male: 0, female: 1, genderless: 2 } as const;
  return genderOrder[a.gender] - genderOrder[b.gender];
}
