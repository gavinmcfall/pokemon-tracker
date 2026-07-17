import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLocations, parseLocationsGen8, serebiiSlug } from '../src/supplement/serebii.js';

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

describe('parseLocationsGen8 (real Serebii SwSh-era page — Pikachu)', () => {
  const FIXTURE_G8 = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'serebii', 'pikachu-swsh-locations.html'),
    'utf8',
  );
  const rows = parseLocationsGen8(FIXTURE_G8);

  it('parses BDSP per version and Legends: Arceus; ignores Sword/Shield rows entirely', () => {
    expect(rows.find((r) => r.gameId === 'bdsp' && r.version === 'brilliant-diamond')?.locations).toEqual(['Trophy Garden']);
    expect(rows.find((r) => r.gameId === 'bdsp' && r.version === 'shining-pearl')?.locations).toEqual(['Trophy Garden']);
    const pla = rows.find((r) => r.gameId === 'pla');
    expect(pla?.locations.some((l) => /Obsidian Fieldlands/.test(l))).toBe(true);
    expect(rows.every((r) => r.gameId === 'bdsp' || r.gameId === 'pla')).toBe(true); // no swsh leakage
  });

  it('is keyed by game-name text, so the recycled fooeevee class cannot mislabel', () => {
    // The PLA row uses td.fooeevee on these pages; text keying still lands it on pla.
    expect(rows.filter((r) => r.gameId === 'pla')).toHaveLength(1);
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
