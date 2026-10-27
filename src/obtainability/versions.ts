import { RELEASES_BY_GROUP } from './games.js';

/**
 * Version exclusives: a species in a paired game (Scarlet/Violet) that only one
 * cartridge can catch. Pokédex membership is per version group, so it can't see
 * this; per-version catch evidence can — mirror wild encounters (Gen 1 → SwSh,
 * DLC versions folded into their cartridge) and Serebii's per-version location
 * rows (SV, BDSP).
 */
export interface VersionEvidence {
  /** `${dex}:${gameId}` → cartridges with direct catch evidence (wild encounter / location row). */
  catchReleases: Map<string, Set<string>>;
  /** gameId → cartridges the evidence covers at all. A source with no rows for a
   *  cartridge proves nothing about it, so its game is never restricted. */
  covered: Map<string, Set<string>>;
}

export function emptyEvidence(): VersionEvidence {
  return { catchReleases: new Map(), covered: new Map() };
}

export function addEvidence(ev: VersionEvidence, dex: number, gameId: string, releaseId: string): void {
  const key = `${dex}:${gameId}`;
  (ev.catchReleases.get(key) ?? ev.catchReleases.set(key, new Set()).get(key)!).add(releaseId);
  (ev.covered.get(gameId) ?? ev.covered.set(gameId, new Set()).get(gameId)!).add(releaseId);
}

export interface RestrictionContext {
  evidence: VersionEvidence;
  /** The species' pre-evolution, if any. */
  evolvesFrom: (dex: number) => number | null;
  /** Is this species obtainable in this game at all (dex membership after exclusions)? */
  inGame: (dex: number, gameId: string) => boolean;
}

/**
 * The cartridges of `gameId` that can obtain `dex`, or null when every cartridge
 * can (or we can't tell — no restriction is ever guessed). A species reached by
 * evolution inherits its pre-evolution's cartridges: Tyranitar is wherever
 * Larvitar is, plus wherever it's caught directly.
 */
export function versionRestriction(dex: number, gameId: string, ctx: RestrictionContext, depth = 0): string[] | null {
  const all = RELEASES_BY_GROUP.get(gameId) ?? [];
  if (all.length < 2) return null;
  const covered = ctx.evidence.covered.get(gameId);
  if (!covered || !all.every((r) => covered.has(r))) return null;

  const own = ctx.evidence.catchReleases.get(`${dex}:${gameId}`);
  const from = ctx.evolvesFrom(dex);
  // undefined = no pre-evolution in this game; null = it's in every cartridge.
  let pre: string[] | null | undefined;
  if (from !== null && depth < 8 && ctx.inGame(from, gameId)) pre = versionRestriction(from, gameId, ctx, depth + 1);
  if (pre === null) return null; // evolve it from a pre-evolution every cartridge has
  if (!own) return pre ?? null;  // no direct evidence of its own: inherit, else unrestricted
  const union = new Set([...own, ...(pre ?? [])]);
  return union.size >= all.length ? null : all.filter((r) => union.has(r));
}
