import type { AvailabilityEntry, EntryWithStatus, GameOwnership, OwnershipMethod } from '../types.js';
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
 *
 * Version exclusives: an availability entry with `versions` (Larvitar is
 * Scarlet-only) is catchable only with one of those cartridges, so ids in
 * `needs`, acquisitions and itinerary steps may be a single release ('violet')
 * as well as a version group ('sv'). Transfer routes stay per group.
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
   * version-group gameIds, release ids for version exclusives ('violet'), or
   * 'bank' for the Pokémon Bank service.
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
  id: string; // version-group gameId, release id (version exclusive), or 'bank'
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
  /** Cartridges owned via a HOME-legal method (see ownedRouteReleases). When
   *  omitted, version exclusives are judged by group alone. */
  ownedReleases?: Iterable<string>;
  hasBank: boolean;
}

/** Cartridges owned by any of `methods` (services excluded). */
function ownedReleasesBy(ownership: GameOwnership[], methods: OwnershipMethod[]): Set<string> {
  const out = new Set<string>();
  for (const o of ownership) {
    if (!o.methods.some((m) => methods.includes(m))) continue;
    const release = RELEASE_BY_ID.get(o.gameId);
    if (release && release.platform !== 'service') out.add(release.releaseId);
  }
  return out;
}

const groupsOf = (releases: Set<string>) => new Set([...releases].map((r) => RELEASE_BY_ID.get(r)!.versionGroup));

/** Version-groups reachable as a HOME-legal source from the owner's games. */
export function ownedRouteGroups(ownership: GameOwnership[]): Set<string> {
  return groupsOf(ownedReleasesBy(ownership, HOME_LEGAL_METHODS));
}

/** Cartridges owned via a HOME-legal method (for version exclusives). */
export function ownedRouteReleases(ownership: GameOwnership[]): Set<string> {
  return ownedReleasesBy(ownership, HOME_LEGAL_METHODS);
}

/**
 * What the owner can play: version groups plus, when known, the exact
 * cartridges. `releases: null` = not release-aware (exclusives judged by group).
 */
interface Owned { groups: Set<string>; releases: Set<string> | null }

/** The version group an acquisition/step id belongs to ('violet' → 'sv'). */
export function groupOfId(id: string): string {
  return GAME_BY_ID.has(id) ? id : (RELEASE_BY_ID.get(id)?.versionGroup ?? id);
}

type CatchOption = Pick<AvailabilityEntry, 'gameId' | 'versions'>;

/** Can the owner catch this availability entry with what they play? */
function canCatch(a: CatchOption, own: Owned): boolean {
  if (!own.groups.has(a.gameId)) return false;
  return !a.versions || !own.releases || a.versions.some((v) => own.releases!.has(v));
}

/** What to acquire to catch this entry: any one of these ids. */
function catchNeed(a: CatchOption, own: Owned): string[] {
  return a.versions && own.releases ? [...a.versions] : [a.gameId];
}

/** Own one more thing: a cartridge also lights up its group. */
function acquire(own: Owned, id: string): Owned {
  const groups = new Set(own.groups);
  const releases = own.releases ? new Set(own.releases) : null;
  groups.add(groupOfId(id));
  if (releases && RELEASE_BY_ID.has(id)) releases.add(id);
  return { groups, releases };
}

function idLabel(id: string): string {
  return GAME_BY_ID.get(id)?.label ?? RELEASE_BY_ID.get(id)?.label ?? id;
}

/** Is the Bank service active (owned via subscription)? */
export function hasBankFrom(ownership: GameOwnership[]): boolean {
  return ownership.some((o) => o.gameId === BANK_RELEASE_ID && o.methods.length > 0);
}

