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
    status: opts.caught ? { entryKey, caught: true, caughtAt: null, gameOrigin: null, method: null, notes: null } : null,
    specimen: null, obtainability: opts.ob === undefined ? ob(['sv']) : opts.ob,
  };
}
const own = (gameId: string, methods: GameOwnership['methods']): GameOwnership =>
  ({ gameId, methods, notes: null, updatedAt: '' });

describe('ownedRouteGroupsForMode', () => {
  it('only-modes ignore the other physical form; first-modes keep both', () => {
    const owner = [own('scarlet', ['cartridge']), own('violet', ['emulator'])];
    expect([...ownedRouteGroupsForMode(owner, 'cartridge-only')]).toEqual(['sv']); // both map to sv; cartridge present
    expect([...ownedRouteGroupsForMode(owner, 'emulator-only')]).toEqual(['sv']);
    // a game held only as emulator is dropped in cartridge-only
    expect([...ownedRouteGroupsForMode([own('x', ['emulator'])], 'cartridge-only')]).toEqual([]);
    expect([...ownedRouteGroupsForMode([own('x', ['emulator'])], 'emu-first')]).toEqual(['xy']);
    // romhack never counts
    expect([...ownedRouteGroupsForMode([own('x', ['romhack'])], 'cartridge-first')]).toEqual([]);
  });
});

describe('computeAcquisitionPlan', () => {
  const plan = (entries: EntryWithStatus[], ownership: GameOwnership[], mode: AcquireMode = 'emu-first', rank: AcquireRank = 'fewest-games') =>
    computeAcquisitionPlan({ entries, ownership, mode, rank });

  it('separates already-ready, leftover, and the shopping list', () => {
    const p = plan([
      entry(1, { caught: true }),                       // not missing
      entry(2, { ob: ob(['sv']) }),                     // native → need SV
      entry(3, { ob: ob(['sv']) }),                     // native → need SV (same game)
      entry(4, { ob: null }),                           // no data → leftover
      entry(5, { ob: ob(['sv'], { unobtainableLegit: true }) }), // event-only → leftover
      entry(6, { ob: ob(['ww']) }),                     // unknown transfer → leftover
    ], []);
    expect(p.missingTotal).toBe(5);
    expect(p.alreadyReady).toBe(0);
    expect(p.covered).toBe(2);
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ id: 'sv', via: 'emulator', unlocks: 2 });
    expect(p.leftover.map((l) => l.reason).sort()).toEqual(['event-only', 'no data', 'no known route']);
  });

  it('counts what you already own as ready (no acquisition)', () => {
    const p = plan([entry(2, { ob: ob(['sv']) })], [own('scarlet', ['cartridge'])]);
    expect(p.alreadyReady).toBe(1);
    expect(p.steps).toHaveLength(0);
  });

  it('mode drives the acquisition method (via)', () => {
    const e = [entry(2, { ob: ob(['sv']) })];
    expect(plan(e, [], 'cartridge-only').steps[0]!.via).toBe('cartridge');
    expect(plan(e, [], 'emulator-only').steps[0]!.via).toBe('emulator');
    expect(plan(e, [], 'cartridge-first').steps[0]!.via).toBe('cartridge');
  });

  it('cartridge-only ignores an emulator-owned game and re-lists it as a cartridge buy', () => {
    const e = [entry(2, { ob: ob(['sv']) })];
    // owns SV only via emulator: fine in emu-first, but cartridge-only won't count it
    expect(plan(e, [own('scarlet', ['emulator'])], 'emu-first').steps).toHaveLength(0);
    const cart = plan(e, [own('scarlet', ['emulator'])], 'cartridge-only');
    expect(cart.alreadyReady).toBe(0);
    expect(cart.steps[0]).toMatchObject({ id: 'sv', via: 'cartridge' });
  });

  it('covers a Bank-gated chain species by acquiring game + intermediates + Bank', () => {
    // available only in Emerald (chain: needs a Gen 4 + Gen 5 game + Bank)
    const p = plan([entry(7, { ob: ob(['e']) })], []);
    expect(p.covered).toBe(1);
    const ids = p.steps.map((s) => s.id);
    expect(ids).toContain('e');
    expect(ids).toContain('bank');
    expect(ids.some((id) => ['dp', 'pt', 'hgss'].includes(id))).toBe(true); // a Gen 4 game
    expect(ids.some((id) => ['bw', 'b2w2'].includes(id))).toBe(true);        // a Gen 5 game
    expect(p.leftover.filter((l) => l.reason === 'needs more')).toHaveLength(0);
  });

  it('rank=oldest-gen orders the shopping list by generation', () => {
    // one species in Red/Blue (gen 1, bank) and one in Scarlet/Violet (gen 9, native)
    const p = plan([entry(8, { ob: ob(['rb']) }), entry(9, { ob: ob(['sv']) })], [], 'emu-first', 'oldest-gen');
    const gens = p.steps.filter((s) => s.id !== 'bank').map((s) => s.generation);
    expect(gens).toEqual([...gens].sort((a, b) => a - b));
  });
});
