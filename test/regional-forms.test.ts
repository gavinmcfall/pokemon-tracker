import { describe, expect, it } from 'vitest';
import { REGIONAL_FORMS_BY_GAME, curatedForm } from '../src/obtainability/regional-forms.js';
import { RELEASES_BY_GROUP } from '../src/obtainability/games.js';

describe('curated regional forms', () => {
  it('leaves uncurated games to the mirror', () => {
    expect(curatedForm('sm', 37, 'alola')).toBeUndefined();
  });

  it('BDSP has original forms only', () => {
    expect(curatedForm('bdsp', 37, 'default')).toEqual({});
    expect(curatedForm('bdsp', 37, 'alola')).toBeNull();
    expect(curatedForm('bdsp', 77, 'galar')).toBeNull();
  });

  it('Legends: Arceus swaps in Hisuian forms (both Sneasels exist)', () => {
    expect(curatedForm('pla', 58, 'default')).toBeNull();
    expect(curatedForm('pla', 58, 'hisui')).toEqual({});
    expect(curatedForm('pla', 215, 'default')).toMatchObject({ method: 'wild' });
    expect(curatedForm('pla', 215, 'hisui')).toMatchObject({ method: 'wild' });
    expect(curatedForm('pla', 37, 'alola')).toBeNull(); // Kantonian Vulpix only
  });

  it('Scarlet/Violet: Indigo Disk forms with their version exclusives; transfer-only forms absent', () => {
    expect(curatedForm('sv', 37, 'alola')).toMatchObject({ versions: ['scarlet'] });
    expect(curatedForm('sv', 27, 'alola')).toMatchObject({ versions: ['violet'] });
    expect(curatedForm('sv', 128, 'paldea_aqua_breed')).toMatchObject({ versions: ['violet'] });
    expect(curatedForm('sv', 26, 'alola')).toBeNull();
    expect(curatedForm('sv', 26, 'default')).toEqual({});
    expect(curatedForm('sv', 58, 'hisui')).toBeNull();
  });

  it('only uses form slugs the seed produces and release ids that exist', () => {
    const slug = /^(default|alola|galar|hisui|paldea|paldea_(combat|blaze|aqua)_breed)$/;
    for (const [gameId, game] of Object.entries(REGIONAL_FORMS_BY_GAME)) {
      const releases = RELEASES_BY_GROUP.get(gameId) ?? [];
      for (const forms of Object.values(game)) {
        for (const [form, src] of Object.entries(forms)) {
          expect(form).toMatch(slug);
          for (const r of src.versions ?? []) expect(releases).toContain(r);
        }
      }
    }
  });
});
