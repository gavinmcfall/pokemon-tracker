import type pg from 'pg';
import type { EvolveFrom, Obtainability } from '../types.js';
import { VERSION_GROUP_TO_GAME } from './games.js';
import { computeObtainabilityFromSources, type ObtainSource } from './compute.js';
import { AVAILABILITY_EXCLUSIONS, STARTER_GIFTS, STATIC_AVAILABILITY } from './curated.js';

/** "kanto-route-25" → "Route 25"; "old-rod" → "old rod". */
const REGION_PREFIX = /^(kanto|johto|hoenn|sinnoh|sinnoh-pt|unova|unova-b2w2|kalos|alola|galar|hisui|paldea)-/;
export function prettyLocation(identifier: string, method: string): string {
  const stripped = identifier.replace(REGION_PREFIX, '');
  const words = stripped.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
  return method && method !== 'walk' ? `${words} (${method.replaceAll('-', ' ')})` : words;
}

/**
 * Source obtainability for every species from the local PokéAPI mirror, keyed by
 * National Dex number. Availability comes from **pokédex membership** — which
 * games a species appears in (main-series regional dexes) — which already
 * includes legendaries, gifts and evolved forms, so it needs no wild/evolution
 * curation. A wild-encounter check tags the method; the curated shiny-lock +
 * static overlay is folded in by computeObtainabilityFromSources.
 *
 * Throws if the mirror schema/tables aren't present — the seed treats that as
 * "no obtainability this run" (best-effort; run the mirror job first).
 */
