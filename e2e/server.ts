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
import { CONTRACT_ENTRIES } from '../test/fixtures/entries.js';

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
  await store.upsertEntries(CONTRACT_ENTRIES);
  await store.setStatus({ entryKey: '0666-fancy-female', caught: true, gameOrigin: 'emu:Violet' });
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
