import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { loadCsv, parseHeaderLine, sanitizeIdent, tableNameFromFile } from '../src/mirror/load.js';
import { fetchRaw, latestDataSha, listCsvFiles, type RepoRef } from '../src/mirror/github.js';

const REF: RepoRef = { owner: 'PokeAPI', repo: 'pokeapi', path: 'data/v2/csv' };

/** Minimal fake `fetch` that routes by URL to canned responses. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const body = routes[key];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe('mirror github', () => {
  it('latestDataSha reads the newest commit touching the CSV path', async () => {
    const f = fakeFetch({ '/commits?path=data%2Fv2%2Fcsv': [{ sha: 'abc123def456' }] });
    expect(await latestDataSha(f, REF)).toBe('abc123def456');
  });

  it('listCsvFiles keeps only *.csv blobs under the path, sorted, with bare names', async () => {
    const f = fakeFetch({
      '/git/trees/': {
        truncated: false,
        tree: [
          { path: 'data/v2/csv/pokemon_species.csv', type: 'blob' },
          { path: 'data/v2/csv/pokedexes.csv', type: 'blob' },
          { path: 'data/v2/csv/', type: 'tree' },
          { path: 'data/v2/csv/README.md', type: 'blob' },       // not a csv
          { path: 'data/v2/sprites/1.png', type: 'blob' },        // outside path
        ],
      },
    });
    const files = await listCsvFiles(f, REF, 'sha1');
    expect(files).toEqual([
      { path: 'data/v2/csv/pokedexes.csv', name: 'pokedexes.csv' },
      { path: 'data/v2/csv/pokemon_species.csv', name: 'pokemon_species.csv' },
    ]);
  });

  it('listCsvFiles refuses a truncated tree (can\'t list reliably)', async () => {
    const f = fakeFetch({ '/git/trees/': { truncated: true, tree: [] } });
    await expect(listCsvFiles(f, REF, 'sha1')).rejects.toThrow(/truncated/);
  });

  it('fetchRaw builds a pinned raw URL and returns the body', async () => {
    let seen = '';
    const f = (async (input: string | URL) => { seen = String(input); return new Response('id,name\n1,x\n', { status: 200 }); }) as typeof fetch;
    const text = await fetchRaw(f, REF, 'deadbeef', 'data/v2/csv/pokedexes.csv');
    expect(seen).toBe('https://raw.githubusercontent.com/PokeAPI/pokeapi/deadbeef/data/v2/csv/pokedexes.csv');
    expect(text).toContain('id,name');
  });
});

describe('mirror identifiers', () => {
  it('sanitizeIdent strips BOM, lowercases, replaces non-alnum, ensures a leading letter/_', () => {
    expect(sanitizeIdent('﻿species_id')).toBe('species_id'); // leading BOM
    expect(sanitizeIdent('Pokedex Number')).toBe('pokedex_number');
    expect(sanitizeIdent('123abc')).toBe('_123abc');
    expect(sanitizeIdent('is_main_series')).toBe('is_main_series');
  });
  it('tableNameFromFile drops the .csv extension', () => {
    expect(tableNameFromFile('pokemon_species.csv')).toBe('pokemon_species');
    expect(tableNameFromFile('POKEDEXES.CSV')).toBe('pokedexes');
  });
  it('parseHeaderLine strips BOM + CR and splits on commas', () => {
    expect(parseHeaderLine('﻿id,region_id,identifier\r')).toEqual(['id', 'region_id', 'identifier']);
  });
});

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)('loadCsv against Postgres', () => {
  it('recreates a text table from the header and COPYs rows (BOM + empty cells)', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('create schema if not exists pokeapi_test');
      // Real-shape pokedexes CSV: leading BOM on the header, an empty region_id cell.
      const csv = '﻿id,region_id,identifier,is_main_series\n1,,national,1\n2,1,kanto,1\n';
      const n = await loadCsv(client, 'pokeapi_test', 'pokedexes', csv);
      expect(n).toBe(2);

      const cols = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='pokeapi_test' and table_name='pokedexes' order by ordinal_position`,
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual(['id', 'region_id', 'identifier', 'is_main_series']);

      const rows = await client.query<{ id: string; region_id: string | null; identifier: string }>(
        `select id, region_id, identifier from pokeapi_test.pokedexes order by id::int`,
      );
      expect(rows.rows[0]).toEqual({ id: '1', region_id: null, identifier: 'national' }); // empty cell → NULL
      expect(rows.rows[1]).toMatchObject({ id: '2', region_id: '1', identifier: 'kanto' });

      // Re-loading is a clean full replace (drop + recreate), not an append.
      const again = await loadCsv(client, 'pokeapi_test', 'pokedexes', '﻿id,identifier\n1,national\n');
      expect(again).toBe(1);
      const after = await client.query('select count(*)::int as c from pokeapi_test.pokedexes');
      expect(after.rows[0].c).toBe(1);
    } finally {
      await client.query('drop schema if exists pokeapi_test cascade').catch(() => {});
      await client.end();
    }
  });

  it('handles a header-only file (0 rows, table still created)', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('create schema if not exists pokeapi_test2');
      const n = await loadCsv(client, 'pokeapi_test2', 'empty', 'id,name\n');
      expect(n).toBe(0);
    } finally {
      await client.query('drop schema if exists pokeapi_test2 cascade').catch(() => {});
      await client.end();
    }
  });
});
