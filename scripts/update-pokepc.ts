// Regenerate src/obtainability/pokepc-data.ts from a local clone of
// https://github.com/pokepc/dataset (MIT). Reads its JSON as data only.
//
//   git clone https://github.com/pokepc/dataset <dir>
//   git -C <dir> checkout <commit>
//   npx tsx scripts/update-pokepc.ts <dir> [changes.md]
//
// changes.md gets one line per form whose availability changed. The weekly
// workflow (.github/workflows/pokepc-update.yaml) puts it in its PR. Then
// review the diff and re-run scripts/compare-pokepc.ts against the live DB.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POKEPC_CARTRIDGES, pokepcSlugs, pokepcStorage, speciesPrefix } from '../src/obtainability/pokepc-slugs.js';
import { POKEPC_RECORDS } from '../src/obtainability/pokepc-data.js';

const [dir, changesFile] = process.argv.slice(2);
if (!dir) throw new Error('usage: tsx scripts/update-pokepc.ts <pokepc-dataset-clone> [changes.md]');

const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const committed = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%cs'], { encoding: 'utf8' }).trim();
const license = readFileSync(join(dir, 'LICENSE'), 'utf8').trim();

interface PokepcRecord {
  id: string;
  dexNum: number;
  isDefault?: boolean;
  isFemaleForm?: boolean;
  isBattleOnlyForm?: boolean;
  isFusion?: boolean;
  obtainableIn?: string[];
  eventOnlyIn?: string[];
  linkRequiredIn?: string[];
  storableIn?: string[];
  refs?: { pkApiFormSlug?: string | null };
}

const releases = (carts: string[] | undefined, skip: Set<string>): string =>
  [...new Set((carts ?? []).filter((c) => !skip.has(c)).flatMap((c) => POKEPC_CARTRIDGES[c] ?? []))].join(' ');

type Row = [string, string] | [string, string, string];
const rows = new Map<string, Row>();
const aliases = new Map<string, string>();
const files = readdirSync(join(dir, 'data', 'pokemon')).filter((f) => f.endsWith('.json')).sort();
const all = files.map((f) => JSON.parse(readFileSync(join(dir, 'data', 'pokemon', f), 'utf8')) as PokepcRecord);
const idsByDex = new Map<number, string[]>();
for (const d of all) idsByDex.set(d.dexNum, [...(idsByDex.get(d.dexNum) ?? []), d.id]);
const prefixByDex = new Map([...idsByDex].map(([dex, ids]) => [dex, speciesPrefix(ids)]));
const records = all
  // Female forms are the same slot as the male one here. Battle-only forms
  // and fusions are kept: their storage (third column) says where they live.
  .filter((d) => !d.isFemaleForm)
  // Defaults first, so they keep their PokéAPI slug when a form shares it.
  .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
for (const d of records) {
  const prefix = prefixByDex.get(d.dexNum)!;
  let { slug, alias } = pokepcSlugs(prefix, d.refs?.pkApiFormSlug ?? d.id, d.isDefault === true);
  // A few forms reuse another form's PokéAPI slug (floette-eternal →
  // floette-red); those fall back to the form's own id.
  if (rows.has(`${d.dexNum}:${slug}`) && !d.isDefault) ({ slug, alias } = pokepcSlugs(prefix, d.id, false));
  const key = `${d.dexNum}:${slug}`;
  if (rows.has(key)) throw new Error(`duplicate pokepc key ${key} (${d.id})`);
  // linkRequiredIn = only via a link trade on that cartridge (the other
  // version's exclusive), which the tracker does not count as native.
  const o = releases(d.obtainableIn, new Set(d.linkRequiredIn ?? []));
  const e = releases(d.eventOnlyIn, new Set());
  // Third column, only when HOME can't store the form: `save:<releases>` (the
  // saves that hold it) or `battle[:<releases>]` (extra saves that keep it
  // outside battle, e.g. Castform weather in GO).
  const storage = pokepcStorage(d.storableIn, d.isBattleOnlyForm === true);
  const held = releases(d.storableIn, new Set());
  rows.set(key, storage === 'home' ? [o, e] : [o, e, held ? `${storage}:${held}` : storage]);
  if (alias) aliases.set(`${d.dexNum}:${alias}`, key);
}
for (const [alias, key] of aliases) if (!rows.has(alias)) rows.set(alias, rows.get(key)!);

const body = [...rows.entries()]
  .sort(([a], [b]) => Number(a.split(':')[0]) - Number(b.split(':')[0]) || a.localeCompare(b))
  .map(([k, row]) => `  ${JSON.stringify(k)}: [${row.map((c) => JSON.stringify(c)).join(', ')}],`)
  .join('\n');

// What changed against the vendored data, one line per form, for review.
const words = (s: string | undefined) => new Set(s ? s.split(' ') : []);
const delta = (label: string, before: string | undefined, after: string | undefined): string[] => {
  const b = words(before), a = words(after);
  const added = [...a].filter((r) => !b.has(r)), removed = [...b].filter((r) => !a.has(r));
  return [...(added.length ? [`${label} +${added.join(' +')}`] : []), ...(removed.length ? [`${label} -${removed.join(' -')}`] : [])];
};
const changes: string[] = [];
for (const key of [...new Set([...Object.keys(POKEPC_RECORDS), ...rows.keys()])].sort()) {
  const before = POKEPC_RECORDS[key], after = rows.get(key);
  if (!after) { changes.push(`- \`${key}\`: removed from pokepc`); continue; }
  const parts = [...delta('native', before?.[0], after[0]), ...delta('event-only', before?.[1], after[1])];
  if ((before?.[2] ?? '') !== (after[2] ?? '')) parts.push(`storage ${before?.[2] || 'home'} → ${after[2] || 'home'}`);
  if (!before) parts.unshift('new form');
  if (parts.length) changes.push(`- \`${key}\`: ${parts.join('; ')}`);
}
if (changesFile) writeFileSync(changesFile, changes.length ? `${changes.join('\n')}\n` : '');

writeFileSync(
  join(import.meta.dirname, '..', 'src', 'obtainability', 'pokepc-data.ts'),
  `// GENERATED by scripts/update-pokepc.ts — do not edit by hand.
// Source: https://github.com/pokepc/dataset at ${commit} (${committed}).
//
// Per form (\`dex:formSlug\`): [native release ids, event-only release ids,
// storage?], space-separated. Native excludes link-trade-only cartridges.
// Storage is absent when Pokémon HOME stores the form, else \`save:<releases>\`
// (only those saves hold it) or \`battle[:<releases>]\` (battle-only).
//
${license.split('\n').map((l) => `// ${l}`.trimEnd()).join('\n')}

export const POKEPC_COMMIT = '${commit}';

export const POKEPC_RECORDS: Record<string, [string, string] | [string, string, string]> = {
${body}
};
`,
);
console.log(`pokepc-data.ts: ${rows.size} keys from ${records.length} records at ${commit}; ${changes.length} forms changed`);
