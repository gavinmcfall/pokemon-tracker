import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { SpriteMirror } from '../src/sprites.js';
import { CONTRACT_ENTRIES } from './fixtures/entries.js';

/**
 * Serves sprites over the real @hono/node-server HTTP adapter (not app.request's
 * fetch mock) so the actual response-body handling is exercised — this lane
 * catches the streaming/abort crash that the in-process tests missed.
 */
describe('sprite serving over real HTTP', () => {
  let server: ServerType;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sprites-http-'));
    const store = new MemoryStore();
    await store.upsertEntries(CONTRACT_ENTRIES);
    const sprites = new SpriteMirror({
      dir,
      fetchImpl: (async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x42]), { status: 200 })) as typeof fetch,
    });
    await sprites.init();
    await sprites.run(CONTRACT_ENTRIES.map((e) => e.spriteUrl));
    const app = createApp(store, { sprites });
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('serves a mirrored sprite as image/png with the right bytes', async () => {
    const res = await fetch(`${base}/api/sprites/10034.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
  });

  it('404s a missing sprite', async () => {
    expect((await fetch(`${base}/api/sprites/nope.png`)).status).toBe(404);
  });

  it('survives clients aborting sprite requests mid-flight', async () => {
    // Fire and abort several requests; the server must not crash.
    for (let i = 0; i < 20; i++) {
      const ac = new AbortController();
      const p = fetch(`${base}/api/sprites/10034.png`, { signal: ac.signal }).catch(() => {});
      ac.abort();
      await p;
    }
    // still alive and serving
    const res = await fetch(`${base}/api/sprites/10034.png`);
    expect(res.status).toBe(200);
  });
});
