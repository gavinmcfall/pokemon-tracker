import { describe, expect, it } from 'vitest';
import type { EntryWithStatus, GameOwnership, Obtainability } from '../src/types.js';
import { RELEASES_BY_GROUP, releaseForVersion } from '../src/obtainability/games.js';
import { addEvidence, emptyEvidence, versionRestriction, type RestrictionContext } from '../src/obtainability/versions.js';
import { computeObtainabilityFromSources, mostDirect } from '../src/obtainability/compute.js';
import { encounterClass } from '../src/obtainability/from-mirror.js';
import { computeAcquisitionPlan, computePlan, ownedRouteGroups, ownedRouteReleases } from '../src/planner/compute.js';

describe('releases per group + DLC version folding', () => {
  it('lists the cartridges of a paired game, services excluded', () => {
    expect(RELEASES_BY_GROUP.get('sv')).toEqual(['scarlet', 'violet']);
    expect(RELEASES_BY_GROUP.get('pla')).toEqual(['legends-arceus']);
    expect(RELEASES_BY_GROUP.has('bank')).toBe(false);
  });

  it('folds DLC versions into the cartridge they are played on', () => {
    expect(releaseForVersion('the-crown-tundra-shield')).toBe('shield');
    expect(releaseForVersion('the-teal-mask-violet')).toBe('violet');
    expect(releaseForVersion('red')).toBe('red');
    expect(releaseForVersion('colosseum')).toBeNull();
  });
});

describe('versionRestriction', () => {
  // Larvitar line (246→247→248) wild only in Scarlet; Murkrow (198) in both;
  // Honchkrow (430) evolves from Murkrow with no wild rows of its own.
  function ctx(): RestrictionContext {
    const ev = emptyEvidence();
    addEvidence(ev, 246, 'sv', 'scarlet');
    addEvidence(ev, 247, 'sv', 'scarlet');
    addEvidence(ev, 198, 'sv', 'scarlet');
    addEvidence(ev, 198, 'sv', 'violet');
    addEvidence(ev, 300, 'sv', 'violet'); // a Violet-only base form
    addEvidence(ev, 301, 'sv', 'scarlet'); // ...whose evolution is wild only in Scarlet
    addEvidence(ev, 25, 'rb', 'red');      // rb: only Red has any rows → not covered
    const pre: Record<number, number> = { 247: 246, 248: 247, 430: 198, 301: 300 };
    const members = new Set(['246:sv', '247:sv', '248:sv', '198:sv', '430:sv', '300:sv', '301:sv', '25:rb']);
    return {
      evidence: ev,
      evolvesFrom: (dex) => pre[dex] ?? null,
      inGame: (dex, gameId) => members.has(`${dex}:${gameId}`),
    };
  }

  it('restricts a species caught in only one cartridge', () => {
    expect(versionRestriction(246, 'sv', ctx())).toEqual(['scarlet']);
  });

  it('leaves a species caught in every cartridge unrestricted', () => {
    expect(versionRestriction(198, 'sv', ctx())).toBeNull();
  });

  it('evolutions inherit the pre-evolution cartridges (Tyranitar is wherever Larvitar is)', () => {
    expect(versionRestriction(248, 'sv', ctx())).toEqual(['scarlet']);
    expect(versionRestriction(430, 'sv', ctx())).toBeNull(); // Murkrow is in both
  });

  it('unions an evolution\'s own cartridges with its pre-evolution\'s', () => {
    expect(versionRestriction(301, 'sv', ctx())).toBeNull(); // evolve it in Violet, catch it in Scarlet
  });

  it('never restricts a game whose evidence does not cover every cartridge', () => {
    expect(versionRestriction(25, 'rb', ctx())).toBeNull();
  });

  it('never restricts a single-cartridge game', () => {
    const c = ctx();
    addEvidence(c.evidence, 722, 'pla', 'legends-arceus');
    expect(versionRestriction(722, 'pla', c)).toBeNull();
  });
});

describe('computeObtainabilityFromSources — versions', () => {
  const base = { dex: 246, generation: 2, hasGenderDifferences: false, hasGmaxVariety: false };

  it('carries a version restriction onto the availability entry', () => {
    const ob = computeObtainabilityFromSources({ ...base, sources: [{ gameId: 'sv', method: 'available', versions: ['scarlet'] }] });
    expect(ob.availability[0]).toMatchObject({ gameId: 'sv', versions: ['scarlet'] });
  });

  it('an unrestricted source (a curated gift) lifts the restriction', () => {
    const ob = computeObtainabilityFromSources({ ...base, sources: [
      { gameId: 'sv', method: 'available', versions: ['scarlet'] },
      { gameId: 'sv', method: 'gift' },
    ] });
    expect(ob.availability[0]!.versions).toBeUndefined();
  });
});

// ---- planner -------------------------------------------------------------

