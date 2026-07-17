import pg from 'pg';
import { parseLocations, parseLocationsGen8, serebiiSlug, type SupplementRow } from './serebii.js';

/**
 * Serebii location-supplement job. PokéAPI has no encounter data for the
 * modern games, so this fetches each relevant species' Serebii SV dex page
 * (which carries SV, SV-DLC, Legends: Z-A and Mega Dimension location rows)
 * and stores the parsed locations in `supplement.serebii_locations`. The seed
 * merges them into obtainability wherever the mirror has no location data.
 *
 * Fetching is deliberately polite: one request per SUPPLEMENT_DELAY_MS
 * (default 1100ms), an identifying User-Agent, and per-species result hashes
 * so an unchanged page writes nothing. A page that fails to fetch or parse is
 * skipped (previous data kept) — never guessed.
 */

const USER_AGENT = 'livingdex-supplement/1.0 (personal living-dex tracker; low-volume, cached)';

export interface SupplementOptions {
  fetchImpl?: typeof fetch;
  schema?: string;
  mirrorSchema?: string;
  base?: string;
  delayMs?: number;
  force?: boolean;
}

const qid = (name: string) => `"${name.replaceAll('"', '""')}"`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureTables(client: pg.ClientBase, schema: string): Promise<void> {
  await client.query(`create schema if not exists ${qid(schema)}`);
  await client.query(`create table if not exists ${qid(schema)}.serebii_pages (
    dex int primary key, hash text not null, fetched_at timestamptz not null default now()
  )`);
  await client.query(`create table if not exists ${qid(schema)}.serebii_locations (
    dex int not null, game_id text not null, version text not null default '',
    locations text[] not null, updated_at timestamptz not null default now(),
    primary key (dex, game_id, version)
  )`);
}

/**
 * Species in the dexes of games the supplement covers, with which Serebii page
 * era(s) to fetch: `svEra` (/pokedex-sv/: SV + Z-A rows) and `gen8Era`
 * (/pokedex-swsh/: BDSP + Legends: Arceus rows).
 */
async function relevantSpecies(client: pg.ClientBase, mirror: string): Promise<{ dex: number; identifier: string; svEra: boolean; gen8Era: boolean }[]> {
  const res = await client.query<{ species_id: string; identifier: string; sv_era: boolean; gen8_era: boolean }>(
    `select dn.species_id, s.identifier,
            bool_or(vg.identifier in ('scarlet-violet','the-teal-mask','the-indigo-disk','legends-za','mega-dimension')) as sv_era,
            bool_or(vg.identifier in ('brilliant-diamond-shining-pearl','legends-arceus')) as gen8_era
     from ${qid(mirror)}."pokemon_dex_numbers" dn
     join ${qid(mirror)}."pokedexes" pd on pd.id = dn.pokedex_id and pd.is_main_series = '1'
     join ${qid(mirror)}."pokedex_version_groups" pvg on pvg.pokedex_id = dn.pokedex_id
     join ${qid(mirror)}."version_groups" vg on vg.id = pvg.version_group_id
     join ${qid(mirror)}."pokemon_species" s on s.id = dn.species_id
     where vg.identifier in ('scarlet-violet','the-teal-mask','the-indigo-disk','legends-za','mega-dimension',
                             'brilliant-diamond-shining-pearl','legends-arceus')
     group by dn.species_id, s.identifier
     order by 1`,
  );
  return res.rows
    .map((r) => ({ dex: Number(r.species_id), identifier: r.identifier, svEra: r.sv_era, gen8Era: r.gen8_era }))
    .filter((r) => r.svEra || r.gen8Era);
}

