/**
 * E2E harness: serves web/public statics and the real Hono API on one origin,
 * backed by MemoryStore with a small deterministic catalogue — the same
 * app/store wiring as production minus nginx and Postgres.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { CONTRACT_ENTRIES } from '../test/fixtures/entries.js';

const port = Number.parseInt(process.env.E2E_PORT ?? '8199', 10);

const store = new MemoryStore();

async function resetState(): Promise<void> {
  await store.reset();
  await store.upsertEntries(CONTRACT_ENTRIES);
  await store.setStatus({ entryKey: '0666-fancy-female', caught: true, gameOrigin: 'emu:Violet' });
}
await resetState();

const app = createApp(store);
// Test-only hook so every spec starts from the same state.
app.post('/e2e/reset', async (c) => {
  await resetState();
  return c.json({ ok: true });
});
app.use('*', serveStatic({ root: 'web/public' }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`e2e harness on http://127.0.0.1:${info.port}`);
});
