import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { SpriteMirror } from '../src/sprites.js';
import { CONTRACT_ENTRIES } from './store-contract.js';

let app: Hono;
let store: MemoryStore;

beforeEach(async () => {
  store = new MemoryStore();
  await store.upsertEntries(CONTRACT_ENTRIES);
  app = createApp(store);
});

const get = (path: string) => app.request(path);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/entries', () => {
  it('returns the spec §3 entry shape', async () => {
    const res = await get('/api/entries');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(4);
    expect(body[1]).toEqual({
      entryKey: '0006-mega_x-male',
      dex: 6,
      name: 'Charizard',
      formSlug: 'mega_x',
      formLabel: 'Mega Charizard X',
      gender: 'male',
      types: ['fire', 'dragon'],
      generation: 1,
      spriteUrl: 'https://sprites.example/10034.png',
      isCosmetic: false,
      status: null,
      specimen: null,
      obtainability: null,
    });
  });

  it('applies filters server-side', async () => {
    await store.setStatus({ entryKey: '0666-fancy-female', caught: true });
    const caught = await json(await get('/api/entries?status=caught'));
    expect(caught.map((e: { entryKey: string }) => e.entryKey)).toEqual(['0666-fancy-female']);
    const genType = await json(await get('/api/entries?gen=1&type=dragon'));
    expect(genType.map((e: { entryKey: string }) => e.entryKey)).toEqual(['0006-mega_x-male']);
    const q = await json(await get('/api/entries?q=mewtwo'));
    expect(q.map((e: { entryKey: string }) => e.entryKey)).toEqual(['0150-default-genderless']);
  });

  it('rejects malformed filters', async () => {
    expect((await get('/api/entries?gen=zero')).status).toBe(400);
    expect((await get('/api/entries?status=sometimes')).status).toBe(400);
    expect((await get('/api/entries?type=fire;drop table')).status).toBe(400);
  });
});

describe('GET /api/summary', () => {
  it('returns caught/total/pct/byType', async () => {
    await store.setStatus({ entryKey: '0006-mega_x-male', caught: true });
    const body = await json(await get('/api/summary'));
    expect(body).toMatchObject({ caught: 1, total: 4, pct: 25 });
    expect(body.byType.find((t: { type: string }) => t.type === 'dragon')).toEqual({ type: 'dragon', caught: 1, total: 1 });
  });
  it('scopes to a generation', async () => {
    const body = await json(await get('/api/summary?gen=6'));
    expect(body).toMatchObject({ caught: 0, total: 1 });
  });
});

describe('POST /api/status', () => {
  it('sets and returns the status', async () => {
    const res = await post('/api/status', {
      entryKey: '0006-default-male', caught: true, gameOrigin: 'emu:HeartGold', method: 'caught',
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      entryKey: '0006-default-male', caught: true, gameOrigin: 'emu:HeartGold', method: 'caught', notes: null,
    });
    expect(body.caughtAt).toBeTruthy();
  });

  it('404s on unknown entryKey', async () => {
    const res = await post('/api/status', { entryKey: '9999-nope-male', caught: true });
    expect(res.status).toBe(404);
  });

  it('validates the body', async () => {
    expect((await post('/api/status', { caught: true })).status).toBe(400);
    expect((await post('/api/status', { entryKey: '0006-default-male', caught: 'yes' })).status).toBe(400);
    expect((await post('/api/status', { entryKey: '0006-default-male', caught: true, notes: 42 })).status).toBe(400);
    const raw = await app.request('/api/status', { method: 'POST', body: 'not json' });
    expect(raw.status).toBe(400);
  });
});

