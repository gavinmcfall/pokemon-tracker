import { PgStore } from '../store/pg.js';
import { parseSeedTier } from '../types.js';
import type { Entry, Obtainability } from '../types.js';
import { PokeApiClient, mapLimit, type RawForm, type RawPokemon } from './pokeapi.js';
import { expandSpecies, generationNumber, includedVarieties, neededForms } from './expand.js';
import { VERSION_TO_GAME } from '../obtainability/games.js';
import { chainAncestors, computeObtainability, ownDirectlyObtainableGames } from '../obtainability/compute.js';

interface SpeciesInfo {
  dex: number;
  name: string;
  generation: number;
  hasGenderDifferences: boolean;
  hasGmaxVariety: boolean;
  wildGameIds: Set<string>;
  evolutionChainUrl: string | null;
}

/**
 * Seed job (spec §5): idempotent upsert of the full entry catalogue from
 * PokéAPI. Safe to re-run any time — a run against unchanged data reports
 * inserted=0 updated=0. Never deletes: entries that disappear upstream are
 * reported as stale for a human to review.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const tier = parseSeedTier(process.env.SEED_TIER);
  const concurrency = Number.parseInt(process.env.SEED_CONCURRENCY ?? '8', 10);

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
  const speciesInfo: SpeciesInfo[] = [];
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

      // Obtainability pass 1: gather this species' wild-encounter games + meta.
      // Best-effort — a missing/failed encounters lookup must not fail the seed.
      const wildGameIds = new Set<string>();
      for (const v of varieties) {
        try {
          for (const area of await client.encounters(v.name)) {
            for (const vd of area.version_details) {
              const gameId = VERSION_TO_GAME[vd.version.name];
              if (gameId) wildGameIds.add(gameId);
            }
          }
        } catch { /* no encounter table for this variety */ }
      }
      speciesInfo.push({
        dex: species.id,
        name: species.name,
        generation: generationNumber(species),
        hasGenderDifferences: species.has_gender_differences ?? false,
        hasGmaxVariety: species.varieties.some((v) => v.pokemon.name.endsWith('-gmax')),
        wildGameIds,
        evolutionChainUrl: species.evolution_chain?.url ?? null,
      });
    } catch (err) {
      failures.push({ species: ref.name, error: String(err) });
    }
  });

  if (failures.length > 0) {
    for (const f of failures) console.error(`seed: FAILED ${f.species}: ${f.error}`);
    throw new Error(`seed aborted: ${failures.length} species failed — nothing was written`);
  }

  // Obtainability pass 2: derive evolution availability (a mon is reachable in
  // game X if a pre-evolution is obtainable there) and compute per-species.
  // A descendant is reachable in game X if a pre-evolution is *directly*
  // obtainable there — wild OR curated gift/static (e.g. a starter gift).
  const directGamesByDex = new Map(speciesInfo.map((s) => [s.dex, ownDirectlyObtainableGames(s.dex, s.wildGameIds)]));
  const nameToDex = new Map(speciesInfo.map((s) => [s.name, s.dex]));
  const obByDex = new Map<number, Obtainability>();
  await mapLimit(speciesInfo, concurrency, async (s) => {
    const evolvedFrom = new Set<string>();
    if (s.evolutionChainUrl) {
      try {
        const chain = await client.evolutionChain(s.evolutionChainUrl);
        for (const ancestor of chainAncestors(chain.chain, s.name)) {
          const dex = nameToDex.get(ancestor);
          for (const g of (dex !== undefined ? directGamesByDex.get(dex) : undefined) ?? []) evolvedFrom.add(g);
        }
      } catch { /* chain unavailable — no evolution-derived availability */ }
    }
    obByDex.set(s.dex, computeObtainability({
      dex: s.dex,
      generation: s.generation,
      hasGenderDifferences: s.hasGenderDifferences,
      hasGmaxVariety: s.hasGmaxVariety,
      ownWildGameIds: [...s.wildGameIds],
      evolvedFromGameIds: [...evolvedFrom],
    }));
  });
  const obtainabilityRecords = entries
    .map((e) => ({ entryKey: e.entryKey, obtainability: obByDex.get(e.dex) }))
    .filter((r): r is { entryKey: string; obtainability: Obtainability } => r.obtainability !== undefined);

  const byKey = new Map<string, Entry>();
  for (const e of entries) {
    const dup = byKey.get(e.entryKey);
    if (dup) throw new Error(`duplicate entry key across species: ${e.entryKey} (${dup.name} vs ${e.name})`);
    byKey.set(e.entryKey, e);
  }

  console.log(`seed: expanded ${entries.length} entries (requests=${client.requestCount}, cacheHits=${client.cacheHits})`);

  const store = new PgStore(databaseUrl);
  try {
    await store.migrate();
    const result = await store.upsertEntries(entries);
    console.log(`seed: inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged}`);

    const ob = await store.replaceObtainability(obtainabilityRecords);
    console.log(`seed: obtainability rows=${ob.upserted} unmatched=${ob.unmatched.length}`);

    const existing = await store.listEntryKeys();
    const stale = [...existing].filter((k) => !byKey.has(k));
    if (stale.length > 0) {
      console.warn(`seed: ${stale.length} entries exist in the DB but were not produced by this run (tier change or upstream removal). Not deleting — review manually:`);
      for (const key of stale.slice(0, 50)) console.warn(`  stale: ${key}`);
      if (stale.length > 50) console.warn(`  … and ${stale.length - 50} more`);
    }
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
