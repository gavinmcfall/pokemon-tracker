import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

/**
 * Optional sprite mirror (spec §5 enhancement). When SPRITE_DIR is set, the app
 * can pull every referenced PokéAPI sprite onto a local volume and serve it from
 * /api/sprites/<key>, so the LAN install is fully offline. Kept out of the base
 * image (mirror on demand via POST /api/sprites/mirror) to keep it small.
 *
 * When SPRITE_DIR is unset the whole feature is disabled: rewrite() is a no-op
 * (entries keep their canonical remote URLs) and the routes report enabled:false.
 */

const KEY_RE = /^[A-Za-z0-9._-]+$/;

/** Stable on-disk filename for a sprite URL: its basename (e.g. "6.png", "666-fancy.png"). */
export function spriteKeyFromUrl(url: string): string | null {
  try {
    const pathname = url.startsWith('http') ? new URL(url).pathname : url;
    const base = pathname.split('/').filter(Boolean).pop() ?? '';
    if (!base || !KEY_RE.test(base) || base.includes('..')) return null;
    return base;
  } catch {
    return null;
  }
}

export interface MirrorProgress {
  enabled: boolean;
  running: boolean;
  total: number;
  mirrored: number;   // files present on disk
  fetched: number;    // downloaded in the current/last run
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

interface SpriteMirrorOptions {
  dir: string;
  concurrency?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export class SpriteMirror {
  readonly dir: string;
  private concurrency: number;
  private fetchImpl: typeof fetch;
  private log: (msg: string) => void;
  private present = new Set<string>();
  private running = false;
  private fetched = 0;
  private failed = 0;
  private total = 0;
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private lastError: string | null = null;

  constructor(opts: SpriteMirrorOptions) {
    this.dir = opts.dir;
    this.concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 16));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? (() => {});
  }

  /** Create the dir and index what's already mirrored. */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    this.present = new Set(files.filter((f) => KEY_RE.test(f) && !f.endsWith('.tmp')));
  }

  has(key: string): boolean {
    return this.present.has(key);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Local path served to clients for a mirrored key. */
  static localUrl(key: string): string {
    return `/api/sprites/${key}`;
  }

  /** Rewrite a remote sprite URL to the local one iff it's mirrored; else return it unchanged. */
  rewrite(spriteUrl: string): string {
    const key = spriteKeyFromUrl(spriteUrl);
    if (key && this.present.has(key)) return SpriteMirror.localUrl(key);
    return spriteUrl;
  }

  progress(): MirrorProgress {
    return {
      enabled: true,
      running: this.running,
      total: this.total,
      mirrored: this.present.size,
      fetched: this.fetched,
      failed: this.failed,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      lastError: this.lastError,
    };
  }

  /** Absolute path for a validated key, or null if the key is unsafe. */
  filePath(key: string): string | null {
    if (!KEY_RE.test(key) || key.includes('..')) return null;
    const full = path.join(this.dir, key);
    if (path.dirname(full) !== path.resolve(this.dir)) return null; // defence in depth
    return full;
  }

  /**
   * Read a mirrored sprite fully into memory. Sprites are tiny (~1 KB), so this
   * buffers rather than streams — a Node fs stream handed to the HTTP layer
   * throws ERR_INVALID_STATE when the client aborts mid-flight (common with
   * hundreds of lazy-loaded <img>s) and crashes the process.
   */
  async readBytes(key: string): Promise<Buffer | null> {
    const full = this.filePath(key);
    if (!full) return null;
    try {
      const s = await stat(full);
      if (!s.isFile()) return null;
      return await readFile(full);
    } catch {
      return null;
    }
  }

  /**
   * Download every missing sprite for the given URLs. Idempotent — already-present
   * keys are skipped, so re-running only fetches gaps. Returns immediately if a run
   * is already in progress. Safe to call in the background (does not throw).
   */
  async run(urls: string[]): Promise<MirrorProgress> {
    if (this.running) return this.progress();
    this.running = true;
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.fetched = 0;
    this.failed = 0;
    this.lastError = null;

    // Distinct, resolvable keys → remote URL.
    const wanted = new Map<string, string>();
    for (const url of urls) {
      const key = spriteKeyFromUrl(url);
      if (key) wanted.set(key, url);
    }
    this.total = wanted.size;
    const missing = [...wanted.entries()].filter(([key]) => !this.present.has(key));

    try {
      await mapLimit(missing, this.concurrency, async ([key, url]) => {
        try {
          await this.download(key, url);
          this.present.add(key);
          this.fetched += 1;
        } catch (err) {
          this.failed += 1;
          this.lastError = `${key}: ${String(err)}`;
          this.log(`sprite mirror failed for ${key}: ${String(err)}`);
        }
      });
    } finally {
      this.running = false;
      this.finishedAt = new Date().toISOString();
    }
    return this.progress();
  }

  private async download(key: string, url: string): Promise<void> {
    const full = this.filePath(key);
    if (!full) throw new Error('unsafe key');
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await this.fetchImpl(url);
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) {
            await sleep(500 * 2 ** (attempt - 1));
            lastErr = new Error(`HTTP ${res.status}`);
            continue;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        if (!res.body) throw new Error('empty body');
        const tmp = `${full}.${process.pid}-${attempt}.tmp`;
        await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
        await rename(tmp, full);
        return;
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && err.message.startsWith('HTTP 4') && !err.message.includes('429')) throw err;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
    throw new Error(`giving up after 4 attempts: ${String(lastErr)}`);
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