function hashRows(rows: SupplementRow[]): string {
  // Stable content hash (djb2 over the canonical serialization) — enough to
  // detect change; not cryptographic.
  const s = JSON.stringify(rows);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export async function runSupplement(
  pool: pg.Pool,
  opts: SupplementOptions = {},
): Promise<{ fetched: number; updated: number; unchanged: number; missing: number; failed: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const SCHEMA = opts.schema ?? process.env.SUPPLEMENT_SCHEMA ?? 'supplement';
  const MIRROR = opts.mirrorSchema ?? process.env.MIRROR_SCHEMA ?? 'pokeapi';
  const BASE = opts.base ?? process.env.SEREBII_BASE ?? 'https://www.serebii.net';
  const DELAY_MS = opts.delayMs ?? Number.parseInt(process.env.SUPPLEMENT_DELAY_MS ?? '1100', 10);
  const FORCE = opts.force ?? ['1', 'true', 'yes'].includes((process.env.SUPPLEMENT_FORCE ?? '').toLowerCase());
  const client = await pool.connect();
  const stats = { fetched: 0, updated: 0, unchanged: 0, missing: 0, failed: 0 };
  try {
    await ensureTables(client, SCHEMA);
    const species = await relevantSpecies(client, MIRROR);
    console.log(`supplement: ${species.length} species in SV/Z-A era dexes (source=${BASE})`);
    const hashes = new Map<number, string>(
      (await client.query<{ dex: number; hash: string }>(`select dex, hash from ${qid(SCHEMA)}.serebii_pages`))
        .rows.map((r) => [r.dex, r.hash]),
    );

    for (const { dex, identifier, svEra, gen8Era } of species) {
      const pages: { path: string; parse: (html: string) => SupplementRow[] }[] = [
        ...(svEra ? [{ path: 'pokedex-sv', parse: parseLocations }] : []),
        ...(gen8Era ? [{ path: 'pokedex-swsh', parse: parseLocationsGen8 }] : []),
      ];
      const rows: SupplementRow[] = [];
      let anyFetched = false;
      let anyFailed = false;
      for (const page of pages) {
        await sleep(DELAY_MS);
        const url = `${BASE}/${page.path}/${serebiiSlug(identifier)}/`;
        try {
          const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
          if (res.status === 404) { stats.missing += 1; continue; }
          if (!res.ok) { console.warn(`supplement: ${url} -> ${res.status}, skipping`); anyFailed = true; continue; }
          rows.push(...page.parse(await res.text()));
          anyFetched = true;
        } catch (err) {
          console.warn(`supplement: ${url} failed (${String(err).slice(0, 80)}), skipping`);
          anyFailed = true;
        }
      }
      if (anyFailed) { stats.failed += 1; continue; } // partial data would corrupt the hash — keep previous
      if (!anyFetched) continue;
      stats.fetched += 1;

      const hash = hashRows(rows);
      if (!FORCE && hashes.get(dex) === hash) { stats.unchanged += 1; continue; }

      await client.query('begin');
      try {
        await client.query(`delete from ${qid(SCHEMA)}.serebii_locations where dex = $1`, [dex]);
        for (const r of rows) {
          await client.query(
            `insert into ${qid(SCHEMA)}.serebii_locations (dex, game_id, version, locations) values ($1,$2,$3,$4)`,
            [dex, r.gameId, r.version, r.locations],
          );
        }
        await client.query(
          `insert into ${qid(SCHEMA)}.serebii_pages (dex, hash, fetched_at) values ($1,$2,now())
           on conflict (dex) do update set hash = excluded.hash, fetched_at = now()`,
          [dex, hash],
        );
        await client.query('commit');
        stats.updated += 1;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
    console.log(`supplement: done — fetched=${stats.fetched} updated=${stats.updated} unchanged=${stats.unchanged} missing=${stats.missing} failed=${stats.failed}`);
    return stats;
  } finally {
    client.release();
  }
}

const isMain = process.argv[1]?.endsWith('run.js') || process.argv[1]?.endsWith('run.ts');
if (isMain) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  runSupplement(pool)
    .then(() => pool.end())
    .catch((err) => { console.error(err); process.exit(1); });
}
