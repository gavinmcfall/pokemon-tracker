import type { EntryWithStatus, Gender, StatusPatch } from './types.js';
import { entryKeyOf } from './types.js';

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, trailing newline. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r' && text[i + 1] === '\n') { pushRow(); i += 2; continue; }
    if (c === '\n' || c === '\r') { pushRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function toCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(toCsvValue).join(',')).join('\r\n') + '\r\n';
}

export const EXPORT_COLUMNS = [
  'entryKey', 'dex', 'name', 'formSlug', 'formLabel', 'gender', 'types',
  'generation', 'caught', 'caughtAt', 'gameOrigin', 'method', 'notes', 'inHome',
] as const;

/** Canonical export; POST /api/import accepts this format back unchanged (round-trip). */
export function exportCsv(entries: EntryWithStatus[]): string {
  const rows: string[][] = [Array.from(EXPORT_COLUMNS)];
  for (const e of entries) {
    rows.push([
      e.entryKey,
      String(e.dex),
      e.name,
      e.formSlug,
      e.formLabel ?? '',
      e.gender,
      e.types.join('/'),
      String(e.generation),
      e.status?.caught ? 'true' : 'false',
      e.status?.caughtAt ?? '',
      e.status?.gameOrigin ?? '',
      e.status?.method ?? '',
      e.status?.notes ?? '',
      e.status ? (e.status.inHome ? 'true' : 'false') : '',
    ]);
  }
  return serializeCsv(rows);
}

export interface UnmatchedRow {
  line: number;
  reason: string;
  raw: string;
}

export interface ImportPlan {
  /** One StatusPatch per (row, resolved entry) pair. */
  patches: (StatusPatch & { line: number })[];
  unmatched: UnmatchedRow[];
  matchedRows: number;
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'x', '✓', '✔', 'caught', 'done']);
const FALSY = new Set(['false', '0', 'no', 'n', '', 'uncaught', 'missing']);

function parseCaught(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return null;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Recognized headers → canonical field. Anything else is ignored.
const HEADER_ALIASES: Record<string, string> = {
  entrykey: 'entryKey',
  key: 'entryKey',
  dex: 'dex',
  nationaldex: 'dex',
  number: 'dex',
  no: 'dex',
  name: 'name',
  pokemon: 'name',
  species: 'name',
  formslug: 'formSlug',
  form: 'formSlug',
  gender: 'gender',
  caught: 'caught',
  status: 'caught',
  owned: 'caught',
  have: 'caught',
  gameorigin: 'gameOrigin',
  game: 'gameOrigin',
  origin: 'gameOrigin',
  method: 'method',
  notes: 'notes',
  note: 'notes',
  inhome: 'inHome',
  home: 'inHome',
  transferred: 'inHome',
};

function parseGender(raw: string): Gender | null {
  const v = raw.trim().toLowerCase();
  if (v === 'male' || v === 'm' || v === '♂') return 'male';
  if (v === 'female' || v === 'f' || v === '♀') return 'female';
  if (v === 'genderless' || v === 'none' || v === '-') return 'genderless';
  return null;
}

/**
 * Map a tracker CSV onto entry keys. Resolution per row, most to least specific:
 *  1. `entryKey` column → exact entry.
 *  2. `dex` (+ optional formSlug, + optional gender) → all entries matching; a
 *     flat one-row-per-species sheet marks every matching form/gender slot.
 * Unresolvable rows are reported, never fatal (spec §6).
 */
export function planImport(text: string, allEntries: { entryKey: string; dex: number; formSlug: string; gender: Gender }[]): ImportPlan {
  const rows = parseCsv(text);
  const plan: ImportPlan = { patches: [], unmatched: [], matchedRows: 0 };
  if (rows.length === 0) return plan;

  const header = rows[0]!.map(normalizeHeader).map((h) => HEADER_ALIASES[h] ?? null);
  const col = (name: string): number => header.indexOf(name);
  if (col('entryKey') === -1 && col('dex') === -1) {
    plan.unmatched.push({ line: 1, reason: 'header must include an "entryKey" or "dex" column', raw: rows[0]!.join(',') });
    return plan;
  }
  if (col('caught') === -1) {
    plan.unmatched.push({ line: 1, reason: 'header must include a "caught" (or "status"/"owned") column', raw: rows[0]!.join(',') });
    return plan;
  }

  const byKey = new Map(allEntries.map((e) => [e.entryKey, e]));
  const byDex = new Map<number, typeof allEntries>();
  for (const e of allEntries) {
    const list = byDex.get(e.dex) ?? [];
    list.push(e);
    byDex.set(e.dex, list);
  }

  const cell = (row: string[], name: string): string | undefined => {
    const idx = col(name);
    return idx === -1 ? undefined : (row[idx] ?? '').trim();
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const line = r + 1;
    const raw = row.join(',');
    const caught = parseCaught(cell(row, 'caught') ?? '');
    if (caught === null) {
      plan.unmatched.push({ line, reason: `unrecognized caught value "${cell(row, 'caught')}"`, raw });
      continue;
    }

    let targets: { entryKey: string }[] = [];
    const key = cell(row, 'entryKey');
    if (key) {
      const hit = byKey.get(key);
      if (!hit) {
        plan.unmatched.push({ line, reason: `unknown entryKey "${key}"`, raw });
        continue;
      }
      targets = [hit];
    } else {
      const dexRaw = cell(row, 'dex') ?? '';
      const dex = Number.parseInt(dexRaw, 10);
      if (!Number.isInteger(dex) || dex <= 0) {
        plan.unmatched.push({ line, reason: `invalid dex number "${dexRaw}"`, raw });
        continue;
      }
      let candidates = byDex.get(dex) ?? [];
      const formRaw = cell(row, 'formSlug');
      if (formRaw) {
        const slug = formRaw.toLowerCase().replace(/[\s-]+/g, '_');
        candidates = candidates.filter((e) => e.formSlug === slug);
      }
      const genderRaw = cell(row, 'gender');
      if (genderRaw) {
        const gender = parseGender(genderRaw);
        if (gender === null) {
          plan.unmatched.push({ line, reason: `unrecognized gender "${genderRaw}"`, raw });
          continue;
        }
        candidates = candidates.filter((e) => e.gender === gender);
      }
      if (candidates.length === 0) {
        plan.unmatched.push({ line, reason: `no entries match dex ${dex}${formRaw ? ` form "${formRaw}"` : ''}${genderRaw ? ` gender "${genderRaw}"` : ''}`, raw });
        continue;
      }
      targets = candidates;
    }

    plan.matchedRows += 1;
    const gameOrigin = cell(row, 'gameOrigin');
    const method = cell(row, 'method');
    const notes = cell(row, 'notes');
    for (const t of targets) {
      const patch: StatusPatch & { line: number } = { entryKey: t.entryKey, caught, line };
      if (gameOrigin !== undefined && gameOrigin !== '') patch.gameOrigin = gameOrigin;
      if (method !== undefined && method !== '') patch.method = method;
      if (notes !== undefined && notes !== '') patch.notes = notes;
      const inHomeRaw = cell(row, 'inHome');
      if (inHomeRaw !== undefined && inHomeRaw !== '') {
        const v = inHomeRaw.trim().toLowerCase();
        if (TRUTHY.has(v)) patch.inHome = true;
        else if (FALSY.has(v)) patch.inHome = false;
      }
      plan.patches.push(patch);
    }
  }
  return plan;
}

export { entryKeyOf };
