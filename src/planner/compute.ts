import type { EntryWithStatus, GameOwnership, OwnershipMethod } from '../types.js';
import { BANK_RELEASE_ID, GAME_BY_ID, RELEASE_BY_ID } from '../obtainability/games.js';
import { transferFor, type TransferInfo } from '../obtainability/transfer.js';

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
