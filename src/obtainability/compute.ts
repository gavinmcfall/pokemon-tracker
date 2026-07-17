import type { AvailabilityEntry, EvolveFrom, Obtainability } from '../types.js';
import type { RawChainLink } from '../seed/pokeapi.js';
import { GAME_BY_ID, GAMES, SWITCH_GAME_IDS, byReleaseOrder } from './games.js';
import {
  SHINY_LOCKED_EVERYWHERE,
  STARTER_GIFTS,
  STATIC_AVAILABILITY,
  STATIC_SHINY_LOCK,
  UNOBTAINABLE_LEGIT,
} from './curated.js';

export type { AvailabilityEntry, Obtainability };

export interface ObtainabilityInput {
  dex: number;
  generation: number;
  hasGenderDifferences: boolean;
  hasGmaxVariety: boolean;
  /** gameIds where this species is wild-encounterable (union across its varieties). */
  ownWildGameIds: string[];
  /** gameIds where a pre-evolution is obtainable (this mon is reachable by evolving there). */
  evolvedFromGameIds: string[];
}

/** Known ways a slot is obtainable in a game. `available` = in the game's dex
 *  but not confirmed wild (the mirror path's generic fallback). */
export type ObtainMethod =
  | 'wild' | 'gift' | 'static' | 'event' | 'fossil' | 'roaming' | 'trade' | 'evolve' | 'available';

// Most-direct method wins when a game offers a slot more than one way. (`available`
// is intentionally absent → ranks last, so any specific method beats it.)
const METHOD_PRIORITY: ObtainMethod[] = ['wild', 'gift', 'static', 'event', 'fossil', 'roaming', 'trade', 'evolve'];

// An unrecognized method ranks last, so it never spuriously beats a known one.
function rank(method: string): number {
  const i = (METHOD_PRIORITY as readonly string[]).indexOf(method);
  return i === -1 ? METHOD_PRIORITY.length : i;
}
function moreDirect(a: string, b: string): string {
  return rank(a) <= rank(b) ? a : b;
}

/** Names of every species strictly upstream of `target` on its evolution path (root → target). */
export function chainAncestors(chain: RawChainLink, target: string): string[] {
  const path: string[] = [];
  function walk(node: RawChainLink, trail: string[]): boolean {
    if (node.species.name === target) {
      path.push(...trail);
      return true;
    }
    for (const next of node.evolves_to) {
      if (walk(next, [...trail, node.species.name])) return true;
    }
    return false;
  }
  walk(chain, []);
  return path;
}

/**
 * Games where a species is *directly* obtainable — wild encounters plus its own
 * curated static/gift availability. This (not just wild) is the correct basis
 * for evolution-derived availability of its descendants: a starter obtained by
 * gift and then evolved should pass that game down the line.
 */
export function ownDirectlyObtainableGames(dex: number, wildGameIds: Iterable<string>): Set<string> {
  const games = new Set<string>(wildGameIds);
  for (const s of STATIC_AVAILABILITY[dex] ?? []) games.add(s.gameId);
  for (const g of STARTER_GIFTS[dex] ?? []) games.add(g);
  return games;
}

/** A candidate way a slot is obtainable in a game, before dedup. */
export interface ObtainSource {
  gameId: string;
  method: ObtainMethod;
  /** Where in this game (mirror encounter data), e.g. "Route 119 (super rod)". */
  locations?: string[];
}

export interface SourcedInput {
  dex: number;
  generation: number;
  hasGenderDifferences: boolean;
  hasGmaxVariety: boolean;
  sources: ObtainSource[];
  /** How the species is reached by evolution, when it evolves from another. */
  evolveFrom?: EvolveFrom | null;
}

/** Most location hints shown per game — enough to start playing, not a wiki. */
const MAX_LOCATIONS = 3;

/**
 * Assemble the final Obtainability from a raw source list (one entry per way a
 * slot can be obtained in a game). Shared by the HTTP path (wild + evolution +
 * curated) and the mirror path (pokédex membership + curated). Dedups to one
 * method per game (most direct wins) and derives the flags.
 */
export function computeObtainabilityFromSources(input: SourcedInput): Obtainability {
  const { dex, generation, hasGenderDifferences, hasGmaxVariety } = input;
  const shinyLockedEverywhere = SHINY_LOCKED_EVERYWHERE.has(dex);

  const byGame = new Map<string, { method: string; locations: string[] }>();
  for (const s of input.sources) {
    if (!GAME_BY_ID.has(s.gameId)) continue;
    const existing = byGame.get(s.gameId);
    if (!existing) {
      byGame.set(s.gameId, { method: s.method, locations: [...(s.locations ?? [])] });
    } else {
      existing.method = moreDirect(existing.method, s.method);
      for (const loc of s.locations ?? []) if (!existing.locations.includes(loc)) existing.locations.push(loc);
    }
  }

  const availability: AvailabilityEntry[] = [...byGame.entries()]
    .sort(([a], [b]) => byReleaseOrder(a, b))
    .map(([gameId, { method, locations }]) => {
      const meta = GAME_BY_ID.get(gameId)!;
      const shinyPossible = !shinyLockedEverywhere && !(STATIC_SHINY_LOCK[gameId]?.includes(dex));
      return {
        gameId, label: meta.label, platform: meta.platform, method, shinyPossible,
        ...(locations.length ? { locations: locations.slice(0, MAX_LOCATIONS) } : {}),
      };
    });

  const shinyLockedIn = availability
    .filter((a) => STATIC_SHINY_LOCK[a.gameId]?.includes(dex))
    .map((a) => a.gameId);

  const originGames = GAMES.filter((g) => g.generation === generation).map((g) => g.gameId);

  return {
    availability,
    gmaxCapable: hasGmaxVariety,
    teraAvailable: availability.some((a) => a.gameId === 'sv'),
    catchableOnSwitch: availability.some((a) => SWITCH_GAME_IDS.has(a.gameId)),
    shinyLegalSomewhere: !shinyLockedEverywhere,
    unobtainableLegit: UNOBTAINABLE_LEGIT.has(dex),
    genderVisualDiff: hasGenderDifferences,
    shinyLockedIn,
    originGames,
    evolveFrom: input.evolveFrom ?? null,
  };
}

/**
 * HTTP-path entry point: builds sources from wild encounters + evolution-derived
 * games + curated static/gift, then delegates. (The mirror path builds sources
 * from pokédex membership instead and calls computeObtainabilityFromSources.)
 */
export function computeObtainability(input: ObtainabilityInput): Obtainability {
  const sources: ObtainSource[] = [
    ...input.ownWildGameIds.map((gameId): ObtainSource => ({ gameId, method: 'wild' })),
    ...input.evolvedFromGameIds.map((gameId): ObtainSource => ({ gameId, method: 'evolve' })),
    ...(STATIC_AVAILABILITY[input.dex] ?? []).map((s): ObtainSource => ({ gameId: s.gameId, method: s.method })),
    ...(STARTER_GIFTS[input.dex] ?? []).map((gameId): ObtainSource => ({ gameId, method: 'gift' })),
  ];
  return computeObtainabilityFromSources({ ...input, sources });
}
