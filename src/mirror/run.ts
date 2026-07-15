import pg from 'pg';
import { loadCsv, tableNameFromFile } from './load.js';
import { fetchRaw, latestDataSha, listCsvFiles, type RepoRef } from './github.js';

/**
 * PokéAPI mirror job (self-syncing): checks the latest commit that touched the
 * upstream CSV data path; if it matches what we last loaded, it's a no-op.
 * Otherwise it loads every CSV into the mirror schema (one text table each) in a
 * single transaction and records the new SHA. Import + monitor in one job — run
 * it on a daily CronJob and it only does work when upstream actually changed.
 */

const SCHEMA = process.env.MIRROR_SCHEMA ?? 'pokeapi';
const qid = (name: string) => `"${name.replaceAll('"', '""')}"`;

function parseRepo(): RepoRef {
  const repo = process.env.POKEAPI_REPO ?? 'PokeAPI/pokeapi';
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`invalid POKEAPI_REPO "${repo}" (expected owner/repo)`);
  return { owner, repo: name, path: process.env.POKEAPI_CSV_PATH ?? 'data/v2/csv' };
}

async function ensureMeta(client: pg.ClientBase): Promise<void> {
  await client.query(`create schema if not exists ${qid(SCHEMA)}`);
  await client.query(`create table if not exists ${qid(SCHEMA)}.mirror_meta (
    id int primary key default 1 check (id = 1),
    synced_sha text, synced_at timestamptz, source_repo text, source_path text, table_count int
  )`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const token = process.env.GITHUB_TOKEN;
  const force = ['1', 'true', 'yes'].includes((process.env.MIRROR_FORCE ?? '').toLowerCase());
  const ref = parseRepo();

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const setup = await pool.connect();
    await ensureMeta(setup);
    const stored = (await setup.query<{ synced_sha: string | null }>(
      `select synced_sha from ${qid(SCHEMA)}.mirror_meta where id = 1`,
    )).rows[0]?.synced_sha ?? null;
    setup.release();

    const latest = await latestDataSha(fetch, ref, token);
    console.log(`mirror: source=${ref.owner}/${ref.repo}/${ref.path} latest=${latest.slice(0, 12)} stored=${stored?.slice(0, 12) ?? 'none'}`);
    if (stored === latest && !force) {
      console.log('mirror: up to date — nothing to do');
      return;
    }

    const files = await listCsvFiles(fetch, ref, latest, token);
    console.log(`mirror: loading ${files.length} CSV files at ${latest.slice(0, 12)}${force ? ' (forced)' : ''}`);

    const client = await pool.connect();
    try {
      await client.query('begin');
      let totalRows = 0;
      for (const file of files) {
        const csv = await fetchRaw(fetch, ref, latest, file.path);
        totalRows += await loadCsv(client, SCHEMA, tableNameFromFile(file.name), csv);
      }
      await client.query(
        `insert into ${qid(SCHEMA)}.mirror_meta (id, synced_sha, synced_at, source_repo, source_path, table_count)
         values (1, $1, now(), $2, $3, $4)
         on conflict (id) do update set
           synced_sha = excluded.synced_sha, synced_at = excluded.synced_at,
           source_repo = excluded.source_repo, source_path = excluded.source_path,
           table_count = excluded.table_count`,
        [latest, `${ref.owner}/${ref.repo}`, ref.path, files.length],
      );
      await client.query('commit');
      console.log(`mirror: done — ${files.length} tables, ${totalRows} rows, sha=${latest.slice(0, 12)}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
