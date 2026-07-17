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
  pokemon_dex_numbers: 'species_id,pokedex_id,pokedex_number\n6,12,6\n6,27,384\n888,27,138\n6,1,6\n888,1,888\n893,27,999\n',
  pokemon_species:
    'id,identifier,generation_id,has_gender_differences,evolves_from_species_id\n' +
    '6,charizard,1,0,5\n5,charmeleon,1,0,4\n888,zacian,8,0,\n893,zarude,8,0,\n808,meltan,7,0,\n' +
    '64,kadabra,1,0,63\n65,alakazam,1,0,64\n',
  pokemon: 'id,species_id,identifier\n6,6,charizard\n888,888,zacian\n893,893,zarude\n808,808,meltan\n',
  pokemon_forms: 'id,pokemon_id,identifier\n6,6,charizard\n9999,6,charizard-gmax\n888,888,zacian\n893,893,zarude\n808,808,meltan\n',
  // Zacian wild in Sword at the Slumbering Weald (walk) + Gloomy Glade (surf).
  encounters: 'id,version_id,location_area_id,encounter_slot_id,pokemon_id\n1,31,700,900,888\n2,31,701,901,888\n',
  location_areas: 'id,location_id,identifier\n700,800,slumbering-weald-area\n701,801,gloomy-glade-area\n',
  locations: 'id,region_id,identifier\n800,8,galar-slumbering-weald\n801,8,gloomy-glade\n',
  encounter_slots: 'id,version_group_id,encounter_method_id,slot,rarity\n900,20,1,1,50\n901,20,5,1,10\n',
  encounter_methods: 'id,identifier\n1,walk\n5,surf\n',
  // Charizard ← Charmeleon by level-up; Alakazam ← Kadabra by trade only.
  pokemon_evolution: 'id,evolved_species_id,evolution_trigger_id\n1,6,1\n2,65,2\n',
  evolution_triggers: 'id,identifier\n1,level-up\n2,trade\n',
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
        {
          gameId: 'swsh', label: 'Sword/Shield', platform: 'switch', method: 'wild', shinyPossible: false,
          locations: ['Slumbering Weald', 'Gloomy Glade (surf)'], // ordered by raw identifier
        },
      ]);
      expect(zacian.shinyLockedIn).toEqual(['swsh']);           // curated shiny-lock
      expect(zacian.catchableOnSwitch).toBe(true);

      // Evolution "how" hints: level-up line vs a trade-only evolution.
      expect(charizard.evolveFrom).toEqual({ dex: 5, name: 'Charmeleon', trade: false });
      expect(byDex.get(65)!.evolveFrom).toEqual({ dex: 64, name: 'Kadabra', trade: true });
      expect(zacian.evolveFrom).toBeNull();

      // Zarude is in the Galar dex but was event-only there: the curated
      // exclusion drops the listing and the species renders event-only.
      const zarude = byDex.get(893)!;
      expect(zarude.availability).toEqual([]);
      expect(zarude.unobtainableLegit).toBe(true);

      // Meltan: dex-listed nowhere here, but curated GO availability applies.
      const meltan = byDex.get(808)!;
      expect(meltan.availability).toEqual([
        { gameId: 'go', label: 'Pokémon GO', platform: 'mobile', method: 'static', shinyPossible: true },
      ]);
    } finally {
      await client.query('drop schema if exists pokeapi_fx cascade').catch(() => {});
      await client.end();
    }
  });
});
