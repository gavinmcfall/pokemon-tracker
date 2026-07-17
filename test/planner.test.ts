import { describe, expect, it } from 'vitest';
import type { EntryWithStatus, GameOwnership, Obtainability } from '../src/types.js';
import { computePlan, hasBankFrom, ownedRouteGroups } from '../src/planner/compute.js';

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
    specimen: null,
    obtainability: opts.ob === undefined ? ob(['sv']) : opts.ob,
  };
}

const own = (gameId: string, methods: GameOwnership['methods']): GameOwnership =>
  ({ gameId, methods, notes: null, updatedAt: '' });

function verdicts(entries: EntryWithStatus[], groups: string[], hasBank: boolean) {
  const plan = computePlan({ entries, ownedRouteGroups: new Set(groups), hasBank });
  return new Map(plan.species.map((s) => [s.entryKey, s]));
}

describe('planner: ownedRouteGroups + hasBank', () => {
  it('includes HOME-legal methods, excludes romhack-only and services', () => {
    expect([...ownedRouteGroups([own('scarlet', ['cartridge'])])]).toEqual(['sv']);
    expect([...ownedRouteGroups([own('scarlet', ['emulator'])])]).toEqual(['sv']);
    // romhack alone is not a HOME-legal source
    expect([...ownedRouteGroups([own('scarlet', ['romhack'])])]).toEqual([]);
    // but romhack + a legal method counts
    expect([...ownedRouteGroups([own('scarlet', ['romhack', 'cartridge'])])]).toEqual(['sv']);
    // GO's digital method is HOME-legal
    expect([...ownedRouteGroups([own('go', ['digital'])])]).toEqual(['go']);
    // services never contribute a route group
    expect([...ownedRouteGroups([own('bank', ['subscription'])])]).toEqual([]);
  });

  it('hasBankFrom detects an active Bank subscription', () => {
    expect(hasBankFrom([own('bank', ['subscription'])])).toBe(true);
    expect(hasBankFrom([own('bank', [])])).toBe(false);
    expect(hasBankFrom([own('scarlet', ['cartridge'])])).toBe(false);
  });
});

describe('planner: per-species verdicts', () => {
  it('classifies have / unknown / event-only', () => {
    const v = verdicts([
      entry(1, { caught: true }),
      entry(2, { ob: null }),                          // no data → unknown
      entry(3, { ob: ob([]) }),                        // has data, no availability → unknown
      entry(4, { ob: ob(['ww']) }),                    // available only where transfer is unknown → unknown
      entry(5, { ob: ob(['sv'], { unobtainableLegit: true }) }),
    ], [], false);
    expect(v.get('0001-default-male')!.verdict).toBe('have');
    expect(v.get('0002-default-male')!.verdict).toBe('unknown');
    expect(v.get('0003-default-male')!.verdict).toBe('unknown');
    expect(v.get('0004-default-male')!.verdict).toBe('unknown');
    expect(v.get('0005-default-male')!.verdict).toBe('event-only');
  });

  it('native route: Ready iff you own the game', () => {
    expect(verdicts([entry(6, { ob: ob(['sv']) })], [], false).get('0006-default-male')!)
      .toMatchObject({ verdict: 'need-game', needs: [['sv']] });
    expect(verdicts([entry(6, { ob: ob(['sv']) })], ['sv'], false).get('0006-default-male')!)
      .toMatchObject({ verdict: 'ready', via: 'sv' });
  });

  it('bank route needs the game AND Bank', () => {
    const e = [entry(7, { ob: ob(['xy']) })];
    expect(verdicts(e, ['xy'], false).get('0007-default-male')!).toMatchObject({ verdict: 'need-game', needs: [['bank']] });
    expect(verdicts(e, [], true).get('0007-default-male')!).toMatchObject({ verdict: 'need-game', needs: [['xy']] });
    expect(verdicts(e, ['xy'], true).get('0007-default-male')!).toMatchObject({ verdict: 'ready', via: 'xy' });
  });

  it('chain route needs the game + Bank + intermediates (AND-of-ORs)', () => {
    const e = [entry(8, { ob: ob(['e']) })]; // Emerald: needs a Gen 4 AND a Gen 5 game
    // own Emerald + Bank but no intermediates → still blocked, missing both hops
    const blocked = verdicts(e, ['e'], true).get('0008-default-male')!;
    expect(blocked.verdict).toBe('need-game');
    expect(blocked.needs).toEqual([['dp', 'pt', 'hgss'], ['bw', 'b2w2']]);
    // own Emerald + a Gen 4 + a Gen 5 + Bank → ready
    expect(verdicts(e, ['e', 'dp', 'bw'], true).get('0008-default-male')!).toMatchObject({ verdict: 'ready', via: 'e' });
  });

  it('prefers the simplest route when a species is available several ways', () => {
    // available in Emerald (chain) and Scarlet/Violet (native); owning SV wins.
    const v = verdicts([entry(9, { ob: ob(['e', 'sv']) })], ['sv', 'e'], true).get('0009-default-male')!;
    expect(v).toMatchObject({ verdict: 'ready', via: 'sv' });
  });
});

describe('planner: acquisition optimizer', () => {
  it('ranks the single acquisitions that unlock the most (greedy, ordered)', () => {
    // 3 species need SV (native), 1 needs XY (bank). Owner has nothing, no Bank.
    const entries = [
      entry(10, { ob: ob(['sv']) }), entry(11, { ob: ob(['sv']) }), entry(12, { ob: ob(['sv']) }),
      entry(13, { ob: ob(['xy']) }),
    ];
    const plan = computePlan({ entries, ownedRouteGroups: new Set(), hasBank: false });
    expect(plan.summary).toMatchObject({ needGame: 4, ready: 0, have: 0 });
    // SV unlocks 3 immediately and should lead; the XY species needs Bank too.
    expect(plan.acquisitions[0]).toMatchObject({ id: 'sv', unlocks: 3 });
    // Bank is an infrastructure step (0 immediate) that enables the XY buy after it.
    const ids = plan.acquisitions.map((a) => a.id);
    expect(ids).toContain('bank');
    expect(ids).toContain('xy');
    // XY only counts once Bank is on
    expect(plan.acquisitions.find((a) => a.id === 'xy')!.unlocks).toBe(1);
  });

  it('with Bank already active, a bank-route game unlocks directly', () => {
    const entries = [entry(14, { ob: ob(['xy']) }), entry(15, { ob: ob(['xy']) })];
    const plan = computePlan({ entries, ownedRouteGroups: new Set(), hasBank: true });
    expect(plan.acquisitions[0]).toMatchObject({ id: 'xy', unlocks: 2 });
  });
});
