import { describe, expect, it } from 'vitest';
import type { Store } from '../src/store/store.js';
import { CONTRACT_ENTRIES } from './fixtures/entries.js';

export { CONTRACT_ENTRIES };

/**
 * Behavioural contract every Store must satisfy. Run against MemoryStore and
 * PgStore so the fake used in fast tests can never drift from production.
 */
export function storeContract(name: string, makeStore: () => Promise<Store>): void {
  describe(`store contract: ${name}`, () => {
    it('upsert is idempotent and change-aware', async () => {
      const store = await makeStore();
      const first = await store.upsertEntries(CONTRACT_ENTRIES);
      expect(first).toEqual({ inserted: 4, updated: 0, unchanged: 0 });
      const again = await store.upsertEntries(CONTRACT_ENTRIES);
      expect(again).toEqual({ inserted: 0, updated: 0, unchanged: 4 });
      const changed = await store.upsertEntries([
        { ...CONTRACT_ENTRIES[0]!, spriteUrl: 'https://sprites.example/6-new.png' },
      ]);
      expect(changed).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    });

    it('lists entries in dex/form/gender order with null status by default', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      const all = await store.listEntries({});
      expect(all.map((e) => e.entryKey)).toEqual([
        '0006-default-male', '0006-mega_x-male', '0150-default-genderless', '0666-fancy-female',
      ]);
      expect(all.every((e) => e.status === null)).toBe(true);
      expect(all[1]).toMatchObject({
        dex: 6, name: 'Charizard', formSlug: 'mega_x', formLabel: 'Mega Charizard X',
        gender: 'male', types: ['fire', 'dragon'], generation: 1, isCosmetic: false,
      });
    });

    it('filters by gen, type, status and q', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      await store.setStatus({ entryKey: '0006-mega_x-male', caught: true });

      expect((await store.listEntries({ gen: 6 })).map((e) => e.entryKey)).toEqual(['0666-fancy-female']);
      expect((await store.listEntries({ type: 'dragon' })).map((e) => e.entryKey)).toEqual(['0006-mega_x-male']);
      expect((await store.listEntries({ status: 'caught' })).map((e) => e.entryKey)).toEqual(['0006-mega_x-male']);
      expect((await store.listEntries({ status: 'uncaught' })).map((e) => e.entryKey)).toEqual([
        '0006-default-male', '0150-default-genderless', '0666-fancy-female',
      ]);
      expect((await store.listEntries({ q: 'mewtwo' })).map((e) => e.entryKey)).toEqual(['0150-default-genderless']);
      expect((await store.listEntries({ q: 'Fancy' })).map((e) => e.entryKey)).toEqual(['0666-fancy-female']);
      expect((await store.listEntries({ q: '0006-mega' })).map((e) => e.entryKey)).toEqual(['0006-mega_x-male']);
      expect((await store.listEntries({ gen: 1, type: 'fire', status: 'uncaught' })).map((e) => e.entryKey)).toEqual(['0006-default-male']);
      // LIKE wildcards in q are literals, not wildcards
      expect(await store.listEntries({ q: '%' })).toEqual([]);
    });

    it('setStatus: catch sets caughtAt once, uncatch clears it, metadata is patch-style', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);

      const caught = await store.setStatus({
        entryKey: '0006-default-male', caught: true, gameOrigin: 'emu:HeartGold', method: 'caught',
      });
      expect(caught).toMatchObject({
        entryKey: '0006-default-male', caught: true, gameOrigin: 'emu:HeartGold', method: 'caught', notes: null,
      });
      expect(caught!.caughtAt).toBeTruthy();

      // re-affirming caught does not move caughtAt; omitted fields survive
      const again = await store.setStatus({ entryKey: '0006-default-male', caught: true, notes: 'box 1' });
      expect(again!.caughtAt).toBe(caught!.caughtAt);
      expect(again!.gameOrigin).toBe('emu:HeartGold');
      expect(again!.notes).toBe('box 1');

      // explicit null clears a field
      const cleared = await store.setStatus({ entryKey: '0006-default-male', caught: true, gameOrigin: null });
      expect(cleared!.gameOrigin).toBeNull();
      expect(cleared!.notes).toBe('box 1');

      const released = await store.setStatus({ entryKey: '0006-default-male', caught: false });
      expect(released!.caught).toBe(false);
      expect(released!.caughtAt).toBeNull();
      expect(released!.notes).toBe('box 1');

      // catching again gets a fresh caughtAt
      const recaught = await store.setStatus({ entryKey: '0006-default-male', caught: true });
      expect(recaught!.caughtAt).toBeTruthy();
    });

    it('setStatus returns null for unknown entry keys', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      expect(await store.setStatus({ entryKey: '9999-nope-male', caught: true })).toBeNull();
    });

    it('summary counts totals, pct and per-type (entries count under each of their types)', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      await store.setStatus({ entryKey: '0006-mega_x-male', caught: true });
      await store.setStatus({ entryKey: '0666-fancy-female', caught: true });

      const summary = await store.getSummary();
      expect(summary.caught).toBe(2);
      expect(summary.total).toBe(4);
      expect(summary.pct).toBe(50);
      expect(summary.byType).toEqual([
        { type: 'bug', caught: 1, total: 1 },
        { type: 'dragon', caught: 1, total: 1 },
        { type: 'fire', caught: 1, total: 2 },
        { type: 'flying', caught: 1, total: 2 },
        { type: 'psychic', caught: 0, total: 1 },
      ]);

      const gen1 = await store.getSummary(1);
      expect(gen1).toMatchObject({ caught: 1, total: 3 });
      expect(gen1.pct).toBeCloseTo(33.3, 1);

      const empty = await store.getSummary(9);
      expect(empty).toMatchObject({ caught: 0, total: 0, pct: 0, byType: [] });
    });

    it('status survives entry re-upsert (seed refresh keeps owner data)', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      await store.setStatus({ entryKey: '0006-default-male', caught: true, notes: 'keeper' });
      await store.upsertEntries(CONTRACT_ENTRIES.map((e) => ({ ...e, spriteUrl: `${e.spriteUrl}?v=2` })));
      const list = await store.listEntries({ status: 'caught' });
      expect(list).toHaveLength(1);
      expect(list[0]!.status).toMatchObject({ caught: true, notes: 'keeper' });
    });

    it('replaceSpecimens embeds specimens, normalizes defaults, reports unmatched', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      const res = await store.replaceSpecimens([
        {
          entryKey: '0006-mega_x-male', shiny: true, event: false, level: 100, originGame: 'swsh',
          metYear: 2020, ivPerfect: 6, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          tera: null, ball: 'Cherish Ball', nature: 'Modest', ability: 'Blaze', ribbons: ['Wishing'],
          nickname: 'Zard', ot: 'Ash',
        },
        { entryKey: '0150-default-genderless' }, // sparse → defaults
        { entryKey: '9999-nope-male', shiny: true }, // not in catalogue
      ]);
      expect(res.upserted).toBe(2);
      expect(res.unmatched).toEqual(['9999-nope-male']);

      const list = await store.listEntries({});
      const mega = list.find((e) => e.entryKey === '0006-mega_x-male')!;
      expect(mega.specimen).toMatchObject({
        shiny: true, event: false, ivPerfect: 6, originGame: 'swsh',
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ribbons: ['Wishing'], ot: 'Ash',
      });
      const mewtwo = list.find((e) => e.entryKey === '0150-default-genderless')!;
      expect(mewtwo.specimen).toMatchObject({ shiny: false, event: false, ribbons: [], ivs: null, tera: null });
      // entries without a specimen embed null
      expect(list.find((e) => e.entryKey === '0006-default-male')!.specimen).toBeNull();
    });

    it('replaceSpecimens is a full-sync: a new payload drops the previous set', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      await store.replaceSpecimens([{ entryKey: '0006-mega_x-male', shiny: true }]);
      await store.replaceSpecimens([{ entryKey: '0666-fancy-female', event: true }]);
      const list = await store.listEntries({});
      expect(list.find((e) => e.entryKey === '0006-mega_x-male')!.specimen).toBeNull();
      expect(list.find((e) => e.entryKey === '0666-fancy-female')!.specimen).toMatchObject({ event: true });
    });

    it('replaceObtainability embeds availability + flags, reports unmatched, full-syncs', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);
      const ob = {
        availability: [{ gameId: 'sv', label: 'Scarlet/Violet', platform: 'switch', method: 'wild', shinyPossible: true }],
        gmaxCapable: true, teraAvailable: true, catchableOnSwitch: true, shinyLegalSomewhere: true,
        unobtainableLegit: false, genderVisualDiff: false, shinyLockedIn: [], originGames: ['sv'],
      };
      const res = await store.replaceObtainability([
        { entryKey: '0006-default-male', obtainability: ob },
        { entryKey: '9999-nope-male', obtainability: ob },
      ]);
      expect(res.upserted).toBe(1);
      expect(res.unmatched).toEqual(['9999-nope-male']);

      let list = await store.listEntries({});
      expect(list.find((e) => e.entryKey === '0006-default-male')!.obtainability).toMatchObject({
        gmaxCapable: true, teraAvailable: true, originGames: ['sv'],
        availability: [{ gameId: 'sv', method: 'wild', shinyPossible: true }],
      });
      expect(list.find((e) => e.entryKey === '0006-mega_x-male')!.obtainability).toBeNull();

      // full-sync: a new payload drops the previous set
      await store.replaceObtainability([{ entryKey: '0150-default-genderless', obtainability: ob }]);
      list = await store.listEntries({});
      expect(list.find((e) => e.entryKey === '0006-default-male')!.obtainability).toBeNull();
      expect(list.find((e) => e.entryKey === '0150-default-genderless')!.obtainability).not.toBeNull();
    });

    it('replace* are last-write-wins on a duplicate entryKey (store parity, no throw)', async () => {
      const store = await makeStore();
      await store.upsertEntries(CONTRACT_ENTRIES);

      const spec = await store.replaceSpecimens([
        { entryKey: '0006-mega_x-male', shiny: false },
        { entryKey: '0006-mega_x-male', shiny: true },
      ]);
      expect(spec.upserted).toBe(1);
      let list = await store.listEntries({});
      expect(list.find((e) => e.entryKey === '0006-mega_x-male')!.specimen!.shiny).toBe(true);

      const ob = (gmax: boolean) => ({
        availability: [], gmaxCapable: gmax, teraAvailable: false, catchableOnSwitch: false,
        shinyLegalSomewhere: true, unobtainableLegit: false, genderVisualDiff: false,
        shinyLockedIn: [], originGames: [],
      });
      const obr = await store.replaceObtainability([
        { entryKey: '0006-default-male', obtainability: ob(false) },
        { entryKey: '0006-default-male', obtainability: ob(true) },
      ]);
      expect(obr.upserted).toBe(1);
      list = await store.listEntries({});
      expect(list.find((e) => e.entryKey === '0006-default-male')!.obtainability!.gmaxCapable).toBe(true);
    });

    it('game ownership: upsert stores methods+notes, canonical order, updatable', async () => {
      const store = await makeStore();
      expect(await store.listGameOwnership()).toEqual([]);

      const set = await store.setGameOwnership({ gameId: 'sv', methods: ['romhack', 'cartridge'], notes: 'day-one' });
      // methods come back in canonical order regardless of input order
      expect(set).toMatchObject({ gameId: 'sv', methods: ['cartridge', 'romhack'], notes: 'day-one' });
      expect(set.updatedAt).toBeTruthy();

      const list = await store.listGameOwnership();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ gameId: 'sv', methods: ['cartridge', 'romhack'], notes: 'day-one' });

      // updating replaces the method set (not merge) and can clear notes
      const updated = await store.setGameOwnership({ gameId: 'sv', methods: ['emulator'], notes: null });
      expect(updated).toMatchObject({ gameId: 'sv', methods: ['emulator'], notes: null });
      expect((await store.listGameOwnership())[0]!.methods).toEqual(['emulator']);
    });

    it('game ownership: empty methods with no notes clears the game', async () => {
      const store = await makeStore();
      await store.setGameOwnership({ gameId: 'frlg', methods: ['emulator'] });
      await store.setGameOwnership({ gameId: 'swsh', methods: ['cartridge'] });
      expect((await store.listGameOwnership()).map((o) => o.gameId)).toEqual(['frlg', 'swsh']);

      const cleared = await store.setGameOwnership({ gameId: 'frlg', methods: [] });
      expect(cleared).toMatchObject({ gameId: 'frlg', methods: [], notes: null });
      expect((await store.listGameOwnership()).map((o) => o.gameId)).toEqual(['swsh']);
    });

    it('game ownership: a note alone (no methods) is retained', async () => {
      const store = await makeStore();
      const kept = await store.setGameOwnership({ gameId: 'pla', methods: [], notes: 'borrowed from a friend' });
      expect(kept).toMatchObject({ gameId: 'pla', methods: [], notes: 'borrowed from a friend' });
      expect((await store.listGameOwnership()).map((o) => o.gameId)).toEqual(['pla']);
    });
  });
}