export async function obtainabilityFromMirror(client: pg.ClientBase, schema = 'pokeapi'): Promise<Map<number, Obtainability>> {
  const q = (name: string) => `"${schema.replaceAll('"', '""')}"."${name}"`;

  const meta = await client.query<{ id: string; generation_id: string; has_gender_differences: string; has_gmax: boolean }>(
    `select s.id, s.generation_id, s.has_gender_differences,
            exists(
              select 1 from ${q('pokemon')} p
              join ${q('pokemon_forms')} f on f.pokemon_id = p.id
              where p.species_id = s.id and f.identifier like '%-gmax'
            ) as has_gmax
     from ${q('pokemon_species')} s`,
  );

  // Which game version-groups is each species in (per game-specific regional
  // dex), and is it wild-encounterable there? The wild (species, version-group)
  // set is precomputed once in a CTE and left-joined, rather than a correlated
  // subquery per row — the mirror tables are unindexed text, so the one-pass
  // form is much cheaper on the full dataset.
  const membership = await client.query<{ species_id: string; version_group: string; wild: boolean }>(
    `with wild as (
       select distinct p.species_id, v.version_group_id
       from ${q('encounters')} e
       join ${q('versions')} v on v.id = e.version_id
       join ${q('pokemon')} p on p.id = e.pokemon_id
     )
     select dn.species_id, vg.identifier as version_group,
            bool_or(w.species_id is not null) as wild
     from ${q('pokemon_dex_numbers')} dn
     join ${q('pokedexes')} pd on pd.id = dn.pokedex_id and pd.is_main_series = '1'
     join ${q('pokedex_version_groups')} pvg on pvg.pokedex_id = dn.pokedex_id
     join ${q('version_groups')} vg on vg.id = pvg.version_group_id
     left join wild w on w.species_id = dn.species_id and w.version_group_id = vg.id
     group by dn.species_id, vg.identifier`,
  );

  // Where each species is wild-encounterable, per version-group: distinct
  // location + encounter-method pairs (mirror has this for Gen 1→SwSh; the
  // newest games ship no encounter rows, so their entries just omit locations).
  const encounterLocs = await client.query<{ species_id: string; version_group: string; loc: string; method: string }>(
    `select distinct p.species_id, vg.identifier as version_group,
            l.identifier as loc, coalesce(em.identifier, 'walk') as method
     from ${q('encounters')} e
     join ${q('versions')} v on v.id = e.version_id
     join ${q('version_groups')} vg on vg.id = v.version_group_id
     join ${q('pokemon')} p on p.id = e.pokemon_id
     join ${q('location_areas')} la on la.id = e.location_area_id
     join ${q('locations')} l on l.id = la.location_id
     left join ${q('encounter_slots')} es on es.id = e.encounter_slot_id
     left join ${q('encounter_methods')} em on em.id = es.encounter_method_id
     order by 1, 2, 3, 4`,
  );
  const locsByKey = new Map<string, string[]>(); // `${dex}:${gameId}` -> pretty locations
  for (const row of encounterLocs.rows) {
    const gameId = VERSION_GROUP_TO_GAME[row.version_group];
    if (!gameId) continue;
    const key = `${row.species_id}:${gameId}`;
    const arr = locsByKey.get(key) ?? [];
    const pretty = prettyLocation(row.loc, row.method);
    if (!arr.includes(pretty)) arr.push(pretty);
    locsByKey.set(key, arr);
  }

  // Serebii supplement (see src/supplement/): locations for the games PokéAPI
  // has no encounter data for (sv, za). Only ever fills gaps — mirror-derived
  // locations win — and only for games the species is already available in.
  // Best-effort: absent schema (job never run) just means no supplement.
  const supByKey = new Map<string, string[]>();
  try {
    const sup = await client.query<{ dex: string; game_id: string; locations: string[] }>(
      `select dex::text, game_id, locations from "supplement"."serebii_locations"`,
    );
    for (const row of sup.rows) {
      const key = `${row.dex}:${row.game_id}`;
      if (locsByKey.has(key)) continue; // mirror data wins
      const arr: string[] = [];
      for (const l of row.locations) if (!arr.includes(l)) arr.push(l);
      const existing = supByKey.get(key);
      if (existing) { for (const l of arr) if (!existing.includes(l)) existing.push(l); }
      else supByKey.set(key, arr);
    }
  } catch { /* supplement schema not present — nothing to merge */ }

  // How each species is reached by evolution: its pre-evolution, and whether
  // every evolution path to it requires a trade (Kadabra → Alakazam).
  const evolutions = await client.query<{ id: string; from_id: string; from_name: string; trade_only: boolean }>(
    `select s.id, s.evolves_from_species_id as from_id, fs.identifier as from_name,
            bool_and(coalesce(et.identifier, '') = 'trade') as trade_only
     from ${q('pokemon_species')} s
     join ${q('pokemon_species')} fs on fs.id = s.evolves_from_species_id
     left join ${q('pokemon_evolution')} pe on pe.evolved_species_id = s.id
     left join ${q('evolution_triggers')} et on et.id = pe.evolution_trigger_id
     group by s.id, s.evolves_from_species_id, fs.identifier`,
  );
  const evolveFromByDex = new Map<number, EvolveFrom>();
  for (const row of evolutions.rows) {
    const name = row.from_name.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
    evolveFromByDex.set(Number(row.id), { dex: Number(row.from_id), name, trade: row.trade_only });
  }

  const sourcesByDex = new Map<number, ObtainSource[]>();
  const push = (dex: number, source: ObtainSource) => {
    const arr = sourcesByDex.get(dex);
    if (arr) arr.push(source);
    else sourcesByDex.set(dex, [source]);
  };
  for (const row of membership.rows) {
    const gameId = VERSION_GROUP_TO_GAME[row.version_group];
    if (!gameId) continue;
    const dex = Number(row.species_id);
    // Dex membership isn't obtainability for event-only listings (Jirachi is in
    // the Hoenn dex but was never catchable in gen 3) — drop the curated
    // exceptions; real routes come back via STATIC_AVAILABILITY.
    if (AVAILABILITY_EXCLUSIONS[dex]?.includes(gameId)) continue;
    const key = `${dex}:${gameId}`;
    const locations = locsByKey.get(key) ?? supByKey.get(key);
    push(dex, { gameId, method: row.wild ? 'wild' : 'available', ...(locations ? { locations } : {}) });
  }
  // Curated static/gift as a supplement, for the rare mon a regional dex omits.
  for (const [dexStr, entries] of Object.entries(STATIC_AVAILABILITY)) {
    for (const e of entries) push(Number(dexStr), { gameId: e.gameId, method: e.method });
  }
  for (const [dexStr, gameIds] of Object.entries(STARTER_GIFTS)) {
    for (const gameId of gameIds) push(Number(dexStr), { gameId, method: 'gift' });
  }

  const out = new Map<number, Obtainability>();
  for (const m of meta.rows) {
    const dex = Number(m.id);
    out.set(dex, computeObtainabilityFromSources({
      dex,
      generation: Number(m.generation_id),
      hasGenderDifferences: m.has_gender_differences === '1',
      hasGmaxVariety: m.has_gmax,
      sources: sourcesByDex.get(dex) ?? [],
      evolveFrom: evolveFromByDex.get(dex) ?? null,
    }));
  }
  return out;
}
