import { Hono } from 'hono';
import type { Store } from './store/store.js';
import type { EntryFilters, EntryWithStatus, GameOwnership, GameWithOwnership, SpecimenInput, StatusPatch } from './types.js';
import { applicableMethods, parseOwnershipMethods } from './types.js';
import { RELEASES, RELEASE_BY_ID } from './obtainability/games.js';
import { TRANSFER_BY_GAME } from './obtainability/transfer.js';
import { computePlan, computeAcquisitionPlan, hasBankFrom, ownedRouteGroups, ACQUIRE_MODES, ACQUIRE_RANKS, type AcquireMode, type AcquireRank } from './planner/compute.js';
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

    const dryRun = ['1', 'true', 'yes'].includes((c.req.query('dryRun') ?? '').toLowerCase());
    const entries = await store.listEntries({});
    const plan = planImport(text, entries);

    // dryRun: resolve + report only, no writes. Returns the exact set of slots
    // whose state would change, so a recurring importer can detect a real delta
    // (and skip the write when there's nothing to do).
    if (dryRun) {
      const byKey = new Map(entries.map((e) => [e.entryKey, e]));
      const changes = [];
      for (const patch of plan.patches) {
        const cur = byKey.get(patch.entryKey)?.status ?? null;
        const before = cur?.caught ?? false;
        const metaChanged =
          (patch.gameOrigin !== undefined && patch.gameOrigin !== (cur?.gameOrigin ?? undefined)) ||
          (patch.method !== undefined && patch.method !== (cur?.method ?? undefined)) ||
          (patch.notes !== undefined && patch.notes !== (cur?.notes ?? undefined));
        if (before !== patch.caught || metaChanged) {
          changes.push({ entryKey: patch.entryKey, caught: { from: before, to: patch.caught }, metaChanged });
        }
      }
      return c.json({
        dryRun: true,
        matched: plan.matchedRows,
        wouldUpdate: plan.patches.length,
        changed: changes.length,
        changes,
        unmatched: plan.unmatched,
      });
    }

    let updated = 0;
    for (const patch of plan.patches) {
      const { line, ...statusPatch } = patch;
      const res = await store.setStatus(statusPatch);
      if (res !== null) updated += 1;
    }
    return c.json({ dryRun: false, matched: plan.matchedRows, updated, unmatched: plan.unmatched });
  });

  // Full-sync the HOME-derived specimen set. Accepts either a bare array or
  // { specimens: [...] }. Replaces the whole set (source regenerates each run);
  // entryKeys not in the catalogue are reported, never fatal.
  app.post('/api/specimens', async (c) => {
    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return badRequest('body must be JSON (an array of specimens or { specimens: [...] })');
    }
    const raw = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { specimens?: unknown }).specimens)
          ? (parsed as { specimens: unknown[] }).specimens
          : null);
    if (raw === null) return badRequest('expected an array of specimens or { specimens: [...] }');

    const inputs: SpecimenInput[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') return badRequest('each specimen must be an object');
      const key = (item as { entryKey?: unknown }).entryKey;
      if (typeof key !== 'string' || key === '') return badRequest('each specimen needs a string entryKey');
      inputs.push(item as SpecimenInput);
    }

    const result = await store.replaceSpecimens(inputs);
    return c.json({ synced: result.upserted, unmatched: result.unmatched });
  });

  // ---- Game ownership -------------------------------------------------------
  // The individual-release catalogue (Red and Blue are separate cartridges)
  // merged with the owner's ownership. One call gives the front-end everything
  // for the "My Games" screen and the "in a game you own" obtainability signal
  // (via each release's versionGroup).
  app.get('/api/games', async (c) => {
    const owned = new Map<string, GameOwnership>();
    for (const o of await store.listGameOwnership()) owned.set(o.gameId, o);
    const games: GameWithOwnership[] = RELEASES.map((r) => {
      const o = owned.get(r.releaseId);
      return {
        gameId: r.releaseId,
        label: r.label,
        platform: r.platform,
        generation: r.generation,
        versionGroup: r.versionGroup,
        applicableMethods: applicableMethods(r.platform),
        owned: Boolean(o && o.methods.length > 0),
        methods: o?.methods ?? [],
        notes: o?.notes ?? null,
      };
    });
    return c.json(games);
  });

  // Upsert one game's ownership. Body: { gameId, methods: [...], notes? }.
  // gameId is a release slug (e.g. 'red'). Empty methods + no notes clears it.
  app.post('/api/ownership', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return badRequest('body must be JSON');
    }
    if (typeof body !== 'object' || body === null) return badRequest('body must be an object');
    const b = body as Record<string, unknown>;
    if (typeof b.gameId !== 'string' || b.gameId === '') return badRequest('gameId is required');
    const release = RELEASE_BY_ID.get(b.gameId);
    if (!release) return c.json({ error: `unknown gameId "${b.gameId}"` }, 404);

    const methods = parseOwnershipMethods(b.methods ?? []);
    if ('error' in methods) return badRequest(methods.error);
    // Reject methods that don't apply to this game's platform (e.g. a cartridge
    // for Pokémon GO, or `digital` for a Switch title).
    const allowed = applicableMethods(release.platform);
    const bad = methods.find((m) => !allowed.includes(m));
    if (bad) return badRequest(`method "${bad}" does not apply to ${release.label} (${release.platform})`);

    const notes = textField(b.notes, 'notes');
    if (typeof notes === 'object' && notes !== null) return badRequest(notes.error);

    const result = await store.setGameOwnership({
      gameId: b.gameId,
      methods,
      notes: notes === undefined ? null : notes,
    });
    return c.json(result);
  });

  // Transfer topology: how each game's catches reach Pokémon HOME (native /
  // via Bank / via the Gen 3→4→5 chain / GO). Static per game-group, keyed by
  // the same gameId as obtainability availability. Powers the detail sheet's
  // "to HOME" route line and (later) the living-dex planner.
  app.get('/api/transfer', (c) => c.json(TRANSFER_BY_GAME));

  // Living-dex planner: per-species verdict (have / ready / need-game / unknown /
  // event-only) given the games you own + Bank status, plus a ranked buy-list of
  // the acquisitions that unlock the most. Recomputed on demand from the store.
  app.get('/api/plan', async (c) => {
    const [entries, ownership] = await Promise.all([store.listEntries({}), store.listGameOwnership()]);
    const plan = computePlan({
      entries,
      ownedRouteGroups: ownedRouteGroups(ownership),
      hasBank: hasBankFrom(ownership),
    });
    return c.json(plan);
  });

  // Acquisition planner: the ordered shopping list of games/services to acquire
  // so every missing, routable species can reach HOME. Tuned by ?mode= (how you
  // acquire games) and ?rank= (how to order the list).
  app.get('/api/acquire', async (c) => {
    const mode = (c.req.query('mode') ?? 'emu-first') as AcquireMode;
    const rank = (c.req.query('rank') ?? 'fewest-games') as AcquireRank;
    if (!ACQUIRE_MODES.includes(mode)) return badRequest(`invalid mode "${mode}" — expected ${ACQUIRE_MODES.join(' | ')}`);
    if (!ACQUIRE_RANKS.includes(rank)) return badRequest(`invalid rank "${rank}" — expected ${ACQUIRE_RANKS.join(' | ')}`);
    const [entries, ownership] = await Promise.all([store.listEntries({}), store.listGameOwnership()]);
    return c.json(computeAcquisitionPlan({ entries, ownership, mode, rank }));
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
    const bytes = await sprites.readBytes(c.req.param('key'));
    if (!bytes) return c.json({ error: 'not mirrored' }, 404);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  return app;
}
