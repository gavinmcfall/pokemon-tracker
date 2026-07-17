/**
 * E2E harness: serves web/public statics and the real Hono API on one origin,
 * backed by MemoryStore with a small deterministic catalogue — the same
 * app/store wiring as production minus nginx and Postgres.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { SpriteMirror } from '../src/sprites.js';
import type { Entry } from '../src/types.js';
import { CONTRACT_ENTRIES } from '../test/fixtures/entries.js';

// Gen IV additions for the gender-preference specs (a new generation, so the
// Gen I/VI counts the other specs assert stay untouched): Turtwig is a
// dual-gender pair with NO visual difference (collapses under "Distinct only"),
// Hippopotas a pair WITH one (genderVisualDiff via obtainability below).
const GENDER_FIXTURES: Entry[] = [
  { entryKey: '0387-default-male', dex: 387, name: 'Turtwig', formSlug: 'default', formLabel: null, gender: 'male', types: ['grass'], generation: 4, spriteUrl: 'https://sprites.example/387.png', isCosmetic: false },
  { entryKey: '0387-default-female', dex: 387, name: 'Turtwig', formSlug: 'default', formLabel: null, gender: 'female', types: ['grass'], generation: 4, spriteUrl: 'https://sprites.example/387.png', isCosmetic: false },
  { entryKey: '0449-default-male', dex: 449, name: 'Hippopotas', formSlug: 'default', formLabel: null, gender: 'male', types: ['ground'], generation: 4, spriteUrl: 'https://sprites.example/449.png', isCosmetic: false },
  { entryKey: '0449-default-female', dex: 449, name: 'Hippopotas', formSlug: 'default', formLabel: null, gender: 'female', types: ['ground'], generation: 4, spriteUrl: 'https://sprites.example/449-f.png', isCosmetic: false },
];

const port = Number.parseInt(process.env.E2E_PORT ?? '8199', 10);

const store = new MemoryStore();

// Sprite mirror wired with a fake fetch (a 1x1 PNG) so the mirror button can be
// exercised end-to-end without hitting the network.
const PNG_1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);
const spriteDir = await mkdtemp(path.join(tmpdir(), 'e2e-sprites-'));
const sprites = new SpriteMirror({
  dir: spriteDir,
  fetchImpl: (async () => new Response(PNG_1x1, { status: 200 })) as typeof fetch,
});
await sprites.init();

async function resetState(): Promise<void> {
  await store.reset();
  await store.upsertEntries([...CONTRACT_ENTRIES, ...GENDER_FIXTURES]);
  await store.setStatus({ entryKey: '0666-fancy-female', caught: true, gameOrigin: 'emu:Violet' });
  // HOME-derived specimen on the one caught entry, so badges + the detail-sheet
  // Best Specimen zone can be exercised end to end.
  await store.replaceSpecimens([
    {
      entryKey: '0666-fancy-female', shiny: true, event: true, level: 100, originGame: 'sv',
      metYear: 2023, ivPerfect: 6, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      tera: 'fairy', ball: 'Cherish Ball', nature: 'Modest', ability: 'Shield Dust',
      ribbons: ['Classic'], nickname: 'Papillon', ot: 'Serina',
    },
  ]);
  // Catalogue-derived obtainability (what the seed computes in production), so
  // the Obtainability filters + detail-sheet zone can be exercised end to end.
  const ob = (over: Record<string, unknown>) => ({
    availability: [], gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false,
    shinyLegalSomewhere: true, unobtainableLegit: false, genderVisualDiff: false,
    shinyLockedIn: [], originGames: [], ...over,
  });
  await store.replaceObtainability([
    { entryKey: '0006-default-male', obtainability: ob({
      availability: [{ gameId: 'lgpe', label: "Let's Go", platform: 'switch', method: 'wild', shinyPossible: true }],
      gmaxCapable: true, catchableOnSwitch: true, originGames: ['rb', 'yellow'],
    }) },
    { entryKey: '0006-mega_x-male', obtainability: ob({
      availability: [{ gameId: 'rb', label: 'Red/Blue', platform: 'gb', method: 'evolve', shinyPossible: true }],
      gmaxCapable: true, originGames: ['rb', 'yellow'],
    }) },
    { entryKey: '0666-fancy-female', obtainability: ob({
      availability: [{ gameId: 'sv', label: 'Scarlet/Violet', platform: 'switch', method: 'wild', shinyPossible: true }],
      teraAvailable: true, catchableOnSwitch: true, originGames: ['xy', 'oras'],
    }) },
    // Hippopotas ♂/♀ are visually distinct — both slots survive "Distinct only".
    { entryKey: '0449-default-male', obtainability: ob({ genderVisualDiff: true }) },
    { entryKey: '0449-default-female', obtainability: ob({ genderVisualDiff: true }) },
  ]);
}
await resetState();

const app = createApp(store, { sprites });
// Test-only hook so every spec starts from the same state.
app.post('/e2e/reset', async (c) => {
  await resetState();
  return c.json({ ok: true });
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void rm(spriteDir, { recursive: true, force: true }).finally(() => process.exit(0)); });
}
app.use('*', serveStatic({ root: 'web/public' }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`e2e harness on http://127.0.0.1:${info.port}`);
});
