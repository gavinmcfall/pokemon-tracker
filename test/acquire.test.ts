import { describe, expect, it } from 'vitest';
import type { EntryWithStatus, GameOwnership, Obtainability } from '../src/types.js';
import { computeAcquisitionPlan, ownedRouteGroupsForMode, type AcquireMode, type AcquireRank } from '../src/planner/compute.js';

function ob(gameIds: string[], over: Partial<Obtainability> = {}): Obtainability {
  return {
    availability: gameIds.map((gameId) => ({ gameId, label: gameId, platform: 'x', method: 'wild', shinyPossible: true })),
    gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false, shinyLegalSomewhere: true,
    unobtainableLegit: false, genderVisualDiff: false, shinyLockedIn: [], originGames: [], ...over,
  };
}
function entry(dex: number, opts: { caught?: boolean; ob?: Obtainability | null } = {}): EntryWithStatus {
  const entryKey = `${String(dex).padStart(4, '0')}-default-male`;
  return {
    entryKey, dex, name: `mon${dex}`, formSlug: 'default', formLabel: null, gender: 'male',
    types: ['normal'], generation: 1, spriteUrl: '', isCosmetic: false,
    status: opts.caught ? { entryKey, caught: true, caughtAt: null, gameOrigin: null, method: null, notes: null, inHome: true } : null,
    specimen: null, obtainability: opts.ob === undefined ? ob(['sv']) : opts.ob,
  };
}
const own = (gameId: string, methods: GameOwnership['methods']): GameOwnership =>
  ({ gameId, methods, notes: null, updatedAt: '' });
const plan = (entries: EntryWithStatus[], ownership: GameOwnership[], mode: AcquireMode = 'emu-first', rank: AcquireRank = 'fewest-games') =>
  computeAcquisitionPlan({ entries, ownership, mode, rank });
const catchStops = (p: ReturnType<typeof plan>) => p.steps.filter((s) => !s.prereq);

describe('ownedRouteGroupsForMode', () => {
  it('only-modes ignore the other physical form; first-modes keep both', () => {
    const owner = [own('scarlet', ['cartridge']), own('violet', ['emulator'])];
    expect([...ownedRouteGroupsForMode(owner, 'cartridge-only')]).toEqual(['sv']);
    expect([...ownedRouteGroupsForMode([own('x', ['emulator'])], 'cartridge-only')]).toEqual([]);
    expect([...ownedRouteGroupsForMode([own('x', ['emulator'])], 'emu-first')]).toEqual(['xy']);
    expect([...ownedRouteGroupsForMode([own('x', ['romhack'])], 'cartridge-first')]).toEqual([]);
  });
});

describe('computeAcquisitionPlan — completion itinerary', () => {
  it('groups species into an ordered set of catch stops, with leftover reasons', () => {
    const p = plan([
      entry(1, { caught: true }),                        // not missing
      entry(2, { ob: ob(['sv']) }),                      // catch in SV
      entry(3, { ob: ob(['sv']) }),                      // catch in SV (same stop)
      entry(4, { ob: null }),                            // no data → leftover
      entry(5, { ob: ob(['sv'], { unobtainableLegit: true }) }), // event-only
      entry(6, { ob: ob(['ww']) }),                      // unknown transfer → leftover
    ], []);
    expect(p.missingTotal).toBe(5);
    expect(p.coverable).toBe(2);
    const stops = catchStops(p);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ id: 'sv', catchCount: 2, owned: false, via: 'emulator' });
    expect(stops[0]!.entryKeys).toEqual(['0002-default-male', '0003-default-male']);
    expect(p.leftover.map((l) => l.reason).sort()).toEqual(['event-only', 'no data', 'no known route']);
  });

  it('games you own are still stops — flagged owned, no acquisition', () => {
    const p = plan([entry(2, { ob: ob(['sv']) })], [own('scarlet', ['cartridge'])]);
    const stops = catchStops(p);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ id: 'sv', owned: true, via: null, catchCount: 1 });
  });

  it('mode drives the acquisition method (via) for stops you do not own', () => {
    const e = [entry(2, { ob: ob(['sv']) })];
    expect(catchStops(plan(e, [], 'cartridge-only'))[0]!.via).toBe('cartridge');
    expect(catchStops(plan(e, [], 'emulator-only'))[0]!.via).toBe('emulator');
    expect(catchStops(plan(e, [], 'cartridge-first'))[0]!.via).toBe('cartridge');
  });

  it('cartridge-only ignores an emulator-owned copy (stop becomes a cartridge buy)', () => {
    const e = [entry(2, { ob: ob(['sv']) })];
    expect(catchStops(plan(e, [own('scarlet', ['emulator'])], 'emu-first'))[0]).toMatchObject({ owned: true });
    expect(catchStops(plan(e, [own('scarlet', ['emulator'])], 'cartridge-only'))[0]).toMatchObject({ owned: false, via: 'cartridge' });
  });

  it('prefers the simplest tier: a species in both a chain game and a native game is caught natively', () => {
    const p = plan([entry(7, { ob: ob(['e', 'sv']) })], []); // Emerald (chain) + Scarlet/Violet (native)
    const stops = catchStops(p);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.id).toBe('sv');
    expect(p.steps.some((s) => s.prereq)).toBe(false); // no Bank needed
  });

  it('a chain-only species adds Bank + a Gen 4 + a Gen 5 prereq before its catch stop', () => {
    const p = plan([entry(8, { ob: ob(['e']) })], []); // only in Emerald
    expect(catchStops(p).map((s) => s.id)).toEqual(['e']);
    const prereqIds = p.steps.filter((s) => s.prereq).map((s) => s.id);
    expect(prereqIds).toContain('bank');
    expect(prereqIds.some((id) => ['dp', 'pt', 'hgss'].includes(id))).toBe(true);
    expect(prereqIds.some((id) => ['bw', 'b2w2'].includes(id))).toBe(true);
    expect(p.coverable).toBe(1);
  });

  it('rank=oldest-gen orders the catch stops by generation', () => {
    const p = plan([entry(9, { ob: ob(['rb']) }), entry(10, { ob: ob(['sv']) })], [], 'emu-first', 'oldest-gen');
    const gens = catchStops(p).map((s) => s.generation);
    expect(gens).toEqual([...gens].sort((a, b) => a - b));
  });
});
