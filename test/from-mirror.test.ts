import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { loadCsv } from '../src/mirror/load.js';
import { obtainabilityFromMirror, obtainabilityWithFormsFromMirror } from '../src/obtainability/from-mirror.js';
import type { Obtainability } from '../src/types.js';
import { runSupplement } from '../src/supplement/run.js';

const url = process.env.TEST_DATABASE_URL;

// A tiny hand-built mirror covering two species:
//  - Charizard (6): in the X/Y and Sword/Shield dexes, no wild encounter (evolved),
//    has a -gmax form.
//  - Zacian (888): in the Sword/Shield dex, wild-encounterable there, shiny-locked
//    in swsh (per curated STATIC_SHINY_LOCK).
const FIXTURE: Record<string, string> = {
  version_groups: 'id,identifier\n15,x-y\n20,sword-shield\n25,scarlet-violet\n',
  versions: 'id,version_group_id,identifier\n24,15,x\n31,20,sword\n',
  pokedexes: 'id,region_id,identifier,is_main_series\n12,6,kalos-central,1\n27,8,galar,1\n31,10,paldea,1\n1,,national,1\n',
  pokedex_version_groups: 'pokedex_id,version_group_id\n12,15\n27,20\n31,25\n',
  pokemon_dex_numbers: 'species_id,pokedex_id,pokedex_number\n6,12,6\n6,27,384\n6,31,999\n888,27,138\n6,1,6\n888,1,888\n893,27,999\n',
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
      expect(charizard.teraAvailable).toBe(true);               // in the fixture's Paldea dex
      expect(Object.fromEntries(charizard.availability.map((a) => [a.gameId, a.method]))).toEqual({
        xy: 'available', swsh: 'available', sv: 'available',    // in the dex, not wild-encounterable
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

  it('marks version exclusives and classifies gift encounters', async () => {
    // Red/Blue: Ekans (23) wild only in Red, Arbok (24) evolves from it with no
    // wild rows, Pidgey (16) wild in both, Bulbasaur (1) a gift in both.
    const fx: Record<string, string> = {
      version_groups: 'id,identifier\n1,red-blue\n',
      versions: 'id,version_group_id,identifier\n1,1,red\n2,1,blue\n',
      pokedexes: 'id,region_id,identifier,is_main_series\n2,1,kanto,1\n',
      pokedex_version_groups: 'pokedex_id,version_group_id\n2,1\n',
      pokemon_dex_numbers: 'species_id,pokedex_id,pokedex_number\n1,2,1\n16,2,16\n23,2,23\n24,2,24\n',
      pokemon_species:
        'id,identifier,generation_id,has_gender_differences,evolves_from_species_id\n' +
        '1,bulbasaur,1,0,\n16,pidgey,1,0,\n23,ekans,1,0,\n24,arbok,1,0,23\n',
      pokemon: 'id,species_id,identifier\n1,1,bulbasaur\n16,16,pidgey\n23,23,ekans\n24,24,arbok\n',
      pokemon_forms: 'id,pokemon_id,identifier\n1,1,bulbasaur\n16,16,pidgey\n23,23,ekans\n24,24,arbok\n',
      encounters:
        'id,version_id,location_area_id,encounter_slot_id,pokemon_id\n' +
        '1,1,10,20,23\n2,1,10,20,16\n3,2,10,20,16\n4,1,11,21,1\n5,2,11,21,1\n',
      location_areas: 'id,location_id,identifier\n10,30,kanto-route-4-area\n11,31,pallet-town-area\n',
      locations: 'id,region_id,identifier\n30,1,kanto-route-4\n31,1,kanto-pallet-town\n',
      encounter_slots: 'id,version_group_id,encounter_method_id,slot,rarity\n20,1,1,1,50\n21,1,18,1,100\n',
      encounter_methods: 'id,identifier\n1,walk\n18,gift\n',
      pokemon_evolution: 'id,evolved_species_id,evolution_trigger_id\n1,24,1\n',
      evolution_triggers: 'id,identifier\n1,level-up\n',
    };
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('drop schema if exists pokeapi_vx cascade');
      await client.query('create schema pokeapi_vx');
      for (const [table, csv] of Object.entries(fx)) await loadCsv(client, 'pokeapi_vx', table, csv);

      const byDex = await obtainabilityFromMirror(client, 'pokeapi_vx');
      const rb = (dex: number) => byDex.get(dex)!.availability.find((a) => a.gameId === 'rb')!;
      expect(rb(23).versions).toEqual(['red']);
      expect(rb(24).versions).toEqual(['red']); // inherited from Ekans
      expect(rb(16).versions).toBeUndefined();  // both cartridges
      // A gift encounter is a gift, not "wild — Pallet Town (gift)".
      expect(rb(1)).toMatchObject({ method: 'gift', locations: ['Pallet Town'] });
      expect(rb(16)).toMatchObject({ method: 'wild', locations: ['Route 4'] });
    } finally {
      await client.query('drop schema if exists pokeapi_vx cascade').catch(() => {});
      await client.end();
    }
  });

  it('gives regional forms their own games, rows and exclusives', async () => {
    // Vulpix (37) wild in Red; Alolan Vulpix (10103, introduced in Sun/Moon)
    // wild only in Sun. Pidgey's Moon row just proves Moon has encounter data.
    const fx: Record<string, string> = {
      version_groups: 'id,identifier\n1,red-blue\n17,sun-moon\n',
      versions: 'id,version_group_id,identifier\n1,1,red\n2,1,blue\n27,17,sun\n28,17,moon\n',
      pokedexes: 'id,region_id,identifier,is_main_series\n2,1,kanto,1\n16,7,original-alola,1\n',
      pokedex_version_groups: 'pokedex_id,version_group_id\n2,1\n16,17\n',
      pokemon_dex_numbers: 'species_id,pokedex_id,pokedex_number\n37,2,37\n37,16,40\n',
      pokemon_species:
        'id,identifier,generation_id,has_gender_differences,evolves_from_species_id\n' +
        '37,vulpix,1,0,\n16,pidgey,1,0,\n',
      pokemon: 'id,species_id,identifier,is_default\n37,37,vulpix,1\n10103,37,vulpix-alola,0\n16,16,pidgey,1\n',
      pokemon_forms:
        'id,pokemon_id,identifier,is_default,introduced_in_version_group_id\n' +
        '37,37,vulpix,1,1\n10123,10103,vulpix-alola,1,17\n16,16,pidgey,1,1\n',
      encounters:
        'id,version_id,location_area_id,encounter_slot_id,pokemon_id\n' +
        '1,1,10,20,37\n2,2,10,20,37\n3,27,11,21,10103\n4,28,11,21,16\n',
      location_areas: 'id,location_id,identifier\n10,30,kanto-route-7-area\n11,31,alola-route-14-area\n',
      locations: 'id,region_id,identifier\n30,1,kanto-route-7\n31,7,alola-route-14\n',
      encounter_slots: 'id,version_group_id,encounter_method_id,slot,rarity\n20,1,1,1,50\n21,17,1,1,50\n',
      encounter_methods: 'id,identifier\n1,walk\n',
      pokemon_evolution: 'id,evolved_species_id,evolution_trigger_id\n',
      evolution_triggers: 'id,identifier\n1,level-up\n',
    };
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('drop schema if exists pokeapi_rf cascade');
      await client.query('create schema pokeapi_rf');
      for (const [table, csv] of Object.entries(fx)) await loadCsv(client, 'pokeapi_rf', table, csv);

      const { byDex, byForm } = await obtainabilityWithFormsFromMirror(client, 'pokeapi_rf');
      const games = (ob: Obtainability | undefined) => Object.fromEntries((ob?.availability ?? []).map((a) => [a.gameId, a]));

      const alolan = games(byForm.get('37:alola'));
      expect(alolan.rb).toBeUndefined(); // introduced in Sun/Moon
      expect(alolan.sm).toMatchObject({ method: 'wild', versions: ['sun'], locations: ['Route 14'] });

      const kanto = games(byForm.get('37:default'));
      expect(kanto.rb).toMatchObject({ method: 'wild', locations: ['Route 7'] });
      expect(kanto.sm).toMatchObject({ method: 'available' }); // the Alolan form's rows aren't its own
      expect(kanto.sm?.locations).toBeUndefined();

      // Species-level record is unchanged (other forms fall back to it).
      expect(games(byDex.get(37)).sm).toMatchObject({ method: 'wild' });
    } finally {
      await client.query('drop schema if exists pokeapi_rf cascade').catch(() => {});
      await client.end();
    }
  });

  it('uses the curated table for regional forms in species-level games', async () => {
    // Growlithe (58) in the Hisui dex, Vulpix (37) in the Blueberry dex. No
    // encounter rows: these games only have dex membership in the mirror.
    const fx: Record<string, string> = {
      version_groups: 'id,identifier\n24,legends-arceus\n25,scarlet-violet\n27,the-indigo-disk\n',
      versions: 'id,version_group_id,identifier\n39,24,legends-arceus\n40,25,scarlet\n41,25,violet\n',
      pokedexes: 'id,region_id,identifier,is_main_series\n30,9,hisui,1\n33,10,blueberry,1\n',
      pokedex_version_groups: 'pokedex_id,version_group_id\n30,24\n33,27\n',
      pokemon_dex_numbers: 'species_id,pokedex_id,pokedex_number\n58,30,57\n37,33,157\n',
      pokemon_species:
        'id,identifier,generation_id,has_gender_differences,evolves_from_species_id\n' +
        '58,growlithe,1,0,\n37,vulpix,1,0,\n',
      pokemon:
        'id,species_id,identifier,is_default\n58,58,growlithe,1\n10229,58,growlithe-hisui,0\n' +
        '37,37,vulpix,1\n10103,37,vulpix-alola,0\n',
      pokemon_forms:
        'id,pokemon_id,identifier,is_default,introduced_in_version_group_id\n' +
        '58,58,growlithe,1,\n10229,10229,growlithe-hisui,1,24\n37,37,vulpix,1,\n10123,10103,vulpix-alola,1,\n',
      encounters: 'id,version_id,location_area_id,encounter_slot_id,pokemon_id\n',
      location_areas: 'id,location_id,identifier\n',
      locations: 'id,region_id,identifier\n',
      encounter_slots: 'id,version_group_id,encounter_method_id,slot,rarity\n',
      encounter_methods: 'id,identifier\n1,walk\n',
      pokemon_evolution: 'id,evolved_species_id,evolution_trigger_id\n',
      evolution_triggers: 'id,identifier\n1,level-up\n',
    };
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('drop schema if exists pokeapi_cf cascade');
      await client.query('create schema pokeapi_cf');
      for (const [table, csv] of Object.entries(fx)) await loadCsv(client, 'pokeapi_cf', table, csv);

      const { byDex, byForm } = await obtainabilityWithFormsFromMirror(client, 'pokeapi_cf');
      const games = (ob: Obtainability | undefined) => Object.fromEntries((ob?.availability ?? []).map((a) => [a.gameId, a]));

      expect(games(byForm.get('58:hisui')).pla).toBeDefined();
      expect(games(byForm.get('58:default')).pla).toBeUndefined(); // Hisui has only the Hisuian form
      expect(games(byDex.get(58)).pla).toBeDefined();              // species-level unchanged

      expect(games(byForm.get('37:alola')).sv).toMatchObject({
        method: 'wild', versions: ['scarlet'], locations: ['Polar Biome (Terarium)'],
      });
      expect(games(byForm.get('37:default')).sv).toBeDefined();
    } finally {
      await client.query('drop schema if exists pokeapi_cf cascade').catch(() => {});
      await client.end();
    }
  });

  it('serebii supplement fills modern-game locations (gap-fill only, membership-gated)', async () => {
    const serebiiHtml = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'serebii', 'bulbasaur-locations.html'),
      'utf8',
    );
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    const client = await pool.connect();
    try {
      await client.query('drop schema if exists pokeapi_fx cascade');
      await client.query('drop schema if exists supplement cascade');
      await client.query('create schema pokeapi_fx');
      for (const [table, csv] of Object.entries(FIXTURE)) await loadCsv(client, 'pokeapi_fx', table, csv);

      // The fixture's only SV-era species is Charizard; the fake fetch serves
      // it the real captured Serebii page (SV DLC rows + Z-A rows).
      const fetched: string[] = [];
      const fake = (async (input: string | URL | Request) => {
        fetched.push(String(input));
        return new Response(serebiiHtml, { status: 200 });
      }) as typeof fetch;

      const stats = await runSupplement(pool, { fetchImpl: fake, mirrorSchema: 'pokeapi_fx', delayMs: 1 });
      expect(fetched).toEqual(['https://www.serebii.net/pokedex-sv/charizard/']);
      expect(stats).toMatchObject({ fetched: 1, updated: 1, unchanged: 0 });

      // Second run: page unchanged → no writes.
      const again = await runSupplement(pool, { fetchImpl: fake, mirrorSchema: 'pokeapi_fx', delayMs: 1 });
      expect(again).toMatchObject({ fetched: 1, updated: 0, unchanged: 1 });

      const byDex = await obtainabilityFromMirror(client, 'pokeapi_fx');
      const sv = byDex.get(6)!.availability.find((a) => a.gameId === 'sv')!;
      // Scarlet ∪ Violet DLC rows, deduped and capped at 3.
      expect(sv.locations).toEqual(['The Indigo Disk: Coastal Biome', 'The Indigo Disk: Torchlit Labyrinth']);
      // Z-A rows exist in the supplement but Charizard has no za dex membership
      // in this fixture — gap-fill never invents availability.
      expect(byDex.get(6)!.availability.some((a) => a.gameId === 'za')).toBe(false);
    } finally {
      await client.query('drop schema if exists pokeapi_fx cascade').catch(() => {});
      await client.query('drop schema if exists supplement cascade').catch(() => {});
      client.release();
      await pool.end();
    }
  });
});