/** Can this route be completed right now? `catchable`: you can catch it in the source game. */
function routeComplete(info: TransferInfo, catchable: boolean, owned: Set<string>, bank: boolean): boolean {
  if (!catchable) return false;
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
 * `need`: what to acquire to catch it in the source game (null = catchable).
 */
function routeMissing(info: TransferInfo, need: string[] | null, owned: Set<string>, bank: boolean): string[][] | null {
  if (info.reach === 'unknown' || info.reach === 'none') return null;
  const missing: string[][] = [];
  if (need) missing.push(need);
  if ((info.reach === 'bank' || info.reach === 'chain') && !bank) missing.push([BANK_RELEASE_ID]);
  if (info.reach === 'chain') {
    for (const hop of info.requiresGames) if (!hop.some((g) => owned.has(g))) missing.push(hop);
  }
  return missing;
}

// Most-direct transfer wins when a species is available more than one usable way.
const REACH_RANK: Record<string, number> = { native: 0, go: 1, bank: 2, chain: 3 };

interface Routable { entryKey: string; options: CatchOption[] }

const readyVia = (a: CatchOption, own: Owned, bank: boolean) =>
  routeComplete(transferFor(a.gameId), canCatch(a, own), own.groups, bank);

export function computePlan(input: PlanInput): Plan {
  const own: Owned = {
    groups: new Set(input.ownedRouteGroups),
    releases: input.ownedReleases ? new Set(input.ownedReleases) : null,
  };
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
      if (readyVia(a, own, bank) && (!readyInfo || (REACH_RANK[info.reach] ?? 9) < (REACH_RANK[readyInfo.reach] ?? 9))) {
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
    const options: CatchOption[] = [];
    for (const a of ob.availability) {
      const info = transferFor(a.gameId);
      const miss = routeMissing(info, canCatch(a, own) ? null : catchNeed(a, own), own.groups, bank);
      if (miss === null) continue;
      options.push(a);
      if (best === null || miss.length < best.length) best = miss;
    }
    if (best) {
      species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'need-game', needs: best });
      summary.needGame += 1;
      blocked.push({ entryKey: e.entryKey, options });
    } else {
      // Available only in unknown/none-transfer games (or no availability) → can't route.
      species.push({ entryKey: e.entryKey, dex: e.dex, verdict: 'unknown' });
      summary.unknown += 1;
    }
  }

  return { species, summary, acquisitions: planAcquisitions(blocked, own, bank) };
}

/**
 * Greedy ordered buy-list: repeatedly pick the single acquisition (a game group,
 * or Bank) that flips the most still-blocked species to Ready, apply it, repeat.
 * Captures combos across rounds (e.g. buy Bank first — unlocking many — then the
 * game that needs it). Bounded so a pathological input can't loop forever.
 */
