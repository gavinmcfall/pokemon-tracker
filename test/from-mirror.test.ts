import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { loadCsv } from '../src/mirror/load.js';
import { obtainabilityFromMirror } from '../src/obtainability/from-mirror.js';

const url = process.env.TEST_DATABASE_URL;

// A tiny hand-built mirror covering two species:
//  - Charizard (6): in the X/Y and Sword/Shield dexes, no wild encounter (evolved),
//    has a -gmax form.
//  - Zacian (888): in the Sword/Shield dex, wild-encounterable there, shiny-locked
//    in swsh (per curated STATIC_SHINY_LOCK).
const FIXTURE: Record<string, string> = {
  version_groups: 'id,identifier\n15,x-y\n20,sword-shield\n25,scarlet-violet\n',
  versions: 'id,version_group_id,identifier\n24,15,x\n31,20,sword\n',
  pokedexes: 'id,region_id,identifier,is_main_series\n12,6,kalos-central,1\n27,8,galar,1\n1,,national,1\n',
  pokedex_version_groups: 'pokedex_id,version_group_id\n12,15\n27,20\n',
  pokemon_dex_numbers: 'species_id,pokedex_id,pokedex_number\n6,12,6\n6,27,384\n888,27,138\n6,1,6\n888,1,888\n',
  pokemon_species: 'id,generation_id,has_gender_differences\n6,1,0\n888,8,0\n',
  pokemon: 'id,species_id,identifier\n6,6,charizard\n888,888,zacian\n',
  pokemon_forms: 'id,pokemon_id,identifier\n6,6,charizard\n9999,6,charizard-gmax\n888,888,zacian\n',
  encounters: 'id,version_id,pokemon_id\n1,31,888\n',
};

(url ? describe : describe.skip)('obtainabilityFromMirror', () => {
  it('sources availability from pokédex membership + wild method + curated shiny-lock', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('drop schema if exists pokeapi_fx cascade');
      await client.query('create schema pokeapi_fx');
      for (const [table, csv] of Object.entries(FIXTURE)) await loadCsv(client, 'pokeapi_fx', table, csv);

      const byDex = await obtainabilityFromMirror(client, 'pokeapi_fx');

      const charizard = byDex.get(6)!;
      expect(charizard.gmaxCapable).toBe(true);                 // has a -gmax form
      expect(charizard.catchableOnSwitch).toBe(true);           // swsh
      expect(charizard.teraAvailable).toBe(false);              // not in SV in this fixture
      expect(Object.fromEntries(charizard.availability.map((a) => [a.gameId, a.method]))).toEqual({
        xy: 'available', swsh: 'available',                     // in the dex, not wild-encounterable
      });
      expect(charizard.availability.every((a) => a.shinyPossible)).toBe(true);

      const zacian = byDex.get(888)!;
      expect(zacian.availability).toEqual([
        { gameId: 'swsh', label: 'Sword/Shield', platform: 'switch', method: 'wild', shinyPossible: false },
      ]);
      expect(zacian.shinyLockedIn).toEqual(['swsh']);           // curated shiny-lock
      expect(zacian.catchableOnSwitch).toBe(true);
    } finally {
      await client.query('drop schema if exists pokeapi_fx cascade').catch(() => {});
      await client.end();
    }
  });
});
