import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SpriteMirror, spriteKeyFromUrl } from '../src/sprites.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'sprites-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('spriteKeyFromUrl', () => {
  it('takes the basename of remote sprite URLs', () => {
    expect(spriteKeyFromUrl('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png')).toBe('6.png');
    expect(spriteKeyFromUrl('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/666-fancy.png')).toBe('666-fancy.png');
    expect(spriteKeyFromUrl('https://x/10034.png')).toBe('10034.png');
  });
  it('rejects path traversal and unsafe names', () => {
    expect(spriteKeyFromUrl('https://x/../../etc/passwd')).toBe('passwd'); // basename only, no slashes survive
    expect(spriteKeyFromUrl('https://x/a%2Fb.png')).toBe(null); // decodes to a/b → unsafe
    expect(spriteKeyFromUrl('')).toBe(null);
  });
});

function fakeFetch(handler: (url: string) => Response): { fetch: typeof fetch; calls: () => string[] } {
  const calls: string[] = [];
  return {
    calls: () => calls,
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      calls.push(url);
      return handler(url);
    }) as typeof fetch,
  };
}

const png = (byte: number) => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, byte]), { status: 200 });

describe('SpriteMirror', () => {
  it('mirrors missing sprites, is idempotent, and rewrites URLs once present', async () => {
    const dir = await tempDir();
    const stub = fakeFetch(() => png(1));
    const m = new SpriteMirror({ dir, fetchImpl: stub.fetch });
    await m.init();

    const urls = ['https://x/1.png', 'https://x/2.png', 'https://x/1.png']; // dup collapses
    expect(m.rewrite('https://x/1.png')).toBe('https://x/1.png'); // not yet mirrored

    const p = await m.run(urls);
    expect(p).toMatchObject({ enabled: true, running: false, total: 2, fetched: 2, failed: 0 });
    expect(m.rewrite('https://x/1.png')).toBe('/api/sprites/1.png');
    expect((await readdir(dir)).sort()).toEqual(['1.png', '2.png']);
    expect(stub.calls()).toHaveLength(2);

    // re-run only fetches gaps (none) — no new network calls
    await m.run([...urls, 'https://x/3.png']);
    expect(stub.calls().filter((u) => u.endsWith('3.png'))).toHaveLength(1);
    expect(m.progress().mirrored).toBe(3);
  });

  it('a fresh instance indexes already-mirrored files at init', async () => {
    const dir = await tempDir();
    const stub = fakeFetch(() => png(9));
    await new SpriteMirror({ dir, fetchImpl: stub.fetch }).run(['https://x/7.png']).catch(() => {});
    // note: run() without init() still writes; a new instance should see it after init
    const fresh = new SpriteMirror({ dir, fetchImpl: stub.fetch });
    await fresh.init();
    expect(fresh.has('7.png')).toBe(true);
    expect(fresh.rewrite('https://x/7.png')).toBe('/api/sprites/7.png');
  });

  it('records failures without aborting the whole run', async () => {
    const dir = await tempDir();
    const stub = fakeFetch((url) => (url.endsWith('bad.png') ? new Response('nope', { status: 404 }) : png(2)));
    const m = new SpriteMirror({ dir, fetchImpl: stub.fetch });
    await m.init();
    const p = await m.run(['https://x/ok.png', 'https://x/bad.png']);
    expect(p.fetched).toBe(1);
    expect(p.failed).toBe(1);
    expect(p.lastError).toContain('bad.png');
    expect(m.has('ok.png')).toBe(true);
    expect(m.has('bad.png')).toBe(false);
  });

  it('reads mirrored files as bytes and refuses unsafe keys', async () => {
    const dir = await tempDir();
    const m = new SpriteMirror({ dir, fetchImpl: fakeFetch(() => png(5)).fetch });
    await m.init();
    await m.run(['https://x/42.png']);

    const hit = await m.readBytes('42.png');
    expect(hit).not.toBeNull();
    expect(hit!.length).toBe(5);
    expect(hit![0]).toBe(0x89);
    const bytes = await readFile(path.join(dir, '42.png'));
    expect(bytes[0]).toBe(0x89);

    expect(await m.readBytes('missing.png')).toBeNull();
    expect(m.filePath('../../etc/passwd')).toBeNull();
    expect(m.filePath('a/b.png')).toBeNull();
  });

  it('does not start a second concurrent run', async () => {
    const dir = await tempDir();
    let resolve!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; });
    const stub = fakeFetch(() => png(1));
    const m = new SpriteMirror({
      dir,
      fetchImpl: (async (u: Parameters<typeof fetch>[0]) => { await gate; return stub.fetch(u); }) as typeof fetch,
    });
    await m.init();
    const first = m.run(['https://x/1.png']);
    const second = await m.run(['https://x/2.png']); // returns immediately, running
    expect(second.running).toBe(true);
    resolve();
    await first;
    expect(m.has('1.png')).toBe(true);
    expect(m.has('2.png')).toBe(false); // second call was a no-op status read
  });
});
