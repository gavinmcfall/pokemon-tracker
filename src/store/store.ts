import type { Entry, EntryFilters, EntryWithStatus, Obtainability, Specimen, SpecimenInput, Status, StatusPatch, Summary } from '../types.js';

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface SyncResult {
  /** How many rows were written (matched a live entry). */
  upserted: number;
  /** entryKeys in the payload with no matching catalogue entry (reported, not fatal). */
  unmatched: string[];
}

export interface ObtainabilityRecord {
  entryKey: string;
  obtainability: Obtainability;
}

/** Normalize a lenient ingest payload into a full Specimen (defaults + null-fill). */
export function normalizeSpecimen(input: SpecimenInput): Specimen {
  return {
    entryKey: input.entryKey,
    shiny: input.shiny ?? false,
    event: input.event ?? false,
    level: input.level ?? null,
    originGame: input.originGame ?? null,
    metYear: input.metYear ?? null,
    ivPerfect: input.ivPerfect ?? null,
    ivs: input.ivs ?? null,
    tera: input.tera ?? null,
    ball: input.ball ?? null,
    nature: input.nature ?? null,
    ability: input.ability ?? null,
    ribbons: input.ribbons ?? [],
    nickname: input.nickname ?? null,
    ot: input.ot ?? null,
  };
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
  /**
   * Full-sync the specimen set (HOME regenerates the whole set each run):
   * replaces all specimens with the given payload, keeping only those whose
   * entryKey matches a live entry. Unmatched keys are reported, never fatal.
   */
  replaceSpecimens(inputs: SpecimenInput[]): Promise<SyncResult>;
  /**
   * Full-sync the catalogue-derived obtainability set (regenerated each seed):
   * replaces all rows, keeping only entryKeys that match a live entry.
   */
  replaceObtainability(records: ObtainabilityRecord[]): Promise<SyncResult>;
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
