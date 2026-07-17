import pg from 'pg';
import { PgStore } from '../store/pg.js';
import { parseSeedTier } from '../types.js';
import type { Entry, Obtainability } from '../types.js';
import { PokeApiClient, mapLimit, type RawForm, type RawPokemon } from './pokeapi.js';
import { expandSpecies, includedVarieties, neededForms } from './expand.js';
import { obtainabilityFromMirror } from '../obtainability/from-mirror.js';

/**
 * Seed job (spec §5): idempotent upsert of the full entry catalogue from
 * PokéAPI. Safe to re-run any time — a run against unchanged data reports
 * inserted=0 updated=0. Never deletes: entries that disappear upstream are
 * reported as stale for a human to review.
 *
 * Obtainability is sourced from the local PokéAPI mirror (`pokeapi.*`, populated
 * by the mirror CronJob) via pokédex membership — no per-species encounter or
 * evolution-chain HTTP fetches. If the mirror isn't populated yet the seed still
 * writes the catalogue and just skips obtainability (leaving any prior values).
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const tier = parseSeedTier(process.env.SEED_TIER);
  const concurrency = Number.parseInt(process.env.SEED_CONCURRENCY ?? '8', 10);
  const mirrorSchema = process.env.MIRROR_SCHEMA ?? 'pokeapi';

  const client = new PokeApiClient({
    ...(process.env.POKEAPI_BASE_URL ? { baseUrl: process.env.POKEAPI_BASE_URL } : {}),
    cacheDir: process.env.SEED_CACHE_DIR ?? '.pokeapi-cache',
    concurrency,
    log: (msg) => console.warn(`[pokeapi] ${msg}`),
  });

  console.log(`seed: tier=${tier} base=${client.baseUrl}`);
  const speciesRefs = await client.listSpecies();
  console.log(`seed: ${speciesRefs.length} species in national dex`);

  const entries: Entry[] = [];
  const failures: { species: string; error: string }[] = [];

  await mapLimit(speciesRefs, concurrency, async (ref) => {
    try {
      const species = await client.species(ref.name);
      const varieties = includedVarieties(species, tier);
      const pokemons = new Map<string, RawPokemon>();
      const forms = new Map<string, RawForm>();
      for (const v of varieties) {
        const pokemon = await client.pokemon(v.name);
        pokemons.set(v.name, pokemon);
        for (const formName of neededForms(pokemon, tier)) {
          forms.set(formName, await client.form(formName));
        }
      }
      entries.push(...expandSpecies({ species, pokemons, forms }, tier));
    } catch (err) {
      failures.push({ species: ref.name, error: String(err) });
    }
  });

  if (failures.length > 0) {
    for (const f of failures) console.error(`seed: FAILED ${f.species}: ${f.error}`);
    throw new Error(`seed aborted: ${failures.length} species failed — nothing was written`);
  }

  const byKey = new Map<string, Entry>();
  for (const e of entries) {
    const dup = byKey.get(e.entryKey);
    if (dup) throw new Error(`duplicate entry key across species: ${e.entryKey} (${dup.name} vs ${e.name})`);
    byKey.set(e.entryKey, e);
  }

  console.log(`seed: expanded ${entries.length} entries (requests=${client.requestCount}, cacheHits=${client.cacheHits})`);

  // Source obtainability from the mirror (best-effort — see note above).
  let obtainabilityRecords: { entryKey: string; obtainability: Obtainability }[] | null = null;
  const mirrorClient = new pg.Client({ connectionString: databaseUrl });
  await mirrorClient.connect();
  try {
    const byDex = await obtainabilityFromMirror(mirrorClient, mirrorSchema);
    obtainabilityRecords = entries
      .map((e) => ({ entryKey: e.entryKey, obtainability: byDex.get(e.dex) }))
      .filter((r): r is { entryKey: string; obtainability: Obtainability } => r.obtainability !== undefined);
    console.log(`seed: obtainability sourced from mirror (${mirrorSchema}) for ${byDex.size} species`);
  } catch (err) {
    console.warn(`seed: obtainability skipped — mirror "${mirrorSchema}" not available (${String(err).slice(0, 140)}). Run the pokeapi-mirror job, then re-seed.`);
  } finally {
    await mirrorClient.end();
  }

  const store = new PgStore(databaseUrl);
  try {
    await store.migrate();
    const result = await store.upsertEntries(entries);
    console.log(`seed: inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged}`);

    if (obtainabilityRecords) {
      const ob = await store.replaceObtainability(obtainabilityRecords);
      console.log(`seed: obtainability rows=${ob.upserted} unmatched=${ob.unmatched.length}`);
    }

    const existing = await store.listEntryKeys();
    const stale = [...existing].filter((k) => !byKey.has(k));
    if (stale.length > 0) {
      // SEED_PRUNE=1 deletes slots the catalogue no longer produces (curated
      // corrections like the fixed-gender forms, tier changes, upstream
      // removals). Off by default: pruning drops any catch status on those
      // slots (cascade), so it stays an explicit opt-in per run.
      const prune = ['1', 'true', 'yes'].includes((process.env.SEED_PRUNE ?? '').toLowerCase());
      if (prune) {
        const removed = await store.deleteEntries(stale);
        console.log(`seed: pruned ${removed} stale entries no longer in the catalogue:`);
        for (const key of stale.slice(0, 50)) console.log(`  pruned: ${key}`);
        if (stale.length > 50) console.log(`  … and ${stale.length - 50} more`);
      } else {
        console.warn(`seed: ${stale.length} entries exist in the DB but were not produced by this run (tier change or upstream removal). Set SEED_PRUNE=1 to delete them on the next run:`);
        for (const key of stale.slice(0, 50)) console.warn(`  stale: ${key}`);
        if (stale.length > 50) console.warn(`  … and ${stale.length - 50} more`);
      }
    }
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
