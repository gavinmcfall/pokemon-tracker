export type Gender = 'male' | 'female' | 'genderless';

export const GENDERS: readonly Gender[] = ['male', 'female', 'genderless'];

/** One collectible slot in the living dex: species × form × gender (spec §3). */
export interface Entry {
  entryKey: string;
  dex: number;
  name: string;
  formSlug: string;
  formLabel: string | null;
  gender: Gender;
  types: string[];
  generation: number;
  spriteUrl: string;
  isCosmetic: boolean;
}

/** Owner-owned catch status, keyed by entryKey (spec §3). */
export interface Status {
  entryKey: string;
  caught: boolean;
  caughtAt: string | null;
  gameOrigin: string | null;
  method: string | null;
  notes: string | null;
}

/** Entry as served by GET /api/entries: spec §3 shape plus embedded status. */
export type EntryWithStatus = Entry & { status: Status | null };

export interface StatusPatch {
  entryKey: string;
  caught: boolean;
  gameOrigin?: string | null;
  method?: string | null;
  notes?: string | null;
}

export interface EntryFilters {
  gen?: number;
  type?: string;
  status?: 'caught' | 'uncaught';
  q?: string;
}

export interface TypeSummary {
  type: string;
  caught: number;
  total: number;
}

export interface Summary {
  caught: number;
  total: number;
  pct: number;
  byType: TypeSummary[];
}

export function entryKeyOf(dex: number, formSlug: string, gender: Gender): string {
  return `${String(dex).padStart(4, '0')}-${formSlug}-${gender}`;
}

export type SeedTier = 'species' | 'forms' | 'full';

export function parseSeedTier(raw: string | undefined): SeedTier {
  const tier = (raw ?? 'full').toLowerCase();
  if (tier === 'species' || tier === 'forms' || tier === 'full') return tier;
  throw new Error(`Invalid SEED_TIER "${raw}" — expected species | forms | full`);
}
