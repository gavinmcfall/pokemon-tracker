import { Hono } from 'hono';
import type { Store } from './store/store.js';
import type { EntryFilters, EntryWithStatus, StatusPatch } from './types.js';
import { exportCsv, planImport } from './csv.js';
import type { SpriteMirror } from './sprites.js';

export interface AppOptions {
  /** When set, sprites are mirrored locally and entry sprite URLs are rewritten. */
  sprites?: SpriteMirror;
}

const MAX_TEXT_FIELD = 2_000;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function parseFilters(query: Record<string, string | undefined>): EntryFilters | { error: string } {
  const filters: EntryFilters = {};
  if (query.gen !== undefined && query.gen !== '') {
    const gen = Number.parseInt(query.gen, 10);
    if (!Number.isInteger(gen) || gen < 1 || gen > 99) return { error: `invalid gen "${query.gen}"` };
    filters.gen = gen;
  }
  if (query.type !== undefined && query.type !== '') {
    if (!/^[a-z-]{1,32}$/i.test(query.type)) return { error: `invalid type "${query.type}"` };
    filters.type = query.type.toLowerCase();
  }
  if (query.status !== undefined && query.status !== '') {
    if (query.status !== 'caught' && query.status !== 'uncaught') {
      return { error: `invalid status "${query.status}" — expected caught | uncaught` };
    }
    filters.status = query.status;
  }
  if (query.q !== undefined && query.q !== '') {
    if (query.q.length > 200) return { error: 'q too long' };
    filters.q = query.q;
  }
  return filters;
}

/** Optional string field: absent → undefined (leave as-is), null/'' → clear. */
function textField(value: unknown, name: string): string | null | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return { error: `${name} must be a string` };
  if (value.length > MAX_TEXT_FIELD) return { error: `${name} too long (max ${MAX_TEXT_FIELD})` };
  return value;
}

export function createApp(store: Store, options: AppOptions = {}): Hono {
  const app = new Hono();
  const sprites = options.sprites;

  const withSprites = (entries: EntryWithStatus[]): EntryWithStatus[] =>
    sprites ? entries.map((e) => ({ ...e, spriteUrl: sprites.rewrite(e.spriteUrl) })) : entries;

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/readyz', async (c) => {
    try {
      await store.ready();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 503);
    }
  });

  app.get('/api/entries', async (c) => {
    const filters = parseFilters({
      gen: c.req.query('gen'),
      type: c.req.query('type'),
      status: c.req.query('status'),
      q: c.req.query('q'),
    });
    if ('error' in filters) return badRequest(filters.error);
    return c.json(withSprites(await store.listEntries(filters)));
  });

  app.get('/api/summary', async (c) => {
    const genRaw = c.req.query('gen');
    let gen: number | undefined;
    if (genRaw !== undefined && genRaw !== '') {
      gen = Number.parseInt(genRaw, 10);
      if (!Number.isInteger(gen) || gen < 1 || gen > 99) return badRequest(`invalid gen "${genRaw}"`);
    }
    return c.json(await store.getSummary(gen));
  });

  app.post('/api/status', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return badRequest('body must be JSON');
    }
    if (typeof body !== 'object' || body === null) return badRequest('body must be an object');
    const b = body as Record<string, unknown>;
    if (typeof b.entryKey !== 'string' || b.entryKey === '') return badRequest('entryKey is required');
    if (typeof b.caught !== 'boolean') return badRequest('caught must be a boolean');

    const patch: StatusPatch = { entryKey: b.entryKey, caught: b.caught };
    for (const field of ['gameOrigin', 'method', 'notes'] as const) {
      const value = textField(b[field], field);
      if (typeof value === 'object' && value !== null) return badRequest(value.error);
      if (value !== undefined) patch[field] = value;
    }

    const status = await store.setStatus(patch);
    if (status === null) return c.json({ error: `unknown entryKey "${patch.entryKey}"` }, 404);
    return c.json(status);
  });

  app.post('/api/import', async (c) => {
    let text: string | null = null;
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody();
      const file = body.file ?? body.csv;
      if (file instanceof File) {
        if (file.size > MAX_IMPORT_BYTES) return badRequest('file too large (max 5 MiB)');
        text = await file.text();
      } else if (typeof file === 'string') {
        text = file;
      }
    } else {
      text = await c.req.text();
    }
    if (!text || text.trim() === '') return badRequest('no CSV provided — send multipart field "file" or a text/csv body');
    if (text.length > MAX_IMPORT_BYTES) return badRequest('file too large (max 5 MiB)');

    const entries = await store.listEntries({});
    const plan = planImport(text, entries);

    let updated = 0;
    for (const patch of plan.patches) {
      const { line, ...statusPatch } = patch;
      const res = await store.setStatus(statusPatch);
      if (res !== null) updated += 1;
    }
    return c.json({ matched: plan.matchedRows, updated, unmatched: plan.unmatched });
  });

  app.get('/api/export', async (c) => {
    const entries = await store.listEntries({});
    return c.body(exportCsv(entries), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="livingdex-export.csv"',
    });
  });

  // ---- Sprite mirror (optional; enabled when SPRITE_DIR is set) -------------
  app.get('/api/sprites/status', (c) => {
    if (!sprites) return c.json({ enabled: false, running: false, total: 0, mirrored: 0, fetched: 0, failed: 0, startedAt: null, finishedAt: null, lastError: null });
    return c.json(sprites.progress());
  });

  app.post('/api/sprites/mirror', async (c) => {
    if (!sprites) return c.json({ error: 'sprite mirroring is not enabled (SPRITE_DIR unset)' }, 501);
    if (sprites.isRunning()) return c.json(sprites.progress(), 202);
    const entries = await store.listEntries({});
    const urls = entries.map((e) => e.spriteUrl);
    // Kick off in the background; clients poll GET /api/sprites/status.
    void sprites.run(urls);
    return c.json(sprites.progress(), 202);
  });

  app.get('/api/sprites/:key', async (c) => {
    if (!sprites) return c.json({ error: 'not enabled' }, 404);
    const file = await sprites.fileStream(c.req.param('key'));
    if (!file) return c.json({ error: 'not mirrored' }, 404);
    return c.body(file.stream as unknown as ReadableStream, 200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(file.size),
    });
  });

  return app;
}
