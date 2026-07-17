/**
 * Serebii location supplement — parser + slug mapping.
 *
 * PokéAPI has no encounter data for the modern games (BDSP/PLA/SV/Z-A), so
 * per-game locations for them are sourced from Serebii's per-species dex pages
 * (`/pokedex-sv/<slug>/`), whose Locations table is stable, semantically
 * classed HTML: one row per game (`td.scarlet`, `td.violet`, `td.fooza`,
 * `td.foozamd`), DLC rows nested under a `td.tid` / `td.ttm` rowspan, and
 * locations as links into Serebii's PokéArth.
 *
 * The parser is deliberately narrow: it reads ONLY the Locations table and
 * emits rows for the games we lack data for (sv, za). Anything it doesn't
 * recognize is skipped, never guessed — a Serebii layout change degrades to
 * "no supplement" rather than wrong data.
 */

export interface SupplementRow {
  gameId: string; // version-group gameId ('sv' | 'za')
  /** 'scarlet' | 'violet' for SV rows; '' when the game has no paired versions. */
  version: string;
  locations: string[];
}

const TAG = /<[^>]+>/g;
const decode = (s: string) =>
  s.replace(/&eacute;/g, 'é').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Text of every anchor in a cell, de-duplicated; star-tier links collapse to their base name. */
function linkTexts(cell: string): string[] {
  const out: string[] = [];
  for (const m of cell.matchAll(/<a [^>]*>(.*?)<\/a>/gs)) {
    let text = decode(m[1]!.replace(TAG, ''));
    text = text.replace(/\s*\(\d+ Star\)$/i, ''); // "Poison (1 Star)" → "Poison"
    if (!text || /^(details|map)$/i.test(text)) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** A cell that describes transfer/trade-only access is not a place to catch. */
function isTransferOnly(cellText: string): boolean {
  return /transfer from|trade with players|not available/i.test(cellText);
}

/**
 * Parse the Locations table of a Serebii SV dex page into supplement rows.
 * Returns [] when the page has no recognizable Locations table.
 */
export function parseLocations(html: string): SupplementRow[] {
  const anchor = html.indexOf('<a name="location">');
  if (anchor === -1) return [];
  const end = html.indexOf('</table>', anchor);
  if (end === -1) return [];
  const block = html.slice(anchor, end);

  const rows: SupplementRow[] = [];
  const push = (gameId: string, version: string, prefix: string, cell: string) => {
    const text = decode(cell.replace(TAG, ' '));
    if (isTransferOnly(text)) return;
    const locations = linkTexts(cell).map((l) => (prefix ? `${prefix}: ${l}` : l));
    if (locations.length === 0) return;
    const existing = rows.find((r) => r.gameId === gameId && r.version === version);
    if (existing) {
      for (const l of locations) if (!existing.locations.includes(l)) existing.locations.push(l);
    } else {
      rows.push({ gameId, version, locations });
    }
  };

  // DLC container rows (`td.tid` / `td.ttm`) span the two version rows that
  // follow them; track the active prefix while walking rows in order.
  let dlcPrefix = '';
  let dlcRemaining = 0;
  for (const tr of block.split(/<tr[ >]/).slice(1)) {
    const tds = [...tr.matchAll(/<td class="([a-z]+)"[^>]*>(.*?)<\/td>/gs)];
    if (tds.length === 0) continue;
    const first = tds[0]!;
    const cls = first[1]!;
    const info = tds.find((t) => t[1] === 'fooinfo');

    if (cls === 'tid' || cls === 'ttm') {
      dlcPrefix = decode(first[2]!.replace(TAG, ' '));
      dlcRemaining = 2; // this row + the paired-version row after it
      const versionCell = tds[1];
      if (versionCell && info) push('sv', versionCell[1]!, dlcPrefix, info[2]!);
      dlcRemaining -= 1;
      continue;
    }
    if ((cls === 'scarlet' || cls === 'violet') && info) {
      if (dlcRemaining > 0) {
        push('sv', cls, dlcPrefix, info[2]!);
        dlcRemaining -= 1;
      } else {
        push('sv', cls, '', info[2]!);
      }
      continue;
    }
    if (cls === 'fooza' && info) { push('za', '', '', info[2]!); continue; }
    if (cls === 'foozamd' && info) { push('za', '', 'Mega Dimension', info[2]!); continue; }
    // fooblack (wild-spawn biome summaries) and anything unknown: skipped.
  }
  return rows;
}

/**
 * PokéAPI species identifier → Serebii page slug. Serebii drops separators
 * ("roaring-moon" → "roaringmoon"); the exceptions are curated.
 */
const SLUG_EXCEPTIONS: Record<string, string> = {
  'nidoran-f': 'nidoranf',
  'nidoran-m': 'nidoranm',
  'mr-mime': 'mr.mime',
  'mime-jr': 'mimejr.',
  'mr-rime': 'mr.rime',
  'farfetchd': "farfetch'd",
  'sirfetchd': "sirfetch'd",
  'type-null': 'typenull',
  'ho-oh': 'ho-oh',
  'porygon-z': 'porygon-z',
  'jangmo-o': 'jangmo-o',
  'hakamo-o': 'hakamo-o',
  'kommo-o': 'kommo-o',
  'wo-chien': 'wo-chien',
  'chien-pao': 'chien-pao',
  'ting-lu': 'ting-lu',
  'chi-yu': 'chi-yu',
};

export function serebiiSlug(speciesIdentifier: string): string {
  return SLUG_EXCEPTIONS[speciesIdentifier] ?? speciesIdentifier.replaceAll('-', '');
}
