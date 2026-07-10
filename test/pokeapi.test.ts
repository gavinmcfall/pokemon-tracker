import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PokeApiClient, mapLimit } from '../src/seed/pokeapi.js';

function fakeFetch(handler: (url: string, call: number) => Response): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      calls += 1;
      return handler(String(input), calls);
    }) as typeof fetch,
  };
}

describe('PokeApiClient', () => {
  it('caches responses on disk so re-runs are offline-repeatable (spec §5)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pokecache-'));
    const stub = fakeFetch(() => Response.json({ id: 6, name: 'charizard' }));

    const first = new PokeApiClient({ cacheDir: dir, fetchImpl: stub.fetch });
    expect(await first.get('pokemon/charizard')).toMatchObject({ id: 6 });
    expect(stub.calls()).toBe(1);

    const offline = new PokeApiClient({
      cacheDir: dir,
      fetchImpl: (() => { throw new Error('network is down'); }) as unknown as typeof fetch,
    });
    expect(await offline.get('pokemon/charizard')).toMatchObject({ id: 6 });
    expect(offline.cacheHits).toBe(1);
  });

  it('retries 429 with backoff and honors Retry-After', async () => {
    const stub = fakeFetch((_url, call) =>
      call === 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
        : Response.json({ ok: true }),
    );
    const client = new PokeApiClient({ fetchImpl: stub.fetch });
    expect(await client.get('pokemon-species/1')).toEqual({ ok: true });
    expect(stub.calls()).toBe(2);
  });

  it('fails fast on 404 without retrying', async () => {
    const stub = fakeFetch(() => new Response('nope', { status: 404 }));
    const client = new PokeApiClient({ fetchImpl: stub.fetch });
    await expect(client.get('pokemon/missingno')).rejects.toThrow('HTTP 404');
    expect(stub.calls()).toBe(1);
  });

  it('gives up after maxAttempts on persistent 5xx', async () => {
    const stub = fakeFetch(() => new Response('boom', { status: 500 }));
    const client = new PokeApiClient({ fetchImpl: stub.fetch, maxAttempts: 2 });
    await expect(client.get('pokemon/1')).rejects.toThrow('giving up');
    expect(stub.calls()).toBe(2);
  }, 10_000);
});

describe('mapLimit', () => {
  it('preserves order and bounds concurrency', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
