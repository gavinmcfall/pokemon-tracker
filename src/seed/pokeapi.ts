import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/* Trimmed PokéAPI shapes — only the fields the seed reads. */

export interface NamedRef {
  name: string;
  url: string;
}

export interface RawLocalizedName {
  name: string;
  language: NamedRef;
}

export interface RawSpecies {
  id: number;
  name: string;
  gender_rate: number; // -1 genderless, 0 male-only, 8 female-only, 1..7 both
  generation: NamedRef;
  names: RawLocalizedName[];
  varieties: { is_default: boolean; pokemon: NamedRef }[];
  has_gender_differences?: boolean;
  evolution_chain?: { url: string } | null;
}

/** /pokemon/{name}/encounters — location areas with the versions each appears in. */
export interface RawEncounter {
  version_details: { version: NamedRef }[];
}

/** A node in an /evolution-chain tree. */
export interface RawChainLink {
  species: NamedRef;
  evolves_to: RawChainLink[];
}

export interface RawEvolutionChain {
  id: number;
  chain: RawChainLink;
}

export interface RawPokemon {
  id: number;
  name: string;
  is_default: boolean;
  types: { slot: number; type: NamedRef }[];
  sprites: { front_default: string | null; front_female: string | null };
  forms: NamedRef[];
}

export interface RawForm {
  id: number;
  name: string;
  form_name: string;
  is_battle_only: boolean;
  is_mega: boolean;
  form_order: number;
  types?: { slot: number; type: NamedRef }[];
  names: RawLocalizedName[];
  sprites: { front_default: string | null } | null;
}

export interface PokeApiClientOptions {
  baseUrl?: string;
  cacheDir?: string;
  concurrency?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/**
 * PokéAPI client with a disk cache (spec §5: re-runs are cheap and
 * offline-repeatable), bounded concurrency and 429/5xx backoff.
 */
export class PokeApiClient {
  readonly baseUrl: string;
  private cacheDir: string | null;
  private maxAttempts: number;
  private fetchImpl: typeof fetch;
  private log: (msg: string) => void;
  private semaphore: Semaphore;
  requestCount = 0;
  cacheHits = 0;

  constructor(opts: PokeApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://pokeapi.co/api/v2').replace(/\/$/, '');
    this.cacheDir = opts.cacheDir ?? null;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? (() => {});
    this.semaphore = new Semaphore(Math.max(1, Math.min(opts.concurrency ?? 8, 8)));
  }

  async get<T>(resource: string): Promise<T> {
    const url = resource.startsWith('http') ? resource : `${this.baseUrl}/${resource.replace(/^\//, '')}`;
    const cached = await this.readCache(url);
    if (cached !== null) {
      this.cacheHits += 1;
      return JSON.parse(cached) as T;
    }
    return this.semaphore.run(async () => {
      const body = await this.fetchWithRetry(url);
      await this.writeCache(url, body);
      return JSON.parse(body) as T;
    });
  }

  async species(idOrName: number | string): Promise<RawSpecies> {
    return this.get<RawSpecies>(`pokemon-species/${idOrName}`);
  }

  async listSpecies(): Promise<NamedRef[]> {
    const page = await this.get<{ count: number; results: NamedRef[] }>('pokemon-species?limit=100000&offset=0');
    return page.results;
  }

  async pokemon(name: string): Promise<RawPokemon> {
    return this.get<RawPokemon>(`pokemon/${name}`);
  }

  async form(name: string): Promise<RawForm> {
    return this.get<RawForm>(`pokemon-form/${name}`);
  }

  async encounters(pokemonName: string): Promise<RawEncounter[]> {
    return this.get<RawEncounter[]>(`pokemon/${pokemonName}/encounters`);
  }

  async evolutionChain(idOrUrl: number | string): Promise<RawEvolutionChain> {
    return this.get<RawEvolutionChain>(typeof idOrUrl === 'number' ? `evolution-chain/${idOrUrl}` : idOrUrl);
  }

  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(url);
        this.requestCount += 1;
        if (res.ok) return await res.text();
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1000 * 2 ** (attempt - 1);
          this.log(`HTTP ${res.status} for ${url}, retrying in ${delayMs}ms (attempt ${attempt}/${this.maxAttempts})`);
          await sleep(delayMs);
          lastError = new Error(`HTTP ${res.status} for ${url}`);
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('HTTP 4')) throw err;
        lastError = err;
        const delayMs = 1000 * 2 ** (attempt - 1);
        this.log(`fetch failed for ${url}: ${String(err)}, retrying in ${delayMs}ms (attempt ${attempt}/${this.maxAttempts})`);
        await sleep(delayMs);
      }
    }
    throw new Error(`giving up on ${url} after ${this.maxAttempts} attempts: ${String(lastError)}`);
  }

  private cachePath(url: string): string | null {
    if (!this.cacheDir) return null;
    const withoutBase = url.replace(this.baseUrl, '').replace(/^\//, '');
    const safe = withoutBase.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
    return path.join(this.cacheDir, `${safe}.${hash}.json`);
  }

  private async readCache(url: string): Promise<string | null> {
    const file = this.cachePath(url);
    if (!file) return null;
    try {
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  private async writeCache(url: string, body: string): Promise<void> {
    const file = this.cachePath(url);
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, file);
  }
}

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
