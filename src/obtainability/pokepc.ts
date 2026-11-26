import type { AvailabilityEntry, KeptIn, Obtainability } from '../types.js';
import { GAMES, RELEASES_BY_GROUP, RELEASE_BY_ID, SWITCH_GAME_IDS } from './games.js';
import { EVENT_ONLY_FORMS, POKEPC_CORRECTIONS, STATIC_SHINY_LOCK } from './curated.js';
import { shinyPossibleIn } from './compute.js';
import { POKEPC_RECORDS } from './pokepc-data.js';
import { POKEPC_CARTRIDGES } from './pokepc-slugs.js';

/**
 * pokepc/dataset (https://github.com/pokepc/dataset, MIT) is the base layer for
 * WHICH forms are obtainable in WHICH cartridges. It is a curated per-form,
 * per-cartridge availability list, more complete than regional-Pokédex
 * membership: it knows post-game areas, gifts, NPC trades and permanent GO
 * research, and it leaves out regional-dex entries that can't be caught.
 *
 * It has no methods or locations, so those still come from the mirror and the
 * curated tables. Hand-checked disagreements live in POKEPC_CORRECTIONS.
 * Forms pokepc has no record for (megas, Gigantamax, cosplay Pikachu) keep
 * the mirror's answer. Regenerate with scripts/update-pokepc.ts.
 */

/** Games pokepc covers; any other game (Winds/Waves) keeps the mirror's answer. */
const POKEPC_GAME_IDS = new Set(Object.values(POKEPC_CARTRIDGES).flat().map((r) => RELEASE_BY_ID.get(r)!.versionGroup));

/**
 * Re-releases that play the same game as an older one: their methods and
 * locations come from that game's record (the mirror only knows the GBA one).
 */
const SAME_GAME_AS: Record<string, string> = { 'frlg-switch': 'frlg' };

export interface PokepcAvailability {
  /** Native release ids per game (link-trade-only cartridges removed). */
  native: Map<string, string[]>;
  /** Release ids where the only native source was an event. */
  eventOnly: string[];
  /** Where the form lives when HOME can't store it; null when HOME can. */
  keptIn: KeptIn | null;
}

const split = (s: string): string[] => (s ? s.split(' ') : []);

function byGame(releases: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of releases) {
    const group = RELEASE_BY_ID.get(r)?.versionGroup;
    if (!group) continue;
    out.set(group, [...(out.get(group) ?? []), r]);
  }
  return out;
}

/** pokepc's availability for one form, with POKEPC_CORRECTIONS applied; null if pokepc has no record. */
export function pokepcAvailability(dex: number, formSlug: string): PokepcAvailability | null {
  const key = `${dex}:${formSlug}`;
  const rec = POKEPC_RECORDS[key];
  if (!rec) return null;
  const native = byGame(split(rec[0]));
  for (const [gameId, releases] of Object.entries(POKEPC_CORRECTIONS[key] ?? {})) {
    if (releases.length) native.set(gameId, [...releases]);
    else native.delete(gameId);
  }
  return { native, eventOnly: split(rec[1]), keptIn: keptIn(rec[2], native) };
}

/**
 * The storage column: `save:<releases>` or `battle[:<releases>]`. A
 * battle-only form can be held (as base form + trigger item) in any game that
 * triggers it, plus any listed save that keeps it outside battle (GO).
 */
function keptIn(storage: string | undefined, native: Map<string, string[]>): KeptIn | null {
  if (!storage) return null;
  const [kind, held = ''] = storage.split(':') as ['save' | 'battle', string?];
  const releases = new Set(split(held));
  if (kind === 'battle') for (const rs of native.values()) for (const r of rs) releases.add(r);
  const order = [...RELEASE_BY_ID.keys()];
  return { kind, releases: [...releases].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

/**
 * Re-base one slot's obtainability on pokepc: pokepc decides which games (and
 * which cartridges of each) have the form; the existing record supplies the
 * method, locations and shiny flag for games it already had. A game with no
 * known method is `evolve` when the pre-evolution is native there, else
 * `available`.
 * Event-only forms (EVENT_ONLY_FORMS) and forms pokepc lacks are unchanged.
 */
export function applyPokepc(dex: number, formSlug: string, ob: Obtainability): Obtainability {
  if (EVENT_ONLY_FORMS.has(`${dex}:${formSlug}`)) return ob;
  const pp = pokepcAvailability(dex, formSlug);
  if (!pp) return ob;

  const prior = new Map(ob.availability.map((a) => [a.gameId, a]));
  for (const [game, same] of Object.entries(SAME_GAME_AS)) {
    const had = prior.get(same);
    if (had && !prior.has(game)) prior.set(game, had);
  }
  // Same form only: Alolan Ninetales evolves from Alolan Vulpix, but nothing
  // evolves into Eternal Floette.
  const pre = ob.evolveFrom ? pokepcAvailability(ob.evolveFrom.dex, formSlug) : null;

  const availability: AvailabilityEntry[] = [];
  for (const game of GAMES) {
    const had = prior.get(game.gameId);
    if (!POKEPC_GAME_IDS.has(game.gameId)) {
      if (had) availability.push(had);
      continue;
    }
    const releases = pp.native.get(game.gameId);
    if (!releases?.length) continue;
    const all = RELEASES_BY_GROUP.get(game.gameId) ?? [];
    const versions = releases.length < all.length ? all.filter((r) => releases.includes(r)) : null;
    // `available` is the mirror's "in the dex, method unknown", so evolve beats it.
    const known = had && had.method !== 'available' ? had.method : null;
    const method = known ?? (pre?.native.get(game.gameId)?.length ? 'evolve' : 'available');
    availability.push({
      gameId: game.gameId,
      label: game.label,
      platform: game.platform,
      method,
      shinyPossible: had?.shinyPossible ?? shinyPossibleIn(dex, game.gameId),
      ...(had?.locations?.length ? { locations: had.locations } : {}),
      ...(versions ? { versions } : {}),
    });
  }

  return {
    ...ob,
    availability,
    teraAvailable: availability.some((a) => a.gameId === 'sv'),
    catchableOnSwitch: availability.some((a) => SWITCH_GAME_IDS.has(a.gameId)),
    shinyLockedIn: availability.filter((a) => STATIC_SHINY_LOCK[a.gameId]?.includes(dex)).map((a) => a.gameId),
    // No native game left: only events (or transfers) ever had it.
    unobtainableLegit: availability.length === 0,
    keptIn: pp.keptIn,
  };
}
