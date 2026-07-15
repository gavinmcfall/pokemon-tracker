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

/** IV spread (0..31 each). */
export interface Ivs {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/**
 * HOME-derived facts about the best individual filling a caught slot, keyed by
 * entryKey. Generated from a Pokémon HOME export, regenerated on each sync —
 * distinct from owner-authored `Status`.
 */
export interface Specimen {
  entryKey: string;
  shiny: boolean;
  event: boolean;
  level: number | null;
  originGame: string | null;
  metYear: number | null;
  ivPerfect: number | null;
  ivs: Ivs | null;
  tera: string | null;
  ball: string | null;
  nature: string | null;
  ability: string | null;
  ribbons: string[];
  nickname: string | null;
  ot: string | null;
}

/** Ingest shape for POST /api/specimens — only entryKey is required. */
export interface SpecimenInput {
  entryKey: string;
  shiny?: boolean;
  event?: boolean;
  level?: number | null;
  originGame?: string | null;
  metYear?: number | null;
  ivPerfect?: number | null;
  ivs?: Ivs | null;
  tera?: string | null;
  ball?: string | null;
  nature?: string | null;
  ability?: string | null;
  ribbons?: string[] | null;
  nickname?: string | null;
  ot?: string | null;
}

export interface AvailabilityEntry {
  gameId: string;
  label: string;
  platform: string;
  method: string;
  shinyPossible: boolean;
}

/**
 * Where/how a slot can be legitimately obtained + shiny/mechanic flags.
 * Catalogue-derived (recomputed each seed), keyed by entryKey. Consumed by the
 * front-end's Obtainability zone + filters.
 */
export interface Obtainability {
  availability: AvailabilityEntry[];
  gmaxCapable: boolean;
  teraAvailable: boolean;
  catchableOnSwitch: boolean;
  shinyLegalSomewhere: boolean;
  unobtainableLegit: boolean;
  genderVisualDiff: boolean;
  shinyLockedIn: string[];
  originGames: string[];
}

/** Entry as served by GET /api/entries: spec §3 shape plus embedded status + specimen + obtainability. */
export type EntryWithStatus = Entry & {
  status: Status | null;
  specimen: Specimen | null;
  obtainability: Obtainability | null;
};

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