describe('POST /api/import and GET /api/export', () => {
  it('imports a multipart CSV and reports matched/updated/unmatched', async () => {
    const csv = 'entryKey,caught\n0006-mega_x-male,true\n9999-nope-male,true\n';
    const form = new FormData();
    form.append('file', new File([csv], 'sheet.csv', { type: 'text/csv' }));
    const res = await app.request('/api/import', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.matched).toBe(1);
    expect(body.updated).toBe(1);
    expect(body.unmatched).toHaveLength(1);
    expect(body.unmatched[0]).toMatchObject({ line: 3 });

    const entries = await json(await get('/api/entries?status=caught'));
    expect(entries.map((e: { entryKey: string }) => e.entryKey)).toEqual(['0006-mega_x-male']);
  });

  it('accepts a raw text/csv body too', async () => {
    const res = await app.request('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: 'dex,caught\n150,yes\n',
    });
    const body = await json(res);
    expect(body).toMatchObject({ matched: 1, updated: 1, unmatched: [] });
  });

  it('rejects an empty import', async () => {
    const res = await app.request('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('dryRun=1 reports the would-be changes without writing', async () => {
    // 0006-mega_x-male is currently uncaught; dryRun should flag it as a change
    // but leave the store untouched.
    const csv = 'entryKey,caught\n0006-mega_x-male,true\n0006-default-male,false\n';
    const res = await app.request('/api/import?dryRun=1', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: csv,
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.dryRun).toBe(true);
    expect(body.matched).toBe(2);
    expect(body.wouldUpdate).toBe(2);
    // only the mega_x row flips state (default-male was already uncaught)
    expect(body.changed).toBe(1);
    expect(body.changes).toEqual([
      { entryKey: '0006-mega_x-male', caught: { from: false, to: true }, metaChanged: false },
    ]);
    // nothing was actually written
    const caught = await json(await get('/api/entries?status=caught'));
    expect(caught).toHaveLength(0);
  });

  it('export → import round-trips the collection', async () => {
    await store.setStatus({ entryKey: '0666-fancy-female', caught: true, gameOrigin: 'emu:Violet' });
    const exportRes = await get('/api/export');
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toContain('text/csv');
    const csv = await exportRes.text();

    // wipe and restore into a fresh store via import
    const fresh = new MemoryStore();
    await fresh.upsertEntries(CONTRACT_ENTRIES);
    const freshApp = createApp(fresh);
    const res = await freshApp.request('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: csv,
    });
    const body = await json(res);
    expect(body.unmatched).toEqual([]);
    const restored = await fresh.listEntries({ status: 'caught' });
    expect(restored.map((e) => e.entryKey)).toEqual(['0666-fancy-female']);
    expect(restored[0]!.status).toMatchObject({ gameOrigin: 'emu:Violet' });
  });
});

describe('POST /api/specimens', () => {
  it('syncs specimens, embeds them in GET /api/entries, reports unmatched', async () => {
    const res = await app.request('/api/specimens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { entryKey: '0006-mega_x-male', shiny: true, event: false, originGame: 'swsh', ivPerfect: 6,
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ribbons: ['Wishing'], ot: 'Ash' },
        { entryKey: '9999-nope-male', shiny: true },
      ]),
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ synced: 1, unmatched: ['9999-nope-male'] });

    const entries = await json(await get('/api/entries'));
    const mega = entries.find((e: { entryKey: string }) => e.entryKey === '0006-mega_x-male');
    expect(mega.specimen).toMatchObject({ shiny: true, originGame: 'swsh', ivPerfect: 6, ot: 'Ash' });
    const other = entries.find((e: { entryKey: string }) => e.entryKey === '0006-default-male');
    expect(other.specimen).toBeNull();
  });

  it('accepts a { specimens: [...] } envelope too', async () => {
    const res = await app.request('/api/specimens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specimens: [{ entryKey: '0150-default-genderless', event: true }] }),
    });
    expect(await json(res)).toEqual({ synced: 1, unmatched: [] });
  });

  it('rejects a non-array / entry without entryKey', async () => {
    expect((await app.request('/api/specimens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: 1 }),
    })).status).toBe(400);
    expect((await app.request('/api/specimens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ shiny: true }]),
    })).status).toBe(400);
  });
});

