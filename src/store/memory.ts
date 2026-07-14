import type { Entry, EntryFilters, EntryWithStatus, Specimen, SpecimenInput, Status, StatusPatch, Summary } from '../types.js';
import { applyStatusPatch, compareEntries, normalizeSpecimen, type SpecimenSyncResult, type Store, type UpsertResult } from './store.js';

/**
 * In-memory Store used by contract tests and the e2e harness. Must behave
 * identically to PgStore — both run the shared suite in test/store-contract.ts.
 */
export class MemoryStore implements Store {
  private entries = new Map<string, Entry>();
  private statuses = new Map<string, Status>();
  private specimens = new Map<string, Specimen>();
  now: () => Date = () => new Date();

  async upsertEntries(entries: Entry[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
    for (const e of entries) {
      const existing = this.entries.get(e.entryKey);
      if (!existing) {
        this.entries.set(e.entryKey, { ...e, types: [...e.types] });
        result.inserted += 1;
      } else if (JSON.stringify(existing) === JSON.stringify({ ...e, types: [...e.types] })) {
        result.unchanged += 1;
      } else {
        this.entries.set(e.entryKey, { ...e, types: [...e.types] });
        result.updated += 1;
      }
    }
    return result;
  }

  async listEntries(filters: EntryFilters): Promise<EntryWithStatus[]> {
    const q = filters.q?.toLowerCase();
    return [...this.entries.values()]
      .filter((e) => {
        if (filters.gen !== undefined && e.generation !== filters.gen) return false;
        if (filters.type !== undefined && !e.types.includes(filters.type.toLowerCase())) return false;
        const caught = this.statuses.get(e.entryKey)?.caught ?? false;
        if (filters.status === 'caught' && !caught) return false;
        if (filters.status === 'uncaught' && caught) return false;
        if (q !== undefined && q !== '') {
          const hit =
            e.name.toLowerCase().includes(q) ||
            (e.formLabel ?? '').toLowerCase().includes(q) ||
            e.entryKey.toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort(compareEntries)
      .map((e) => ({
        ...e,
        types: [...e.types],
        status: this.statuses.get(e.entryKey) ?? null,
        specimen: this.specimens.get(e.entryKey) ?? null,
      }));
  }

  async listEntryKeys(): Promise<Set<string>> {
    return new Set(this.entries.keys());
  }

  async getSummary(gen?: number): Promise<Summary> {
    const scoped = [...this.entries.values()].filter((e) => gen === undefined || e.generation === gen);
    const caught = scoped.filter((e) => this.statuses.get(e.entryKey)?.caught).length;
    const byType = new Map<string, { caught: number; total: number }>();
    for (const e of scoped) {
      for (const t of e.types) {
        const agg = byType.get(t) ?? { caught: 0, total: 0 };
        agg.total += 1;
        if (this.statuses.get(e.entryKey)?.caught) agg.caught += 1;
        byType.set(t, agg);
      }
    }
    return {
      caught,
      total: scoped.length,
      pct: scoped.length === 0 ? 0 : Math.round((caught / scoped.length) * 1000) / 10,
      byType: [...byType.entries()]
        .map(([type, agg]) => ({ type, ...agg }))
        .sort((a, b) => (a.type < b.type ? -1 : 1)),
    };
  }

  async setStatus(patch: StatusPatch): Promise<Status | null> {
    if (!this.entries.has(patch.entryKey)) return null;
    const next = applyStatusPatch(this.statuses.get(patch.entryKey) ?? null, patch, this.now);
    this.statuses.set(patch.entryKey, next);
    return { ...next };
  }

  async replaceSpecimens(inputs: SpecimenInput[]): Promise<SpecimenSyncResult> {
    const unmatched: string[] = [];
    const next = new Map<string, Specimen>();
    for (const input of inputs) {
      if (!this.entries.has(input.entryKey)) {
        unmatched.push(input.entryKey);
        continue;
      }
      next.set(input.entryKey, normalizeSpecimen(input));
    }
    this.specimens = next;
    return { upserted: next.size, unmatched };
  }

  /** Test helper: wipe all entries, statuses and specimens. */
  async reset(): Promise<void> {
    this.entries.clear();
    this.statuses.clear();
    this.specimens.clear();
  }

  async ready(): Promise<void> {}

  async close(): Promise<void> {}
}
