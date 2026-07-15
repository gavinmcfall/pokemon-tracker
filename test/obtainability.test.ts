import { describe, expect, it } from 'vitest';
import type { RawChainLink } from '../src/seed/pokeapi.js';
import { chainAncestors, computeObtainability, ownDirectlyObtainableGames } from '../src/obtainability/compute.js';

// Charmander → Charmeleon → Charizard
const charizardChain: RawChainLink = {
  species: { name: 'charmander', url: '' },
  evolves_to: [
    { species: { name: 'charmeleon', url: '' }, evolves_to: [
      { species: { name: 'charizard', url: '' }, evolves_to: [] },
    ] },
  ],
};

// Eevee → (branching) Vaporeon / Jolteon
const eeveeChain: RawChainLink = {
  species: { name: 'eevee', url: '' },
  evolves_to: [
    { species: { name: 'vaporeon', url: '' }, evolves_to: [] },
    { species: { name: 'jolteon', url: '' }, evolves_to: [] },
  ],
};

describe('chainAncestors', () => {
  it('returns the ancestors on a linear chain', () => {
    expect(chainAncestors(charizardChain, 'charizard')).toEqual(['charmander', 'charmeleon']);
    expect(chainAncestors(charizardChain, 'charmeleon')).toEqual(['charmander']);
    expect(chainAncestors(charizardChain, 'charmander')).toEqual([]);
  });
  it('follows the correct branch on a branching chain', () => {
    expect(chainAncestors(eeveeChain, 'vaporeon')).toEqual(['eevee']);
    expect(chainAncestors(eeveeChain, 'jolteon')).toEqual(['eevee']);
    expect(chainAncestors(eeveeChain, 'eevee')).toEqual([]);
  });
  it('returns empty for a species not in the chain', () => {
    expect(chainAncestors(charizardChain, 'pikachu')).toEqual([]);
  });
});

describe('ownDirectlyObtainableGames', () => {
  it('unions wild encounters with curated static + gift (so descendants inherit them)', () => {
    // Chespin (650) is a Kalos starter gift; Zacian (888) is a Galar static.
    expect([...ownDirectlyObtainableGames(650, [])]).toEqual(['xy']);
    expect([...ownDirectlyObtainableGames(888, [])]).toEqual(['swsh']);
    // merges with wild games; a mon with no curation returns just its wild games
    expect([...ownDirectlyObtainableGames(650, ['sv'])].sort()).toEqual(['sv', 'xy']);
    expect([...ownDirectlyObtainableGames(19, ['rb'])]).toEqual(['rb']);
  });
});

describe('computeObtainability', () => {
  it('wild + evolution-derived availability, deduped with the most direct method winning', () => {
    const o = computeObtainability({
      dex: 6, generation: 1, hasGenderDifferences: false, hasGmaxVariety: true,
      ownWildGameIds: ['lgpe'],              // Charizard is wild-catchable only in Let's Go
      evolvedFromGameIds: ['rb', 'lgpe'],    // reachable by evolving Charmander in RB + LGPE
    });
    const byGame = Object.fromEntries(o.availability.map((a) => [a.gameId, a.method]));
    expect(byGame).toEqual({ rb: 'evolve', lgpe: 'wild' }); // lgpe: wild beats evolve
    expect(o.gmaxCapable).toBe(true);
    expect(o.catchableOnSwitch).toBe(true);       // lgpe is a Switch game
    expect(o.availability.map((a) => a.gameId)).toEqual(['rb', 'lgpe']); // release order
  });

  it('gmax/tera/switch flags reflect the availability set', () => {
    const swsh = computeObtainability({
      dex: 200, generation: 8, hasGenderDifferences: false, hasGmaxVariety: false,
      ownWildGameIds: ['swsh'], evolvedFromGameIds: [],
    });
    expect(swsh.catchableOnSwitch).toBe(true);
    expect(swsh.teraAvailable).toBe(false);
    const sv = computeObtainability({
      dex: 999, generation: 9, hasGenderDifferences: false, hasGmaxVariety: false,
      ownWildGameIds: ['sv'], evolvedFromGameIds: [],
    });
    expect(sv.teraAvailable).toBe(true);
  });

  it('static/gift curation fills mons with no wild encounters (Galar box legendary)', () => {
    const zacian = computeObtainability({
      dex: 888, generation: 8, hasGenderDifferences: false, hasGmaxVariety: false,
      ownWildGameIds: [], evolvedFromGameIds: [],
    });
    expect(zacian.availability).toEqual([
      { gameId: 'swsh', label: 'Sword/Shield', platform: 'switch', method: 'static', shinyPossible: false },
    ]);
    expect(zacian.shinyLockedIn).toEqual(['swsh']); // shiny-locked in swsh per curation
  });

  it('shiny-locked-everywhere species is never shinyPossible and flags shinyLegalSomewhere=false', () => {
    const zarude = computeObtainability({
      dex: 893, generation: 8, hasGenderDifferences: false, hasGmaxVariety: false,
      ownWildGameIds: ['swsh'], evolvedFromGameIds: [],
    });
    expect(zarude.shinyLegalSomewhere).toBe(false);
    expect(zarude.availability.every((a) => !a.shinyPossible)).toBe(true);
  });

  it('genderVisualDiff and originGames come through', () => {
    const o = computeObtainability({
      dex: 3, generation: 1, hasGenderDifferences: true, hasGmaxVariety: false,
      ownWildGameIds: ['rb'], evolvedFromGameIds: [],
    });
    expect(o.genderVisualDiff).toBe(true);
    expect(o.originGames).toEqual(['rb', 'yellow']); // all gen-1 games
  });

  it('ignores unmapped gameIds', () => {
    const o = computeObtainability({
      dex: 1, generation: 1, hasGenderDifferences: false, hasGmaxVariety: false,
      ownWildGameIds: ['colosseum', 'rb'], evolvedFromGameIds: [],
    });
    expect(o.availability.map((a) => a.gameId)).toEqual(['rb']);
  });
});
