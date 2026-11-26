import { describe, expect, it } from 'vitest';
import type { AvailabilityEntry, Obtainability } from '../src/types.js';
import { applyPokepc, pokepcAvailability } from '../src/obtainability/pokepc.js';
import { pokepcSlugs, speciesPrefix } from '../src/obtainability/pokepc-slugs.js';
import { POKEPC_RECORDS } from '../src/obtainability/pokepc-data.js';
import { RELEASE_BY_ID } from '../src/obtainability/games.js';

function entry(gameId: string, method: string, extra: Partial<AvailabilityEntry> = {}): AvailabilityEntry {
  return { gameId, label: gameId, platform: 'ds', method, shinyPossible: true, ...extra };
}

function ob(availability: AvailabilityEntry[], extra: Partial<Obtainability> = {}): Obtainability {
  return {
    availability, gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false, shinyLegalSomewhere: true,
    unobtainableLegit: false, genderVisualDiff: false, shinyLockedIn: [], originGames: [], evolveFrom: null, ...extra,
  };
}

const games = (o: Obtainability) => o.availability.map((a) => a.gameId);
const game = (o: Obtainability, id: string) => o.availability.find((a) => a.gameId === id);

describe('pokepc slugs', () => {
  it('strips the prefix every record of the species shares', () => {
    expect(speciesPrefix(['minior', 'minior-red', 'minior-blue'])).toBe('minior');
    expect(speciesPrefix(['mr-mime'])).toBe('mr-mime');
    expect(pokepcSlugs('tauros', 'tauros-paldea-blaze-breed', false)).toEqual({ slug: 'paldea_blaze_breed', alias: null });
    expect(pokepcSlugs('unown', 'unown-a', true)).toEqual({ slug: 'a', alias: 'default' });
    expect(pokepcSlugs('mr-mime', 'mr-mime', true)).toEqual({ slug: 'default', alias: null });
  });

  it('vendored data uses only known release ids', () => {
    for (const [native, event] of Object.values(POKEPC_RECORDS)) {
      for (const r of `${native} ${event}`.split(' ').filter(Boolean)) expect(RELEASE_BY_ID.has(r), r).toBe(true);
    }
  });

  it('matches the tracker slug for split species and the Eternal Floette clash', () => {
    expect(POKEPC_RECORDS['201:a']).toBeDefined(); // Unown A
    expect(POKEPC_RECORDS['412:plant']).toBeDefined(); // Burmy
    expect(POKEPC_RECORDS['648:default']).toBeDefined(); // Aria Meloetta
    expect(POKEPC_RECORDS['670:eternal']).not.toEqual(POKEPC_RECORDS['670:red']);
  });
});

describe('pokepcAvailability', () => {
  it('applies POKEPC_CORRECTIONS: Paldean Tauros breeds are version exclusives', () => {
    expect(pokepcAvailability(128, 'paldea_blaze_breed')?.native.get('sv')).toEqual(['scarlet']);
    expect(pokepcAvailability(128, 'paldea_aqua_breed')?.native.get('sv')).toEqual(['violet']);
  });

  it('is null for forms pokepc has no record of', () => {
    expect(pokepcAvailability(25, 'cosplay')).toBeNull();
  });
});

describe('applyPokepc', () => {
  it('drops regional-dex listings that are not obtainable (Mewtwo is in the Johto dex)', () => {
    const out = applyPokepc(150, 'default', ob([entry('rb', 'static', { locations: ['Cerulean Cave'] }), entry('gs', 'available')]));
    expect(games(out)).not.toContain('gs');
    expect(game(out, 'rb')).toMatchObject({ method: 'static', locations: ['Cerulean Cave'] });
  });

  it('adds games the mirror missed, as evolve when the pre-evolution is native there', () => {
    const out = applyPokepc(471, 'default', ob([entry('pt', 'available'), entry('swsh', 'wild')], { evolveFrom: { dex: 133, name: 'eevee', trade: false } }));
    expect(game(out, 'dp')).toMatchObject({ method: 'evolve' });
    expect(game(out, 'pt')).toMatchObject({ method: 'evolve' }); // the dex listing knew no method
    expect(game(out, 'swsh')).toMatchObject({ method: 'wild' }); // a known method stays
    expect(game(out, 'go')).toMatchObject({ method: 'evolve' });
  });

  it('adds games as available when nothing evolves into the form there', () => {
    expect(game(applyPokepc(150, 'default', ob([])), 'hgss')).toMatchObject({ method: 'available' });
    const eternal = applyPokepc(670, 'eternal', ob([], { evolveFrom: { dex: 669, name: 'flabebe', trade: false } }));
    expect(game(eternal, 'za')).toMatchObject({ method: 'available' });
  });

  it('restricts version exclusives to their cartridges', () => {
    const out = applyPokepc(1007, 'default', ob([entry('sv', 'static')]));
    expect(game(out, 'sv')).toMatchObject({ versions: ['scarlet'] });
    expect(out.teraAvailable).toBe(true);
    expect(out.catchableOnSwitch).toBe(true);
  });

  it('a mythical with a permanent GO route is obtainable; one with only events is not', () => {
    const victini = applyPokepc(494, 'default', ob([], { unobtainableLegit: true }));
    expect(games(victini)).toEqual(['go']);
    expect(victini.unobtainableLegit).toBe(false);
    const pecharunt = applyPokepc(1025, 'default', ob([entry('sv', 'event')]));
    expect(pecharunt.availability).toEqual([]);
    expect(pecharunt.unobtainableLegit).toBe(true);
  });

  it('marks forms HOME cannot store: fusions and held-item forms live in a save, battle-only ones in the games that trigger them', () => {
    const black = applyPokepc(646, 'black', ob([entry('bw', 'available')]));
    expect(black.keptIn?.kind).toBe('save');
    expect(black.keptIn?.releases).toEqual(expect.arrayContaining(['sword', 'shield', 'scarlet', 'violet']));
    expect(games(black)).toEqual(expect.arrayContaining(['swsh', 'sv']));
    const sunny = applyPokepc(351, 'sunny', ob([]));
    expect(sunny.keptIn?.kind).toBe('battle');
    expect(sunny.keptIn?.releases).toEqual(expect.arrayContaining(['brilliant-diamond', 'go']));
    expect(sunny.catchableOnSwitch).toBe(true);
    const absol = applyPokepc(359, 'mega_z', ob([entry('xy', 'available')]));
    expect(games(absol)).toEqual(['za']);
    expect(applyPokepc(1, 'default', ob([])).keptIn).toBeNull();
  });

  it('FireRed/LeafGreen on Switch shares the GBA game, which has no ticket legendaries', () => {
    const lugia = applyPokepc(249, 'default', ob([entry('frlg', 'static', { locations: ['Navel Rock'] })]));
    expect(game(lugia, 'frlg')).toBeUndefined();
    expect(game(lugia, 'frlg-switch')).toMatchObject({ method: 'static', locations: ['Navel Rock'], platform: 'switch' });
    expect(game(applyPokepc(386, 'attack', ob([])), 'frlg-switch')).toMatchObject({ versions: ['firered-switch'] });
  });

  it('leaves event-only forms, unknown forms and games pokepc does not cover alone', () => {
    const cap = ob([], { unobtainableLegit: true });
    expect(applyPokepc(25, 'original_cap', cap)).toBe(cap);
    const cosplay = ob([entry('oras', 'gift')]);
    expect(applyPokepc(25, 'cosplay', cosplay)).toBe(cosplay);
    expect(games(applyPokepc(6, 'default', ob([entry('ww', 'wild')])))).toContain('ww');
  });
});
