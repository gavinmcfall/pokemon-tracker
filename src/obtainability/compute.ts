import type { AvailabilityEntry, Obtainability } from '../types.js';
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

// Most-direct method wins when a game offers a slot more than one way.
const METHOD_PRIORITY = ['wild', 'gift', 'static', 'event', 'fossil', 'roaming', 'trade', 'evolve'];

// An unrecognized method ranks last, so it never spuriously beats a known one.
function rank(method: string): number {
  const i = METHOD_PRIORITY.indexOf(method);
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

export function computeObtainability(input: ObtainabilityInput): Obtainability {
  const { dex, generation, hasGenderDifferences, hasGmaxVariety } = input;
  const shinyLockedEverywhere = SHINY_LOCKED_EVERYWHERE.has(dex);

  // Merge availability sources into one method per gameId (most direct wins).
  const byGame = new Map<string, string>();
  const add = (gameId: string, method: string) => {
    if (!GAME_BY_ID.has(gameId)) return;
    const existing = byGame.get(gameId);
    byGame.set(gameId, existing ? moreDirect(existing, method) : method);
  };
  for (const g of input.ownWildGameIds) add(g, 'wild');
  for (const g of input.evolvedFromGameIds) add(g, 'evolve');
  for (const s of STATIC_AVAILABILITY[dex] ?? []) add(s.gameId, s.method);
  for (const g of STARTER_GIFTS[dex] ?? []) add(g, 'gift');

  const availability: AvailabilityEntry[] = [...byGame.entries()]
    .sort(([a], [b]) => byReleaseOrder(a, b))
    .map(([gameId, method]) => {
      const meta = GAME_BY_ID.get(gameId)!;
      const shinyPossible = !shinyLockedEverywhere && !(STATIC_SHINY_LOCK[gameId]?.includes(dex));
      return { gameId, label: meta.label, platform: meta.platform, method, shinyPossible };
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
  };
}
