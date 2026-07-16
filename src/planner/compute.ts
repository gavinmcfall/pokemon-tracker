import type { EntryWithStatus, GameOwnership, OwnershipMethod } from '../types.js';
import { BANK_RELEASE_ID, GAME_BY_ID, RELEASE_BY_ID } from '../obtainability/games.js';
import { transferFor, type TransferInfo } from '../obtainability/transfer.js';

export type { GameOwnership };

/**
 * Living-dex planner. For every species it decides how (or whether) you can get
 * it into Pokémon HOME given the games you own + your Bank status, and — across
 * everything you can't yet reach — which acquisitions would unlock the most.
 *
 * Routing rule (HOME-legal only): a game owned solely via romhack does NOT count
 * as a route — romhack captures can't legitimately reach HOME. Bank gates every
 * pre-Switch route. Anything whose transfer route is `unknown`/`none` is never
 * called Ready — we never guess a path that may not exist.
 */

export type Verdict = 'have' | 'ready' | 'need-game' | 'unknown' | 'event-only';

/** Methods that count as a legitimate HOME source (romhack + subscription excluded). */
export const HOME_LEGAL_METHODS: OwnershipMethod[] = ['cartridge', 'emulator', 'digital'];

export interface SpeciesPlan {
  entryKey: string;
  dex: number;
  verdict: Verdict;
  /** For `ready`: the version-group used and its human route to HOME. */
  via?: string;
  route?: string;
  /**
   * For `need-game`: the minimal acquisitions to make a route work, as an
   * AND-of-ORs — each inner array is "acquire ANY one of these". Ids are
   * version-group gameIds, or 'bank' for the Pokémon Bank service.
   */
  needs?: string[][];
}

export interface PlanSummary {
  have: number;
  ready: number;
  needGame: number;
  unknown: number;
  eventOnly: number;
  total: number;
}

export interface Acquisition {
  id: string; // version-group gameId, or 'bank'
  label: string;
  kind: 'game' | 'service';
  /** How many still-blocked species this step flips to Ready (in sequence). */
  unlocks: number;
}

export interface Plan {
  species: SpeciesPlan[];
  summary: PlanSummary;
  /** Greedy ordered buy-list: the next games/services that unlock the most. */
  acquisitions: Acquisition[];
}

export interface PlanInput {
  entries: EntryWithStatus[];
  /** Version-groups owned via a HOME-legal method (see ownedRouteGroups). */
  ownedRouteGroups: Iterable<string>;
  hasBank: boolean;
}

/** Version-groups reachable as a HOME-legal source from the owner's games. */
export function ownedRouteGroups(ownership: GameOwnership[]): Set<string> {
  const groups = new Set<string>();
  for (const o of ownership) {
    if (!o.methods.some((m) => HOME_LEGAL_METHODS.includes(m))) continue;
    const release = RELEASE_BY_ID.get(o.gameId);
    if (release && release.platform !== 'service') groups.add(release.versionGroup);
  }
  return groups;
}

/** Is the Bank service active (owned via subscription)? */
export function hasBankFrom(ownership: GameOwnership[]): boolean {
  return ownership.some((o) => o.gameId === BANK_RELEASE_ID && o.methods.length > 0);
}

/** Can this route be completed right now with the given owned groups + Bank? */
function routeComplete(info: TransferInfo, owned: Set<string>, bank: boolean): boolean {
  if (!owned.has(info.gameId)) return false;
  switch (info.reach) {
    case 'native':
    case 'go':
      return true;
    case 'bank':
      return bank;
    case 'chain':
      return bank && info.requiresGames.every((hop) => hop.some((g) => owned.has(g)));
    default: // unknown | none — never a completable route
      return false;
  }
}

/**
 * What's still missing to complete this route, as an AND-of-ORs — or null if the
 * route can never be completed by acquiring things (unknown/none transfer).
 */
function routeMissing(info: TransferInfo, owned: Set<string>, bank: boolean): string[][] | null {
  if (info.reach === 'unknown' || info.reach === 'none') return null;
  const missing: string[][] = [];
  if (!owned.has(info.gameId)) missing.push([info.gameId]);
  if ((info.reach === 'bank' || info.reach === 'chain') && !bank) missing.push([BANK_RELEASE_ID]);
  if (info.reach === 'chain') {
    for (const hop of info.requiresGames) if (!hop.some((g) => owned.has(g))) missing.push(hop);
  }
  return missing;
}

// Most-direct transfer wins when a species is available more than one usable way.
const REACH_RANK: Record<string, number> = { native: 0, go: 1, bank: 2, chain: 3 };