describe('game ownership', () => {
  it('GET /api/games lists individual releases (Red and Blue separate) merged with ownership', async () => {
    const games = await json(await get('/api/games'));
    // paired versions are separate rows, so the list is long
    expect(games.length).toBeGreaterThan(30);
    const ids = games.map((g: { gameId: string }) => g.gameId);
    expect(ids).toContain('red');
    expect(ids).toContain('blue');
    expect(ids).not.toContain('rb'); // the collated group is not an ownable game
    // a release carries its obtainability version-group + platform-applicable methods
    const scarlet = games.find((g: { gameId: string }) => g.gameId === 'scarlet');
    expect(scarlet).toMatchObject({ gameId: 'scarlet', label: 'Scarlet', platform: 'switch', generation: 9, versionGroup: 'sv', applicableMethods: ['cartridge', 'emulator', 'romhack'], owned: false, methods: [], notes: null });
    // Pokémon GO is mobile → only the "digital" (Playing) method applies
    const go = games.find((g: { gameId: string }) => g.gameId === 'go');
    expect(go).toMatchObject({ gameId: 'go', platform: 'mobile', applicableMethods: ['digital'] });
    // newly-added games are present
    expect(ids).toContain('legends-z-a');
    expect(ids).toContain('winds');
    expect(ids).toContain('waves');

    await post('/api/ownership', { gameId: 'scarlet', methods: ['cartridge', 'emulator'], notes: 'main copy' });
    const after = await json(await get('/api/games'));
    expect(after.find((g: { gameId: string }) => g.gameId === 'scarlet')).toMatchObject({
      owned: true, methods: ['cartridge', 'emulator'], notes: 'main copy',
    });
    // its pair stays independent
    expect(after.find((g: { gameId: string }) => g.gameId === 'violet').owned).toBe(false);
  });

  it('POST /api/ownership upserts and clears', async () => {
    const set = await json(await post('/api/ownership', { gameId: 'firered', methods: ['romhack'] }));
    expect(set).toMatchObject({ gameId: 'firered', methods: ['romhack'], notes: null });

    // clearing (empty methods, no notes) removes it from the owned list
    await post('/api/ownership', { gameId: 'firered', methods: [] });
    const games = await json(await get('/api/games'));
    expect(games.find((g: { gameId: string }) => g.gameId === 'firered').owned).toBe(false);
  });

  it('Pokémon GO uses the digital method; cartridge/emulator/romhack are rejected', async () => {
    const set = await json(await post('/api/ownership', { gameId: 'go', methods: ['digital'] }));
    expect(set).toMatchObject({ gameId: 'go', methods: ['digital'] });
    // a physical method makes no sense for a mobile game
    expect((await post('/api/ownership', { gameId: 'go', methods: ['cartridge'] })).status).toBe(400);
    // and `digital` makes no sense for a cartridge game
    expect((await post('/api/ownership', { gameId: 'scarlet', methods: ['digital'] })).status).toBe(400);
  });

  it('validates gameId and methods', async () => {
    expect((await post('/api/ownership', { methods: ['cartridge'] })).status).toBe(400);
    expect((await post('/api/ownership', { gameId: 'not-a-game', methods: ['cartridge'] })).status).toBe(404);
    expect((await post('/api/ownership', { gameId: 'rb', methods: ['cartridge'] })).status).toBe(404); // collated group is not ownable
    expect((await post('/api/ownership', { gameId: 'scarlet', methods: ['bootleg'] })).status).toBe(400);
    expect((await post('/api/ownership', { gameId: 'scarlet', methods: 'cartridge' })).status).toBe(400);
  });
});

describe('GET /api/plan', () => {
  const obFixture = (gameIds: string[]) => ({
    availability: gameIds.map((gameId) => ({ gameId, label: gameId, platform: 'switch', method: 'wild', shinyPossible: true })),
    gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false, shinyLegalSomewhere: true,
    unobtainableLegit: false, genderVisualDiff: false, shinyLockedIn: [], originGames: [],
  });

  it('computes verdicts + acquisitions from obtainability + ownership', async () => {
    await store.replaceObtainability([{ entryKey: '0006-default-male', obtainability: obFixture(['sv']) }]);

    // nothing owned → the SV species is need-game and SV tops the buy-list
    let plan = await json(await get('/api/plan'));
    const p0 = plan.species.find((s: { entryKey: string }) => s.entryKey === '0006-default-male');
    expect(p0.verdict).toBe('need-game');
    expect(p0.needs).toEqual([['sv']]);
    expect(plan.acquisitions[0]).toMatchObject({ id: 'sv', unlocks: 1 });
    expect(plan.summary.total).toBe(4);

    // own Scarlet → that species flips to ready
    await post('/api/ownership', { gameId: 'scarlet', methods: ['cartridge'] });
    plan = await json(await get('/api/plan'));
    const p1 = plan.species.find((s: { entryKey: string }) => s.entryKey === '0006-default-male');
    expect(p1).toMatchObject({ verdict: 'ready', via: 'sv' });
    expect(plan.summary.ready).toBe(1);
  });

  it('excludes romhack-only ownership from routes', async () => {
    await store.replaceObtainability([{ entryKey: '0006-default-male', obtainability: obFixture(['sv']) }]);
    await post('/api/ownership', { gameId: 'scarlet', methods: ['romhack'] });
    const plan = await json(await get('/api/plan'));
    expect(plan.species.find((s: { entryKey: string }) => s.entryKey === '0006-default-male').verdict).toBe('need-game');
  });
});

