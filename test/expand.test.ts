import { describe, expect, it } from 'vitest';
import { expandSpecies, gendersFor, splitGenderSegment } from '../src/seed/expand.js';
import { bundleFor } from './helpers.js';

const keys = (speciesName: string, tier: 'species' | 'forms' | 'full' = 'full') =>
  expandSpecies(bundleFor(speciesName, tier), tier).map((e) => e.entryKey).sort();

describe('gendersFor', () => {
  it('maps gender_rate per spec §3', () => {
    expect(gendersFor(-1, 'full')).toEqual(['genderless']);
    expect(gendersFor(0, 'full')).toEqual(['male']);
    expect(gendersFor(8, 'full')).toEqual(['female']);
    expect(gendersFor(4, 'full')).toEqual(['male', 'female']);
    expect(gendersFor(1, 'full')).toEqual(['male', 'female']);
    expect(gendersFor(7, 'full')).toEqual(['male', 'female']);
  });
  it('collapses dual-gender species to one slot below full tier', () => {
    expect(gendersFor(4, 'forms')).toEqual(['male']);
    expect(gendersFor(4, 'species')).toEqual(['male']);
    expect(gendersFor(8, 'species')).toEqual(['female']);
  });
});

describe('splitGenderSegment', () => {
  it('extracts a gender segment anywhere in the slug', () => {
    expect(splitGenderSegment(['female'])).toEqual({ parts: [], gender: 'female' });
    expect(splitGenderSegment(['female', 'mega'])).toEqual({ parts: ['mega'], gender: 'female' });
    expect(splitGenderSegment(['mega', 'x'])).toEqual({ parts: ['mega', 'x'], gender: null });
  });
});