interface Routable { entryKey: string; gameIds: string[] }

export function computePlan(input: PlanInput): Plan {
  const owned = new Set(input.ownedRouteGroups);
  const bank = input.hasBank;
  const species: SpeciesPlan[] = [];
  const summary: PlanSummary = { have: 0, ready: 0, needGame: 0, unknown: 0, eventOnly: 0, total: 0 };
  // Species that are available somewhere routable but not yet Ready — the raw
  // material for the acquisition optimizer.
  const blocked: Routable[] = [];

  for (const e of input.entries) {
    summary.total += 1;
    if (e.status?.caught) { species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'have' }); summary.have += 1; continue; }
    const ob = e.obtainability;
    if (!ob) { species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'unknown' }); summary.unknown += 1; continue; }
    if (ob.unobtainableLegit) { species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'event-only' }); summary.eventOnly += 1; continue; }

    // Ready? pick the simplest completable route.
    let readyInfo: TransferInfo | null = null;
    for (const a of ob.availability) {
      const info = transferFor(a.gameId);
      if (routeComplete(info, owned, bank) && (!readyInfo || (REACH_RANK[info.reach] ?? 9) < (REACH_RANK[readyInfo.reach] ?? 9))) {
        readyInfo = info;
      }
    }
    if (readyInfo) {
      species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'ready', via: readyInfo.gameId, route: readyInfo.route });
      summary.ready += 1;
      continue;
    }

    // Not ready — cheapest missing route, if any is routable at all.
    let best: string[][] | null = null;
    const gameIds: string[] = [];
    for (const a of ob.availability) {
      const info = transferFor(a.gameId);
      const miss = routeMissing(info, owned, bank);
      if (miss === null) continue;
      gameIds.push(info.gameId);
      if (best === null || miss.length < best.length) best = miss;
    }
    if (best) {
      species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'need-game', needs: best });
      summary.needGame += 1;
      blocked.push({ entryKey: e.entryKey, gameIds });
    } else {
      // Available only in unknown/none-transfer games (or no availability) → can't route.
      species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'unknown' });
      summary.unknown += 1;
    }
  }

  return { species, summary, acquisitions: planAcquisitions(blocked, owned, bank) };
}

/**
 * Greedy ordered buy-list: repeatedly pick the single acquisition (a game group,
 * or Bank) that flips the most still-blocked species to Ready, apply it, repeat.
 * Captures combos across rounds (e.g. buy Bank first — unlocking many — then the
 * game that needs it). Bounded so a pathological input can't loop forever.
 */