describe('GET /api/acquire', () => {
  const obFixture = (gameIds: string[]) => ({
    availability: gameIds.map((gameId) => ({ gameId, label: gameId, platform: 'switch', method: 'wild', shinyPossible: true })),
    gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false, shinyLegalSomewhere: true,
    unobtainableLegit: false, genderVisualDiff: false, shinyLockedIn: [], originGames: [],
  });

  it('returns a shopping list tuned by mode + rank', async () => {
    await store.replaceObtainability([{ entryKey: '0006-default-male', obtainability: obFixture(['sv']) }]);
    const emu = await json(await get('/api/acquire?mode=emu-first&rank=fewest-games'));
    expect(emu.steps[0]).toMatchObject({ id: 'sv', via: 'emulator', unlocks: 1 });
    expect(emu.missingTotal).toBe(4);

    const cart = await json(await get('/api/acquire?mode=cartridge-only&rank=fewest-games'));
    expect(cart.steps[0]).toMatchObject({ id: 'sv', via: 'cartridge' });
  });

  it('validates mode and rank', async () => {
    expect((await get('/api/acquire?mode=nope')).status).toBe(400);
    expect((await get('/api/acquire?rank=nope')).status).toBe(400);
  });
});

describe('GET /api/transfer', () => {
  it('returns the HOME transfer topology keyed by gameId', async () => {
    const t = await json(await get('/api/transfer'));
    expect(t.sv).toMatchObject({ gameId: 'sv', reach: 'native', directToHome: true });
    expect(t.xy).toMatchObject({ reach: 'bank', requiresBank: true });
    expect(t.e).toMatchObject({ reach: 'chain', requiresBank: true });
    expect(t.e.requiresGames).toEqual([['dp', 'pt', 'hgss'], ['bw', 'b2w2']]);
  });
});

describe('probes', () => {
  it('healthz and readyz respond ok', async () => {
    expect((await get('/healthz')).status).toBe(200);
    expect((await get('/readyz')).status).toBe(200);
  });
});

describe('sprite mirror', () => {
  it('reports disabled when no SpriteMirror is wired', async () => {
    const body = await json(await get('/api/sprites/status'));
    expect(body).toMatchObject({ enabled: false, running: false });
    expect((await post('/api/sprites/mirror', {})).status).toBe(501);
    expect((await get('/api/sprites/6.png')).status).toBe(404);
  });

  describe('when enabled', () => {
    let dir: string;
    let spriteApp: Hono;
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x42]);
    const fakeFetch = (async () => new Response(pngBytes, { status: 200 })) as typeof fetch;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'api-sprites-'));
      const sprites = new SpriteMirror({ dir, fetchImpl: fakeFetch });
      await sprites.init();
      spriteApp = createApp(store, { sprites });
    });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    const sget = (p: string) => spriteApp.request(p);

    it('mirrors on demand, rewrites entry URLs, and serves the files', async () => {
      // before mirroring, entries keep remote URLs
      const before = await json(await sget('/api/entries'));
      expect(before[0].spriteUrl).toMatch(/^https:\/\//);

      const kick = await spriteApp.request('/api/sprites/mirror', { method: 'POST' });
      expect(kick.status).toBe(202);

      // wait for the background run to finish
      for (let i = 0; i < 50; i++) {
        const st = await json(await sget('/api/sprites/status'));
        if (!st.running && st.fetched + st.failed >= st.total && st.total > 0) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      const status = await json(await sget('/api/sprites/status'));
      expect(status.enabled).toBe(true);
      expect(status.mirrored).toBeGreaterThan(0);
      expect(status.failed).toBe(0);

      // entries now point at the local mirror
      const after = await json(await sget('/api/entries'));
      const mirrored = after.find((e: { entryKey: string }) => e.entryKey === '0006-mega_x-male');
      expect(mirrored.spriteUrl).toBe('/api/sprites/10034.png');

      // and the file is served as a png
      const img = await sget('/api/sprites/10034.png');
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await img.arrayBuffer())[0]).toBe(0x89);
    });

    it('rejects unsafe sprite keys with 404', async () => {
      expect((await sget('/api/sprites/%2e%2e%2fsecret')).status).toBe(404);
      expect((await sget('/api/sprites/missing.png')).status).toBe(404);
    });
  });
});