function ob(availability: Obtainability['availability']): Obtainability {
  return {
    availability, gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false, shinyLegalSomewhere: true,
    unobtainableLegit: false, genderVisualDiff: false, shinyLockedIn: [], originGames: [],
  };
}
const sv = (versions?: string[]) => ({
  gameId: 'sv', label: 'Scarlet/Violet', platform: 'switch', method: 'wild', shinyPossible: true, ...(versions ? { versions } : {}),
});
function entry(dex: number, availability: Obtainability['availability']): EntryWithStatus {
  const entryKey = `${String(dex).padStart(4, '0')}-default-male`;
  return {
    entryKey, dex, name: `mon${dex}`, formSlug: 'default', formLabel: null, gender: 'male',
    types: ['normal'], generation: 9, spriteUrl: '', isCosmetic: false, status: null, specimen: null, obtainability: ob(availability),
  };
}
const own = (gameId: string): GameOwnership => ({ gameId, methods: ['cartridge'], notes: null, updatedAt: '' });

describe('planner — version exclusives', () => {
  const shared = entry(198, [sv()]);
  const violetOnly = entry(371, [sv(['violet'])]);

  function verdicts(ownership: GameOwnership[]) {
    return computePlan({
      entries: [shared, violetOnly],
      ownedRouteGroups: ownedRouteGroups(ownership),
      ownedReleases: ownedRouteReleases(ownership),
      hasBank: false,
    });
  }

  it('a Scarlet owner cannot catch a Violet exclusive — it needs Violet', () => {
    const p = verdicts([own('scarlet')]);
    const byDex = new Map(p.species.map((s) => [s.dex, s]));
    expect(byDex.get(198)).toMatchObject({ verdict: 'ready', via: 'sv' });
    expect(byDex.get(371)).toMatchObject({ verdict: 'need-game', needs: [['violet']] });
    expect(p.acquisitions[0]).toMatchObject({ id: 'violet', label: 'Violet', kind: 'game', unlocks: 1 });
  });

  it('a Violet owner can', () => {
    const p = verdicts([own('violet')]);
    expect(p.summary).toMatchObject({ ready: 2, needGame: 0 });
  });

  it('without release ownership, exclusives are judged by group (unchanged behaviour)', () => {
    const p = computePlan({ entries: [violetOnly], ownedRouteGroups: new Set(['sv']), hasBank: false });
    expect(p.summary.ready).toBe(1);
  });
});

describe('itinerary — version exclusives', () => {
  const shared = entry(198, [sv()]);
  const violetOnly = entry(371, [sv(['violet'])]);
  const scarletOnly = entry(246, [sv(['scarlet'])]);
  const stops = (ownership: GameOwnership[], entries: EntryWithStatus[]) =>
    computeAcquisitionPlan({ entries, ownership, mode: 'cartridge-first', rank: 'fewest-games' }).steps.filter((s) => !s.prereq)
      .map((s) => ({ id: s.id, label: s.label, owned: s.owned, entryKeys: s.entryKeys }));

  it('owning Scarlet: shared species stay on your copy, the exclusive becomes a Violet stop', () => {
    expect(stops([own('scarlet')], [shared, violetOnly])).toEqual([
      { id: 'sv', label: 'Scarlet/Violet', owned: true, entryKeys: ['0198-default-male'] },
      { id: 'violet', label: 'Violet', owned: false, entryKeys: ['0371-default-male'] },
    ]);
  });

  it('owning Violet: everything is one stop on your copy', () => {
    expect(stops([own('violet')], [shared, violetOnly])).toEqual([
      { id: 'sv', label: 'Scarlet/Violet', owned: true, entryKeys: ['0198-default-male', '0371-default-male'] },
    ]);
  });

  it('owning nothing: buying one cartridge covers its exclusives and the shared species', () => {
    expect(stops([], [shared, violetOnly])).toEqual([
      { id: 'violet', label: 'Violet', owned: false, entryKeys: ['0198-default-male', '0371-default-male'] },
    ]);
  });

  it('owning both: each cartridge gets its own exclusives', () => {
    const s = stops([own('scarlet'), own('violet')], [shared, violetOnly, scarletOnly]);
    expect(s.map((x) => [x.id, x.owned, x.entryKeys.length])).toEqual(
      expect.arrayContaining([['sv', true, 1], ['violet', true, 1], ['scarlet', true, 1]]),
    );
  });
});

describe('encounter method classes', () => {
  it('maps PokéAPI encounter methods to how you obtain it', () => {
    expect(encounterClass('walk')).toBe('wild');
    expect(encounterClass('max-raid')).toBe('wild');
    expect(encounterClass('gift')).toBe('gift');
    expect(encounterClass('gift-egg')).toBe('gift');
    expect(encounterClass('npc-trade')).toBe('trade');
    expect(encounterClass('pokeflute')).toBe('static');
    expect(encounterClass('roaming-grass')).toBe('roaming');
  });

  it('the most direct method wins', () => {
    expect(mostDirect(['gift', 'wild'])).toBe('wild');
    expect(mostDirect(['trade', 'gift'])).toBe('gift');
    expect(mostDirect([])).toBe('available');
  });
});