describe('expandSpecies on real PokéAPI fixtures (spec §8 edge cases)', () => {
  it('Charizard: default + megas + gmax, each in both genders; mega X gains dragon', () => {
    const entries = expandSpecies(bundleFor('charizard', 'full'), 'full');
    expect(entries.map((e) => e.entryKey).sort()).toEqual([
      '0006-default-female', '0006-default-male',
      '0006-gmax-female', '0006-gmax-male',
      '0006-mega_x-female', '0006-mega_x-male',
      '0006-mega_y-female', '0006-mega_y-male',
    ]);
    const megaX = entries.find((e) => e.entryKey === '0006-mega_x-male')!;
    expect(megaX).toMatchObject({
      dex: 6,
      name: 'Charizard',
      formSlug: 'mega_x',
      formLabel: 'Mega Charizard X',
      gender: 'male',
      types: ['fire', 'dragon'],
      generation: 1,
      isCosmetic: false,
    });
    expect(megaX.spriteUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//);
    const defaultMale = entries.find((e) => e.entryKey === '0006-default-male')!;
    expect(defaultMale.formLabel).toBeNull();
    expect(defaultMale.types).toEqual(['fire', 'flying']);
  });

  it('Nidoran lines are two species with single-gender entries', () => {
    expect(keys('nidoran-f')).toEqual(['0029-default-female']);
    expect(keys('nidoran-m')).toEqual(['0032-default-male']);
  });

  it('female-only lines: Chansey, Jynx; Kangaskhan mega stays female-only', () => {
    expect(keys('chansey')).toEqual(['0113-default-female']);
    expect(keys('jynx')).toEqual(['0124-default-female']);
    expect(keys('kangaskhan')).toEqual(['0115-default-female', '0115-mega-female']);
  });

  it('genderless legendary: Mewtwo and its megas', () => {
    expect(keys('mewtwo')).toEqual([
      '0150-default-genderless', '0150-mega_x-genderless', '0150-mega_y-genderless',
    ]);
  });

  it('Rotom: six genderless battle forms, not cosmetic', () => {
    const entries = expandSpecies(bundleFor('rotom', 'full'), 'full');
    expect(entries.map((e) => e.entryKey).sort()).toEqual([
      '0479-default-genderless', '0479-fan-genderless', '0479-frost-genderless',
      '0479-heat-genderless', '0479-mow-genderless', '0479-wash-genderless',
    ]);
    expect(entries.every((e) => !e.isCosmetic)).toBe(true);
    const heat = entries.find((e) => e.formSlug === 'heat')!;
    expect(heat.types).toEqual(['electric', 'fire']);
  });

  it('Deoxys: default variety named deoxys-normal still gets formSlug "default"', () => {
    expect(keys('deoxys')).toEqual([
      '0386-attack-genderless', '0386-default-genderless',
      '0386-defense-genderless', '0386-speed-genderless',
    ]);
  });

  it('Unown: 28 cosmetic letter forms, genderless', () => {
    const entries = expandSpecies(bundleFor('unown', 'full'), 'full');
    expect(entries).toHaveLength(28);
    expect(entries.every((e) => e.isCosmetic && e.gender === 'genderless')).toBe(true);
    const slugs = entries.map((e) => e.formSlug);
    expect(slugs).toContain('a');
    expect(slugs).toContain('exclamation');
    expect(slugs).toContain('question');
    expect(slugs).not.toContain('default');
  });

  it('Vivillon: 20 patterns × 2 genders, all cosmetic, Poké Ball pattern listed', () => {
    const entries = expandSpecies(bundleFor('vivillon', 'full'), 'full');
    expect(entries).toHaveLength(40);
    expect(entries.every((e) => e.isCosmetic)).toBe(true);
    expect(entries.filter((e) => e.formSlug === 'poke_ball')).toHaveLength(2);
    const fancy = entries.find((e) => e.entryKey === '0666-fancy-male')!;
    expect(fancy.formLabel).toBe('Fancy Vivillon');
    // pattern sprite, not the generic female sprite, for female entries
    const fancyFemale = entries.find((e) => e.entryKey === '0666-fancy-female')!;
    expect(fancyFemale.spriteUrl).toContain('fancy');
  });

  it('Furfrou: natural + 9 trims, cosmetic', () => {
    const entries = expandSpecies(bundleFor('furfrou', 'full'), 'full');
    expect(entries).toHaveLength(20);
    expect(entries.every((e) => e.isCosmetic)).toBe(true);
    expect(new Set(entries.map((e) => e.formSlug)).size).toBe(10);
  });

  it('Alcremie: 63 female cream×sweet decorations + gmax', () => {
    const entries = expandSpecies(bundleFor('alcremie', 'full'), 'full');
    expect(entries).toHaveLength(64);
    expect(entries.every((e) => e.gender === 'female')).toBe(true);
    expect(entries.filter((e) => e.isCosmetic)).toHaveLength(63);
    expect(entries.find((e) => e.formSlug === 'gmax')).toBeDefined();
  });

  it('Meowstic: gender varieties collapse to default male/female; megas keep gender', () => {
    expect(keys('meowstic')).toEqual([
      '0678-default-female', '0678-default-male',
      '0678-mega-female', '0678-mega-male',
    ]);
    const entries = expandSpecies(bundleFor('meowstic', 'full'), 'full');
    const defaults = entries.filter((e) => e.formSlug === 'default');
    expect(defaults.every((e) => e.formLabel === null)).toBe(true);
    const male = defaults.find((e) => e.gender === 'male')!;
    const female = defaults.find((e) => e.gender === 'female')!;
    expect(male.spriteUrl).not.toBe(female.spriteUrl);
  });

  it('Basculegion: male/female varieties become gendered default entries', () => {
    expect(keys('basculegion')).toEqual(['0902-default-female', '0902-default-male']);
  });

  it('Frillish: gendered default variety name without a counterpart expands both genders', () => {
    expect(keys('frillish')).toEqual(['0592-default-female', '0592-default-male']);
  });

  it('Cherrim: battle-only Sunshine form is not a collectible slot', () => {
    expect(keys('cherrim')).toEqual(['0421-default-female', '0421-default-male']);
  });

  it('Mimikyu: battle-only Busted sibling form collapses to default (varieties still included)', () => {
    const slugs = new Set(expandSpecies(bundleFor('mimikyu', 'full'), 'full').map((e) => e.formSlug));
    expect(slugs.has('default')).toBe(true);
    expect(slugs.has('mimikyu_busted')).toBe(false);
  });

  it('Arceus: plates change type, so they are not cosmetic', () => {
    const entries = expandSpecies(bundleFor('arceus', 'full'), 'full');
    const fire = entries.find((e) => e.formSlug === 'fire')!;
    expect(fire.types).toEqual(['fire']);
    expect(fire.isCosmetic).toBe(false);
    const normal = entries.find((e) => e.formSlug === 'normal')!;
    expect(normal.isCosmetic).toBe(true); // same type as base
  });

  it('Minior: default meteor variety plus colored meteors and cores', () => {
    const entries = expandSpecies(bundleFor('minior', 'full'), 'full');
    expect(entries.find((e) => e.formSlug === 'default')).toBeDefined();
    expect(entries.find((e) => e.formSlug === 'red')).toBeDefined();
    expect(entries.every((e) => e.gender === 'genderless')).toBe(true);
  });

  it('tier=species keeps only the default form of form-heavy species', () => {
    expect(keys('vivillon', 'species')).toEqual(['0666-default-male']);
    expect(keys('charizard', 'species')).toEqual(['0006-default-male']);
    expect(keys('rotom', 'species')).toEqual(['0479-default-genderless']);
  });

  it('tier=forms expands forms but not genders', () => {
    const entries = expandSpecies(bundleFor('charizard', 'forms'), 'forms');
    expect(entries.map((e) => e.entryKey).sort()).toEqual([
      '0006-default-male', '0006-gmax-male', '0006-mega_x-male', '0006-mega_y-male',
    ]);
  });

  it('Pikachu: costume varieties are included at forms/full tier', () => {
    const slugs = new Set(expandSpecies(bundleFor('pikachu', 'full'), 'full').map((e) => e.formSlug));
    expect(slugs.has('libre')).toBe(true);
    expect(slugs.has('gmax')).toBe(true);
  });

  it('entry keys are unique within every fixture species at every tier', () => {
    for (const tier of ['species', 'forms', 'full'] as const) {
      for (const sp of ['charizard', 'unown', 'vivillon', 'alcremie', 'meowstic', 'minior', 'pikachu', 'arceus']) {
        const list = expandSpecies(bundleFor(sp, tier), tier).map((e) => e.entryKey);
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it('every entry has a sprite URL and at least one type', () => {
    for (const sp of ['charizard', 'unown', 'vivillon', 'alcremie', 'meowstic', 'minior', 'pikachu']) {
      for (const e of expandSpecies(bundleFor(sp, 'full'), 'full')) {
        expect(e.spriteUrl).toMatch(/^https:\/\//);
        expect(e.types.length).toBeGreaterThan(0);
      }
    }
  });
});
