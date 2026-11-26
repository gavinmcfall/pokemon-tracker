// Which living-dex entries can be finished on a Nintendo Switch (or Switch 2)?
// Read-only: SELECTs only. Computes what the next seed would write (mirror +
// applyPokepc) and groups every entry by its best route:
//   switch — caught in a Switch game (HOME forms), or kept in a Switch save
//   go     — only via Pokémon GO → HOME
//   legacy — only in 3DS-or-older games
//   none   — no current route (event-only)
//
//   $env:CHECK_DB_URL = "<read-only database url>"; npx tsx scripts/switch-coverage.ts
import pg from 'pg';
import type { Obtainability } from '../src/types.js';
import { RELEASE_BY_ID, SWITCH_GAME_IDS } from '../src/obtainability/games.js';
import { obtainabilityWithFormsFromMirror } from '../src/obtainability/from-mirror.js';
import { applyPokepc } from '../src/obtainability/pokepc.js';

if (!process.env.CHECK_DB_URL) throw new Error('usage: CHECK_DB_URL=... tsx scripts/switch-coverage.ts');
const client = new pg.Client({ connectionString: process.env.CHECK_DB_URL });
await client.connect();
const rows = (await client.query<{ entry_key: string; dex: number; form_slug: string; name: string; form_label: string | null; caught: boolean | null }>(
  `select e.entry_key, e.dex, e.form_slug, e.name, e.form_label, s.caught
     from entries e left join status s using (entry_key) order by e.dex, e.entry_key`,
)).rows;
const { byDex, byForm } = await obtainabilityWithFormsFromMirror(client, process.env.MIRROR_SCHEMA ?? 'pokeapi');
await client.end();

const onSwitch = (ob: Obtainability): boolean => ob.keptIn
  ? ob.keptIn.releases.some((r) => SWITCH_GAME_IDS.has(RELEASE_BY_ID.get(r)?.versionGroup ?? '')) &&
    ob.availability.some((a) => SWITCH_GAME_IDS.has(a.gameId))
  : ob.availability.some((a) => SWITCH_GAME_IDS.has(a.gameId));

const buckets: Record<string, typeof rows> = { switch: [], go: [], legacy: [], none: [], 'no data': [] };
const keptCount = { save: 0, battle: 0 };
const detail = new Map<string, string>();
for (const r of rows) {
  const mirror = byForm.get(`${r.dex}:${r.form_slug}`) ?? byDex.get(r.dex);
  if (!mirror) { buckets['no data']!.push(r); continue; }
  const ob = applyPokepc(r.dex, r.form_slug, mirror);
  if (ob.keptIn) keptCount[ob.keptIn.kind] += 1;
  const games = ob.availability.map((a) => a.gameId);
  detail.set(r.entry_key, `${games.join(',')}${ob.keptIn ? ` | ${ob.keptIn.kind}: ${ob.keptIn.releases.join(',')}` : ''}`);
  if (onSwitch(ob)) buckets.switch!.push(r);
  else if (games.includes('go')) buckets.go!.push(r);
  else if (games.length) buckets.legacy!.push(r);
  else buckets.none!.push(r);
}

console.log(`entries ${rows.length}; HOME can't store: ${keptCount.save} save-held, ${keptCount.battle} battle-only`);
for (const [name, list] of Object.entries(buckets)) {
  const caught = list.filter((r) => r.caught).length;
  console.log(`\n== ${name}: ${list.length} (caught ${caught}, missing ${list.length - caught})`);
  if (name === 'switch') continue;
  for (const r of list) console.log(`  ${r.name}${r.form_label ? ` (${r.form_label})` : ''}${r.caught ? ' [caught]' : ''} :: ${detail.get(r.entry_key) ?? ''}`);
}