function planAcquisitions(blocked: Routable[], initialOwned: Set<string>, initialBank: boolean): Acquisition[] {
  const owned = new Set(initialOwned);
  let bank = initialBank;
  let remaining = blocked;
  const out: Acquisition[] = [];

  const isReady = (s: Routable, own: Set<string>, bk: boolean) =>
    s.gameIds.some((gid) => routeComplete(transferFor(gid), own, bk));

  for (let round = 0; round < 24 && remaining.length > 0; round += 1) {
    const candidates = new Set<string>();
    if (!bank) candidates.add(BANK_RELEASE_ID);
    for (const s of remaining) {
      for (const gid of s.gameIds) {
        const info = transferFor(gid);
        if (!owned.has(info.gameId)) candidates.add(info.gameId);
        for (const hop of info.requiresGames) for (const g of hop) if (!owned.has(g)) candidates.add(g);
      }
    }

    let bestId: string | null = null;
    let bestCount = 0;
    for (const cand of candidates) {
      const own2 = new Set(owned);
      let bank2 = bank;
      if (cand === BANK_RELEASE_ID) bank2 = true; else own2.add(cand);
      let count = 0;
      for (const s of remaining) if (isReady(s, own2, bank2)) count += 1;
      if (count > bestCount) { bestCount = count; bestId = cand; }
    }

    if (!bestId || bestCount === 0) {
      // Stalled: every remaining unlock needs ≥2 acquisitions. If Bank is off and
      // some route needs it, activate Bank as infrastructure (it may unlock 0 now
      // but lets the next round's game purchases count) — then retry. Otherwise done.
      const bankWouldHelp = !bank && remaining.some((s) => s.gameIds.some((gid) => {
        const r = transferFor(gid).reach;
        return r === 'bank' || r === 'chain';
      }));
      if (!bankWouldHelp) break;
      bank = true;
      const before = remaining.length;
      remaining = remaining.filter((s) => !isReady(s, owned, bank));
      out.push({ id: BANK_RELEASE_ID, label: 'Pokémon Bank', kind: 'service', unlocks: before - remaining.length });
      continue;
    }

    if (bestId === BANK_RELEASE_ID) { bank = true; out.push({ id: BANK_RELEASE_ID, label: 'Pokémon Bank', kind: 'service', unlocks: bestCount }); }
    else { owned.add(bestId); out.push({ id: bestId, label: GAME_BY_ID.get(bestId)?.label ?? bestId, kind: 'game', unlocks: bestCount }); }
    remaining = remaining.filter((s) => !isReady(s, owned, bank));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Acquisition planner — the "fastest shopping list to complete the dex"
// ---------------------------------------------------------------------------

/** How the owner intends to acquire games. */
export type AcquireMode = 'cartridge-only' | 'emulator-only' | 'emu-first' | 'cartridge-first';
/** How to rank/order the shopping list. */
export type AcquireRank = 'fewest-games' | 'fewest-consoles' | 'oldest-gen';

export const ACQUIRE_MODES: readonly AcquireMode[] = ['cartridge-only', 'emulator-only', 'emu-first', 'cartridge-first'];
export const ACQUIRE_RANKS: readonly AcquireRank[] = ['fewest-games', 'fewest-consoles', 'oldest-gen'];

// Which owned methods count as a usable route per mode. `digital` (Pokémon GO)
// and mode-independent; romhack never counts. The `-only` modes ignore your
// games held in the *other* physical form.
const MODE_METHODS: Record<AcquireMode, OwnershipMethod[]> = {
  'cartridge-only': ['cartridge', 'digital'],
  'emulator-only': ['emulator', 'digital'],
  'emu-first': ['cartridge', 'emulator', 'digital'],
  'cartridge-first': ['cartridge', 'emulator', 'digital'],
};

export function ownedRouteGroupsForMode(ownership: GameOwnership[], mode: AcquireMode): Set<string> {
  const allowed = MODE_METHODS[mode];
  const groups = new Set<string>();
  for (const o of ownership) {
    if (!o.methods.some((m) => allowed.includes(m))) continue;
    const release = RELEASE_BY_ID.get(o.gameId);
    if (release && release.platform !== 'service') groups.add(release.versionGroup);
  }
  return groups;
}

/** How a recommended new acquisition would be obtained, given the mode. */
export type AcquireVia = 'cartridge' | 'emulator' | 'install' | 'subscription';
function acquireVia(id: string, mode: AcquireMode): AcquireVia {
  if (id === BANK_RELEASE_ID) return 'subscription';
  if (GAME_BY_ID.get(id)?.platform === 'mobile') return 'install'; // Pokémon GO
  return mode === 'cartridge-only' || mode === 'cartridge-first' ? 'cartridge' : 'emulator';
}

export interface AcquireStep {
  id: string; // version-group gameId, or 'bank'
  label: string;
  via: AcquireVia;
  platform: string;
  generation: number;
  /** Missing species this step flips to Ready, in sequence. */
  unlocks: number;
}

export interface AcquireLeftover { entryKey: string; dex: number; reason: 'event-only' | 'no data' | 'no known route' | 'needs more' }

export interface AcquirePlan {
  mode: AcquireMode;
  rank: AcquireRank;
  missingTotal: number;
  /** Missing species already routable with the games you own (no acquisition needed). */
  alreadyReady: number;
  /** Missing species the shopping list makes routable. */
  covered: number;
  steps: AcquireStep[];
  /** Missing species that no acquisition can route into HOME (event-only, unknown, …). */
  leftover: AcquireLeftover[];
}

interface BlockedSpecies { entryKey: string; dex: number; gameIds: string[] }

/** Cheapest missing requirement set across a species' routable availability, or null. */
function cheapestMissing(gameIds: string[], owned: Set<string>, bank: boolean): string[][] | null {
  let best: string[][] | null = null;
  for (const gid of gameIds) {
    const miss = routeMissing(transferFor(gid), owned, bank);
    if (miss === null) continue;
    if (best === null || miss.length < best.length) best = miss;
  }
  return best;
}

function candidateBetter(
  a: { id: string; dem: number; gen: number; plat: string },
  b: { id: string; dem: number; gen: number; plat: string },
  rank: AcquireRank,
  acquiredPlatforms: Set<string>,
): boolean {
  if (rank === 'oldest-gen') {
    if (a.gen !== b.gen) return a.gen < b.gen;      // oldest first
    return a.dem > b.dem;
  }
  if (rank === 'fewest-consoles') {
    const aOn = acquiredPlatforms.has(a.plat), bOn = acquiredPlatforms.has(b.plat);
    if (aOn !== bOn) return aOn;                     // reuse a platform already in the plan
    if (a.dem !== b.dem) return a.dem > b.dem;
    return a.gen < b.gen;
  }
  // fewest-games: most demanded first (satisfies the most species' requirements)
  if (a.dem !== b.dem) return a.dem > b.dem;
  return a.gen < b.gen;
}

/**
 * Compute the ordered shopping list of games/services to acquire so every
 * missing, routable species can reach HOME. A demand-based greedy set-cover:
 * each round acquire the item most species still need (respecting the chosen
 * rank), until nothing is left. Robust to multi-step chains (Gen 3 → 4 → 5 →
 * Bank) that a coverage-only greedy would stall on.
 */
export function computeAcquisitionPlan(input: {
  entries: EntryWithStatus[];
  ownership: GameOwnership[];
  mode: AcquireMode;
  rank: AcquireRank;
}): AcquirePlan {
  const owned = ownedRouteGroupsForMode(input.ownership, input.mode);
  let bank = hasBankFrom(input.ownership);

  const missing = input.entries.filter((e) => !e.status?.caught);
  const leftover: AcquireLeftover[] = [];
  let alreadyReady = 0;
  let remaining: BlockedSpecies[] = [];

  for (const e of missing) {
    const ob = e.obtainability;
    if (!ob) { leftover.push({ entryKey: e.entryKey, dex: e.dex, reason: 'no data' }); continue; }
    if (ob.unobtainableLegit) { leftover.push({ entryKey: e.entryKey, dex: e.dex, reason: 'event-only' }); continue; }
    const gameIds = ob.availability.map((a) => a.gameId).filter((gid) => {
      const r = transferFor(gid).reach;
      return r !== 'unknown' && r !== 'none';
    });
    if (gameIds.length === 0) { leftover.push({ entryKey: e.entryKey, dex: e.dex, reason: 'no known route' }); continue; }
    if (gameIds.some((gid) => routeComplete(transferFor(gid), owned, bank))) { alreadyReady += 1; continue; }
    remaining.push({ entryKey: e.entryKey, dex: e.dex, gameIds });
  }
  const blockedTotal = remaining.length;

  const acquiredPlatforms = new Set<string>();
  for (const g of owned) { const m = GAME_BY_ID.get(g); if (m) acquiredPlatforms.add(m.platform); }
  const isReady = (s: BlockedSpecies) => s.gameIds.some((gid) => routeComplete(transferFor(gid), owned, bank));

  const steps: AcquireStep[] = [];
  for (let round = 0; round < 60 && remaining.length > 0; round += 1) {
    const demand = new Map<string, number>();
    for (const s of remaining) {
      const miss = cheapestMissing(s.gameIds, owned, bank);
      if (!miss) continue;
      for (const item of new Set(miss.flat())) demand.set(item, (demand.get(item) ?? 0) + 1);
    }
    if (demand.size === 0) break;

    let best: { id: string; dem: number; gen: number; plat: string } | null = null;
    for (const [id, dem] of demand) {
      const meta = id === BANK_RELEASE_ID ? { generation: 0, platform: 'service' } : GAME_BY_ID.get(id);
      const cand = { id, dem, gen: meta?.generation ?? 99, plat: meta?.platform ?? 'x' };
      if (!best || candidateBetter(cand, best, input.rank, acquiredPlatforms)) best = cand;
    }
    if (!best) break;

    if (best.id === BANK_RELEASE_ID) bank = true; else owned.add(best.id);
    acquiredPlatforms.add(best.plat);
    const before = remaining.length;
    remaining = remaining.filter((s) => !isReady(s));
    steps.push({
      id: best.id,
      label: best.id === BANK_RELEASE_ID ? 'Pokémon Bank' : (GAME_BY_ID.get(best.id)?.label ?? best.id),
      via: acquireVia(best.id, input.mode),
      platform: best.plat,
      generation: best.gen,
      unlocks: before - remaining.length,
    });
  }

  // Anything still unmet after the loop (shouldn't happen for routable species).
  for (const s of remaining) leftover.push({ entryKey: s.entryKey, dex: s.dex, reason: 'needs more' });

  if (input.rank === 'oldest-gen') steps.sort((a, b) => a.generation - b.generation || a.label.localeCompare(b.label));

  return {
    mode: input.mode,
    rank: input.rank,
    missingTotal: missing.length,
    alreadyReady,
    covered: blockedTotal - remaining.length,
    steps,
    leftover,
  };
}
