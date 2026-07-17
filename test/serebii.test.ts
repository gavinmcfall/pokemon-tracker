import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLocations, serebiiSlug } from '../src/supplement/serebii.js';

// Real Serebii markup, captured from www.serebii.net/pokedex-sv/bulbasaur/
// (via a browser HAR) — not hand-written, so the parser is tested against the
// page structure as actually served.
const FIXTURE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'serebii', 'bulbasaur-locations.html'),
  'utf8',
);

describe('parseLocations (real Serebii page)', () => {
  const rows = parseLocations(FIXTURE);

  it('skips transfer-only base-game rows (Bulbasaur is not catchable in base SV)', () => {
    expect(rows.find((r) => r.gameId === 'sv' && r.locations.some((l) => /transfer/i.test(l)))).toBeUndefined();
  });

  it('parses DLC rows per version with the DLC name as prefix', () => {
    const scarlet = rows.find((r) => r.gameId === 'sv' && r.version === 'scarlet');
    expect(scarlet?.locations).toEqual(['The Indigo Disk: Coastal Biome', 'The Indigo Disk: Torchlit Labyrinth']);
    const violet = rows.find((r) => r.gameId === 'sv' && r.version === 'violet');
    expect(violet?.locations).toEqual(['The Indigo Disk: Coastal Biome', 'The Indigo Disk: Torchlit Labyrinth']);
  });

  it('parses Legends: Z-A and Mega Dimension rows (star tiers collapsed)', () => {
    const za = rows.find((r) => r.gameId === 'za' && r.version === '');
    expect(za?.locations[0]).toBe('Wild Zone 20');
    expect(za?.locations).toContain('Mega Dimension: Hyperspace Lumiose');
    expect(za?.locations).toContain('Mega Dimension: Poison');
    expect(za?.locations).toContain('Mega Dimension: Grass');
    expect(za?.locations.some((l) => /star/i.test(l))).toBe(false);
  });

  it('returns [] for pages without a Locations table', () => {
    expect(parseLocations('<html><body>nothing here</body></html>')).toEqual([]);
  });
});

describe('serebiiSlug', () => {
  it('drops separators by default and honours curated exceptions', () => {
    expect(serebiiSlug('bulbasaur')).toBe('bulbasaur');
    expect(serebiiSlug('roaring-moon')).toBe('roaringmoon');
    expect(serebiiSlug('iron-valiant')).toBe('ironvaliant');
    expect(serebiiSlug('mr-mime')).toBe('mr.mime');
    expect(serebiiSlug('ho-oh')).toBe('ho-oh');
    expect(serebiiSlug('nidoran-f')).toBe('nidoranf');
  });
});
