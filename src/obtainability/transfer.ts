/**
 * Transfer topology — how a Pokémon caught in each game reaches Pokémon HOME.
 *
 * Keyed by the obtainability `gameId` (a version-group slug like `rb`, `swsh`),
 * so it lines up with `AvailabilityEntry.gameId`. This is the input the
 * living-dex planner uses to route an un-obtained species into HOME given the
 * games the owner has.
 *
 * Per the project's "never guess" rule, anything genuinely uncertain is marked
 * `reach: 'unknown'` rather than asserted. Data is curated from Bulbapedia /
 * Serebii / official Pokémon HOME support (see PR notes for citations) and
 * reflects Pokémon Bank still operating as the 3DS-era bridge into HOME.
 */

/**
 * How (and whether) a game's catches can reach Pokémon HOME.
 * - `native`  — deposits directly into HOME (the Switch line).
 * - `go`      — Pokémon GO's one-way, limited link into HOME.
 * - `bank`    — routes through Pokémon Bank (Bank → HOME is one-way), including
 *               the Poké Transporter step for the games that need it.
 * - `chain`   — reaches HOME only through a multi-game hop chain ending at Bank
 *               (e.g. Gen 3 → 4 → 5 → Transporter → Bank → HOME); needs the
 *               intermediate games in `requiresGames`.
 * - `none`    — cannot legitimately reach HOME.
 * - `unknown` — not confidently known; treated as "unknown", never guessed.
 */
export type HomeReach = 'native' | 'go' | 'bank' | 'chain' | 'none' | 'unknown';

export interface TransferInfo {
  /** Version-group gameId this route is for (matches AvailabilityEntry.gameId). */
  gameId: string;
  reach: HomeReach;
  /** Deposits straight into HOME with no Bank/chain step. */
  directToHome: boolean;
  /** Pokémon Bank is part of the route. */
  requiresBank: boolean;
  /** Can it reach HOME at all (false only for `none`; `unknown` is not `false`). */
  possible: boolean;
  /**
   * Intermediate games needed to complete the hop chain, as an AND-of-ORs:
   * each inner array is one hop where you must own ANY one of the listed game
   * groups. `[['dp','pt','hgss'], ['bw','b2w2']]` = "any Gen 4 AND any Gen 5".
   * Empty for direct/Bank routes that need no other game.
   */
  requiresGames: string[][];
  /** Human-readable hop chain, e.g. "Emerald → Pal Park → … → Bank → HOME". */
  route: string;
  /** Caveat worth surfacing (VC-only, one-way, GO energy cost, …). */
  note?: string;
}

const GEN4: string[] = ['dp', 'pt', 'hgss'];
const GEN5: string[] = ['bw', 'b2w2'];

/**
 * Curated transfer routes, keyed by version-group gameId. Cross-checked against
 * the transfer-topology research before shipping (see PR). Gen 1/2 route via
 * the 3DS Virtual Console re-releases — the original GB/GBC cartridges have no
 * HOME path, noted per entry.
 */
