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
  });
}
