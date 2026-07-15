import type pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Loads PokéAPI's `data/v2/csv/*.csv` files verbatim into a local Postgres
 * schema — one text-column table per file, matching the CSV header. The mirror
 * is a faithful passthrough (all columns `text`, empty cells → SQL NULL); the
 * seed casts/joins as needed. Tables are dropped + recreated per sync so a load
 * is a clean full replace.
 */

/** CSV header cell → safe SQL identifier: strip BOM, lowercase, non-alnum→_, ensure leading letter/_. */
export function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return /^[a-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** `pokemon_species.csv` → `pokemon_species`. */
export function tableNameFromFile(file: string): string {
  return sanitizeIdent(file.replace(/\.csv$/i, ''));
}

/** First CSV line → column identifiers (PokéAPI headers are plain, unquoted). */
export function parseHeaderLine(line: string): string[] {
  return line.replace(/^﻿/, '').replace(/\r$/, '').split(',').map(sanitizeIdent);
}

const qid = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * (Re)create `schema.table` from a CSV's header and COPY its rows in. Returns
 * the row count loaded. Runs on the given client so the caller can wrap a whole
 * sync in one transaction (readers see the old tables until commit).
 */
export async function loadCsv(client: pg.ClientBase, schema: string, table: string, csvText: string): Promise<number> {
  const firstBreak = csvText.indexOf('\n');
  const headerLine = firstBreak === -1 ? csvText : csvText.slice(0, firstBreak);
  const columns = parseHeaderLine(headerLine);
  if (columns.length === 0) throw new Error(`empty header for table ${table}`);

  const qtable = `${qid(schema)}.${qid(table)}`;
  await client.query(`drop table if exists ${qtable}`);
  await client.query(`create table ${qtable} (${columns.map((c) => `${qid(c)} text`).join(', ')})`);

  // Header-only or empty file → table exists with 0 rows.
  const hasRows = firstBreak !== -1 && csvText.slice(firstBreak + 1).trim() !== '';
  if (hasRows) {
    const ingest = client.query(copyFrom(`copy ${qtable} from stdin with (format csv, header true)`));
    await pipeline(Readable.from(csvText), ingest);
  }
  const res = await client.query<{ count: string }>(`select count(*)::text as count from ${qtable}`);
  return Number(res.rows[0]!.count);
}