export const TRANSFER_BY_GAME: Record<string, TransferInfo> = {
  // ---- Switch line: deposits straight into HOME ----------------------------
  lgpe: { gameId: 'lgpe', reach: 'native', directToHome: true, requiresBank: false, possible: true, requiresGames: [], route: "Let's Go → HOME" },
  swsh: { gameId: 'swsh', reach: 'native', directToHome: true, requiresBank: false, possible: true, requiresGames: [], route: 'Sword/Shield → HOME' },
  bdsp: { gameId: 'bdsp', reach: 'native', directToHome: true, requiresBank: false, possible: true, requiresGames: [], route: 'Brilliant Diamond/Shining Pearl → HOME' },
  pla: { gameId: 'pla', reach: 'native', directToHome: true, requiresBank: false, possible: true, requiresGames: [], route: 'Legends: Arceus → HOME' },
  sv: { gameId: 'sv', reach: 'native', directToHome: true, requiresBank: false, possible: true, requiresGames: [], route: 'Scarlet/Violet → HOME' },

  // ---- Pokémon GO: direct but one-way and limited --------------------------
  go: { gameId: 'go', reach: 'go', directToHome: true, requiresBank: false, possible: true, requiresGames: [], route: 'GO → HOME', note: 'One-way, costs GO Transporter energy' },

  // ---- 3DS line into Pokémon Bank → HOME -----------------------------------
  xy: { gameId: 'xy', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'X/Y → Pokémon Bank → HOME' },
  oras: { gameId: 'oras', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Omega Ruby/Alpha Sapphire → Pokémon Bank → HOME' },
  sm: { gameId: 'sm', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Sun/Moon → Pokémon Bank → HOME' },
  usum: { gameId: 'usum', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Ultra Sun/Ultra Moon → Pokémon Bank → HOME' },

  // ---- Gen 5 (DS): Poké Transporter → Bank → HOME --------------------------
  bw: { gameId: 'bw', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Black/White → Poké Transporter → Pokémon Bank → HOME' },
  b2w2: { gameId: 'b2w2', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Black 2/White 2 → Poké Transporter → Pokémon Bank → HOME' },

  // ---- Gen 1/2: only via the 3DS Virtual Console re-releases ----------------
  rb: { gameId: 'rb', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Red/Blue (3DS Virtual Console) → Poké Transporter → Pokémon Bank → HOME', note: 'Original GB cartridges cannot transfer — only the 3DS VC release' },
  yellow: { gameId: 'yellow', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Yellow (3DS Virtual Console) → Poké Transporter → Pokémon Bank → HOME', note: 'Original GB cartridge cannot transfer — only the 3DS VC release' },
  gs: { gameId: 'gs', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Gold/Silver (3DS Virtual Console) → Poké Transporter → Pokémon Bank → HOME', note: 'Original GBC cartridges cannot transfer — only the 3DS VC release' },
  c: { gameId: 'c', reach: 'bank', directToHome: false, requiresBank: true, possible: true, requiresGames: [], route: 'Crystal (3DS Virtual Console) → Poké Transporter → Pokémon Bank → HOME', note: 'Original GBC cartridge cannot transfer — only the 3DS VC release' },

  // ---- Gen 3 (GBA): climb 3 → 4 → 5 → Transporter → Bank → HOME -------------
  rs: { gameId: 'rs', reach: 'chain', directToHome: false, requiresBank: true, possible: true, requiresGames: [GEN4, GEN5], route: 'Ruby/Sapphire → Pal Park (Gen 4) → Poké Transfer (Gen 5) → Poké Transporter → Pokémon Bank → HOME' },
  e: { gameId: 'e', reach: 'chain', directToHome: false, requiresBank: true, possible: true, requiresGames: [GEN4, GEN5], route: 'Emerald → Pal Park (Gen 4) → Poké Transfer (Gen 5) → Poké Transporter → Pokémon Bank → HOME' },
  frlg: { gameId: 'frlg', reach: 'chain', directToHome: false, requiresBank: true, possible: true, requiresGames: [GEN4, GEN5], route: 'FireRed/LeafGreen → Pal Park (Gen 4) → Poké Transfer (Gen 5) → Poké Transporter → Pokémon Bank → HOME' },

  // ---- Gen 4 (DS): climb 4 → 5 → Transporter → Bank → HOME ------------------
  dp: { gameId: 'dp', reach: 'chain', directToHome: false, requiresBank: true, possible: true, requiresGames: [GEN5], route: 'Diamond/Pearl → Poké Transfer (Gen 5) → Poké Transporter → Pokémon Bank → HOME' },
  pt: { gameId: 'pt', reach: 'chain', directToHome: false, requiresBank: true, possible: true, requiresGames: [GEN5], route: 'Platinum → Poké Transfer (Gen 5) → Poké Transporter → Pokémon Bank → HOME' },
  hgss: { gameId: 'hgss', reach: 'chain', directToHome: false, requiresBank: true, possible: true, requiresGames: [GEN5], route: 'HeartGold/SoulSilver → Poké Transfer (Gen 5) → Poké Transporter → Pokémon Bank → HOME' },
};

/** Lookup with an explicit `unknown` fallback so callers never assert a guess. */
export function transferFor(gameId: string): TransferInfo {
  return (
    TRANSFER_BY_GAME[gameId] ?? {
      gameId,
      reach: 'unknown',
      directToHome: false,
      requiresBank: false,
      possible: true, // unknown ≠ impossible
      requiresGames: [],
      route: '',
    }
  );
}
