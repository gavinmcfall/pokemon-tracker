// Compare tracker obtainability against the vendored pokepc data, per form × game.
// Read-only: SELECTs only. Compares two things against pokepc:
//   live  — what the database holds now (the last seed's output)
//   next  — what the next seed would write (mirror + applyPokepc), computed here
// After adopting pokepc, `next` should differ only by deliberate overrides
// (POKEPC_CORRECTIONS, EVENT_ONLY_FORMS).
//
//   $env:CHECK_DB_URL = "<read-only database url>"; npx tsx scripts/compare-pokepc.ts out.json
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import type { Obtainability } from '../src/types.js';
import { GAMES, RELEASES_BY_GROUP } from '../src/obtainability/games.js';
import { obtainabilityWithFormsFromMirror } from '../src/obtainability/from-mirror.js';
import { applyPokepc, pokepcAvailability } from '../src/obtainability/pokepc.js';

const outFile = process.argv[2];
if (!outFile || !process.env.CHECK_DB_URL) throw new Error('usage: CHECK_DB_URL=... tsx scripts/compare-pokepc.ts <out.json>');

const client = new pg.Client({ connectionString: process.env.CHECK_DB_URL });
await client.connect();
const rows = (await client.query<{ dex: number; form_slug: string; availability: Obtainability['availability'] | null }>(
  `select distinct on (e.dex, e.form_slug) e.dex, e.form_slug, o.availability
     from entries e left join obtainability o using (entry_key) order by e.dex, e.form_slug`,
)).rows;
const { byDex, byForm } = await obtainabilityWithFormsFromMirror(client, process.env.MIRROR_SCHEMA ?? 'pokeapi');
await client.end();

type Cartridges = Map<string, string[]>;
const cartridges = (availability: Obtainability['availability']): Cartridges =>
  new Map(availability.map((a) => [a.gameId, a.versions?.length ? a.versions : (RELEASES_BY_GROUP.get(a.gameId) ?? [])]));

interface Diff { side: 'live' | 'next'; game: string; form: string; tracker: string; pokepc: string }
const diffs: Diff[] = [];
let unmatched = 0;
const COMPARED = GAMES.map((g) => g.gameId).filter((g) => g !== 'ww');

for (const r of rows) {
  const pp = pokepcAvailability(r.dex, r.form_slug);
  if (!pp) { unmatched++; continue; }
  const mirror = byForm.get(`${r.dex}:${r.form_slug}`) ?? byDex.get(r.dex);
  const sides: [Diff['side'], Cartridges][] = [['live', cartridges(r.availability ?? [])]];
  if (mirror) sides.push(['next', cartridges(applyPokepc(r.dex, r.form_slug, mirror).availability)]);
  for (const [side, ours] of sides) {
    for (const g of COMPARED) {
      const a = (ours.get(g) ?? []).join('+');
      const b = (pp.native.get(g) ?? []).join('+');
      if (a !== b) diffs.push({ side, game: g, form: `${r.dex}:${r.form_slug}`, tracker: a || '-', pokepc: b || '-' });
    }
  }
}

writeFileSync(outFile, JSON.stringify({ forms: rows.length, unmatched, diffs }, null, 1));
const count = (side: Diff['side']) => diffs.filter((d) => d.side === side).length;
console.log({ forms: rows.length, unmatched, live: count('live'), next: count('next') });
for (const d of diffs.filter((x) => x.side === 'next')) console.log(`next ${d.game} ${d.form}: tracker=${d.tracker} pokepc=${d.pokepc}`);