function planAcquisitions(blocked: Routable[], initialOwned: Owned, initialBank: boolean): Acquisition[] {
  let owned = initialOwned;
  let bank = initialBank;
  let remaining = blocked;
  const out: Acquisition[] = [];

  const isReady = (s: Routable, own: Owned, bk: boolean) => s.options.some((a) => readyVia(a, own, bk));

  for (let round = 0; round < 24 && remaining.length > 0; round += 1) {
    const candidates = new Set<string>();
    if (!bank) candidates.add(BANK_RELEASE_ID);
    for (const s of remaining) {
      for (const a of s.options) {
        if (!canCatch(a, owned)) for (const id of catchNeed(a, owned)) candidates.add(id);
        for (const hop of transferFor(a.gameId).requiresGames) for (const g of hop) if (!owned.groups.has(g)) candidates.add(g);
      }
    }

    let bestId: string | null = null;
    let bestCount = 0;
    for (const cand of candidates) {
      const bank2 = bank || cand === BANK_RELEASE_ID;
      const own2 = cand === BANK_RELEASE_ID ? owned : acquire(owned, cand);
      let count = 0;
      for (const s of remaining) if (isReady(s, own2, bank2)) count += 1;
      if (count > bestCount) { bestCount = count; bestId = cand; }
    }

    if (!bestId || bestCount === 0) {
      // Stalled: every remaining unlock needs ≥2 acquisitions. If Bank is off and
      // some route needs it, activate Bank as infrastructure (it may unlock 0 now
      // but lets the next round's game purchases count) — then retry. Otherwise done.
      const bankWouldHelp = !bank && remaining.some((s) => s.options.some((a) => {
        const r = transferFor(a.gameId).reach;
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
    else { owned = acquire(owned, bestId); out.push({ id: bestId, label: idLabel(bestId), kind: 'game', unlocks: bestCount }); }
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
  return groupsOf(ownedReleasesBy(ownership, MODE_METHODS[mode]));
}

/** How a recommended new acquisition would be obtained, given the mode. */
export type AcquireVia = 'cartridge' | 'emulator' | 'install' | 'subscription';
function acquireVia(id: string, mode: AcquireMode): AcquireVia {
  if (id === BANK_RELEASE_ID) return 'subscription';
  if (GAME_BY_ID.get(groupOfId(id))?.platform === 'mobile') return 'install'; // Pokémon GO
  return mode === 'cartridge-only' || mode === 'cartridge-first' ? 'cartridge' : 'emulator';
}

/**
 * One stop on the completion itinerary — a game to play (owned or to acquire),
 * with the exact species to catch there. `prereq` steps (Pokémon Bank, a chain
 * intermediate) are transfer requirements, not catch stops.
 */
export interface AcquireStep {
  id: string; // version-group gameId, or 'bank'
  label: string;
  platform: string;
  generation: number;
  /** You already own a usable copy (in this mode) — just play it. */
  owned: boolean;
  /** How to acquire it when not owned (null when owned). */
  via: AcquireVia | null;
  /** Species to catch at this stop. */
  catchCount: number;
  entryKeys: string[];
  /** A transfer requirement (Bank / chain intermediate), not a place you catch. */
  prereq: boolean;
}

export interface AcquireLeftover { entryKey: string; dex: number; reason: 'event-only' | 'no data' | 'no known route' }

export interface AcquirePlan {
  mode: AcquireMode;
  rank: AcquireRank;
  missingTotal: number;
  /** Missing species the itinerary catches (assigned to a stop). */
  coverable: number;
  /** Ordered stops: transfer prereqs first, then catch stops. */
  steps: AcquireStep[];
  /** Missing species with no known catchable+routable path (event-only, unknown). */
  leftover: AcquireLeftover[];
}

// Route "simplicity" tier — prefer catching a species in a game that reaches
// HOME directly over one that needs Bank or a transfer chain.
function tierOf(reach: string): number {
  if (reach === 'native' || reach === 'go') return 0;
  if (reach === 'bank') return 1;
  if (reach === 'chain') return 2;
  return 99; // unknown | none — not catchable-into-HOME
}

/** Do you own this stop? A group stop: any of its cartridges. A cartridge stop: that one. */
function ownsId(id: string, own: Owned): boolean {
  return GAME_BY_ID.has(id) ? own.groups.has(id) : Boolean(own.releases?.has(id));
}

/**
 * The itinerary stop(s) that catch this entry: its group — unless it's a version
 * exclusive your copy doesn't cover, then the cartridge(s) that have it. Owning
 * both Scarlet and Violet puts Scarlet-only species on a Scarlet stop.
 */
function stopIdsFor(a: CatchOption, own: Owned): string[] {
  if (!a.versions || !own.releases) return [a.gameId];
  const mine = [...own.releases].filter((r) => RELEASE_BY_ID.get(r)!.versionGroup === a.gameId);
  if (mine.length && mine.every((r) => a.versions!.includes(r))) return [a.gameId];
  return [...a.versions];
}

function stepFor(id: string, entryKeys: string[], own: Owned, mode: AcquireMode, prereq: boolean): AcquireStep {
  const isBank = id === BANK_RELEASE_ID;
  const group = GAME_BY_ID.get(groupOfId(id));
  const meta = isBank ? { label: 'Pokémon Bank', platform: 'service', generation: 0 }
    : group && { label: idLabel(id), platform: group.platform, generation: group.generation };
  const isOwned = !isBank && ownsId(id, own);
  return {
    id,
    label: meta?.label ?? id,
    platform: meta?.platform ?? 'x',
    generation: meta?.generation ?? 99,
    owned: isOwned,
    via: isOwned ? null : acquireVia(id, mode),
    catchCount: entryKeys.length,
    entryKeys,
    prereq,
  };
}

function coverBetter(
  a: { n: number; owned: boolean; gen: number; plat: string },
  b: { n: number; owned: boolean; gen: number; plat: string },
  rank: AcquireRank,
  usedPlatforms: Set<string>,
): boolean {
  if (rank === 'fewest-consoles') {
    const aOn = usedPlatforms.has(a.plat), bOn = usedPlatforms.has(b.plat);
    if (aOn !== bOn) return aOn; // stay on a console already in the plan
  }
  if (a.n !== b.n) return a.n > b.n;         // cover the most new species
  if (a.owned !== b.owned) return a.owned;   // prefer a game you already own
  return a.gen < b.gen;                       // deterministic
}

/**
 * Build the completion itinerary: the minimal ordered set of games to play —
 * owned **and** to-acquire — each with the exact species to catch there, so you
 * cover every missing, routable species. A greedy set-cover picks the game that
 * catches the most still-uncaught species each round (respecting the rank), and
 * assigns those species to it. Any Bank / chain-intermediate a chosen game needs
 * for the HOME transfer is added as a `prereq` step. Each species is caught in
 * its simplest-tier game (direct over Bank over chain), so the itinerary is
 * dominated by modern one-stop games rather than transfer chains.
 */
export function computeAcquisitionPlan(input: {
  entries: EntryWithStatus[];
  ownership: GameOwnership[];
  mode: AcquireMode;
  rank: AcquireRank;
}): AcquirePlan {
  const releases = ownedReleasesBy(input.ownership, MODE_METHODS[input.mode]);
  const own: Owned = { groups: groupsOf(releases), releases };
  const hasBank = hasBankFrom(input.ownership);

  const missing = input.entries.filter((e) => !e.status?.caught);
  const leftover: AcquireLeftover[] = [];
  const speciesGames = new Map<string, string[]>(); // entryKey -> candidate games (simplest tier)

  for (const e of missing) {
    const ob = e.obtainability;
    if (!ob) { leftover.push({ entryKey: e.entryKey, dex: e.dex, reason: 'no data' }); continue; }
    if (ob.unobtainableLegit) { leftover.push({ entryKey: e.entryKey, dex: e.dex, reason: 'event-only' }); continue; }
    let minTier = 99;
    const byTier = new Map<number, Set<string>>();
    for (const a of ob.availability) {
      const t = tierOf(transferFor(a.gameId).reach);
      if (t === 99) continue;
      const tierSet = byTier.get(t) ?? byTier.set(t, new Set()).get(t)!;
      for (const id of stopIdsFor(a, own)) tierSet.add(id);
      if (t < minTier) minTier = t;
    }
    if (minTier === 99) { leftover.push({ entryKey: e.entryKey, dex: e.dex, reason: 'no known route' }); continue; }
    speciesGames.set(e.entryKey, [...byTier.get(minTier)!]);
  }

  // Greedy set-cover: each round, the game catching the most still-uncovered species.
  const uncovered = new Set(speciesGames.keys());
  const usedPlatforms = new Set<string>();
  for (const g of own.groups) { const m = GAME_BY_ID.get(g); if (m) usedPlatforms.add(m.platform); }

  const catchStops: { id: string; entryKeys: string[] }[] = [];
  while (uncovered.size > 0) {
    const cover = new Map<string, string[]>();
    for (const ek of uncovered) for (const g of speciesGames.get(ek)!) (cover.get(g) ?? cover.set(g, []).get(g)!).push(ek);
    // Buying a cartridge also catches everything its (unowned) group offers:
    // Violet covers Violet exclusives plus the shared Scarlet/Violet species.
    for (const [id, eks] of cover) {
      const group = groupOfId(id);
      if (group === id || own.groups.has(group)) continue;
      for (const ek of cover.get(group) ?? []) if (!eks.includes(ek)) eks.push(ek);
    }
    let best: { id: string; n: number; owned: boolean; gen: number; plat: string } | null = null;
    for (const [id, eks] of cover) {
      const m = GAME_BY_ID.get(groupOfId(id));
      const cand = { id, n: eks.length, owned: ownsId(id, own), gen: m?.generation ?? 99, plat: m?.platform ?? 'x' };
      if (!best || coverBetter(cand, best, input.rank, usedPlatforms)) best = cand;
    }
    if (!best) break;
    for (const ek of cover.get(best.id)!) uncovered.delete(ek);
    usedPlatforms.add(best.plat);
    // entryKeys sort ≈ dex order (they start with the zero-padded dex number).
    catchStops.push({ id: best.id, entryKeys: cover.get(best.id)!.sort((a, b) => a.localeCompare(b)) });
  }

  if (input.rank === 'oldest-gen') {
    catchStops.sort((a, b) => (GAME_BY_ID.get(groupOfId(a.id))?.generation ?? 99) - (GAME_BY_ID.get(groupOfId(b.id))?.generation ?? 99));
  }

  // Transfer prerequisites for the chosen games (Bank, chain intermediates).
  let needBank = false;
  const prereqGames = new Set<string>();
  for (const stop of catchStops) {
    const info = transferFor(groupOfId(stop.id));
    if ((info.reach === 'bank' || info.reach === 'chain') && !hasBank) needBank = true;
    if (info.reach === 'chain') {
      for (const hop of info.requiresGames) {
        const rep = hop[0];
        if (rep && !hop.some((g) => own.groups.has(g))) prereqGames.add(rep);
      }
    }
  }

  const steps: AcquireStep[] = [];
  if (needBank) steps.push(stepFor(BANK_RELEASE_ID, [], own, input.mode, true));
  for (const g of prereqGames) steps.push(stepFor(g, [], own, input.mode, true));
  for (const stop of catchStops) steps.push(stepFor(stop.id, stop.entryKeys, own, input.mode, false));

  return {
    mode: input.mode,
    rank: input.rank,
    missingTotal: missing.length,
    coverable: catchStops.reduce((n, s) => n + s.entryKeys.length, 0),
    steps,
    leftover,
  };
}
