import type pg from 'pg';
import type { Obtainability } from '../types.js';
import { VERSION_GROUP_TO_GAME } from './games.js';
import { computeObtainabilityFromSources, type ObtainSource } from './compute.js';
import { STARTER_GIFTS, STATIC_AVAILABILITY } from './curated.js';

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

  const sourcesByDex = new Map<number, ObtainSource[]>();
  const push = (dex: number, source: ObtainSource) => {
    const arr = sourcesByDex.get(dex);
    if (arr) arr.push(source);
    else sourcesByDex.set(dex, [source]);
  };
  for (const row of membership.rows) {
    const gameId = VERSION_GROUP_TO_GAME[row.version_group];
    if (gameId) push(Number(row.species_id), { gameId, method: row.wild ? 'wild' : 'available' });
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
    }));
  }
  return out;
}
