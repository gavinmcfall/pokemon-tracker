/**
 * Game / version metadata for the obtainability layer.
 *
 * PokéAPI reports wild encounters per *version* (e.g. `red`, `sword`); we roll
 * those up to a *gameId* (a version-group-ish slug like `rb`, `swsh`) for
 * display, matching the slugs the HOME importer already emits (`swsh`, `sv`,
 * `go`, `lgpe`, `xy`, `oras`) and the front-end's GAME_LABELS.
 */

export type Platform = 'gb' | 'gbc' | 'gba' | 'ds' | '3ds' | 'switch' | 'switch2' | 'mobile';

export interface GameMeta {
  gameId: string;
  label: string;
  platform: Platform;
  generation: number; // 0 for the mobile spin-off (GO)
}

/** Canonical games, in release order (drives the UI's per-platform grouping). */
export const GAMES: GameMeta[] = [
  { gameId: 'rb', label: 'Red/Blue', platform: 'gb', generation: 1 },
  { gameId: 'yellow', label: 'Yellow', platform: 'gb', generation: 1 },
  { gameId: 'gs', label: 'Gold/Silver', platform: 'gbc', generation: 2 },
  { gameId: 'c', label: 'Crystal', platform: 'gbc', generation: 2 },
  { gameId: 'rs', label: 'Ruby/Sapphire', platform: 'gba', generation: 3 },
  { gameId: 'e', label: 'Emerald', platform: 'gba', generation: 3 },
  { gameId: 'frlg', label: 'FireRed/LeafGreen', platform: 'gba', generation: 3 },
  { gameId: 'dp', label: 'Diamond/Pearl', platform: 'ds', generation: 4 },
  { gameId: 'pt', label: 'Platinum', platform: 'ds', generation: 4 },
  { gameId: 'hgss', label: 'HeartGold/SoulSilver', platform: 'ds', generation: 4 },
  { gameId: 'bw', label: 'Black/White', platform: 'ds', generation: 5 },
  { gameId: 'b2w2', label: 'Black 2/White 2', platform: 'ds', generation: 5 },
  { gameId: 'xy', label: 'X/Y', platform: '3ds', generation: 6 },
  { gameId: 'oras', label: 'Omega Ruby/Alpha Sapphire', platform: '3ds', generation: 6 },
  { gameId: 'sm', label: 'Sun/Moon', platform: '3ds', generation: 7 },
  { gameId: 'usum', label: 'Ultra Sun/Ultra Moon', platform: '3ds', generation: 7 },
  { gameId: 'lgpe', label: "Let's Go", platform: 'switch', generation: 7 },
  { gameId: 'swsh', label: 'Sword/Shield', platform: 'switch', generation: 8 },
  { gameId: 'bdsp', label: 'Brilliant Diamond/Shining Pearl', platform: 'switch', generation: 8 },
  { gameId: 'pla', label: 'Legends: Arceus', platform: 'switch', generation: 8 },
  { gameId: 'sv', label: 'Scarlet/Violet', platform: 'switch', generation: 9 },
  // Legends: Z-A — Gen-9-era release set in Kalos. HOME-native since HOME v4.0.0.
  // (No VERSION_GROUP_TO_GAME mapping yet — the PokéAPI version-group identifier
  // isn't confirmed here, so its availability stays "unknown" until mapped.)
  { gameId: 'za', label: 'Legends: Z-A', platform: 'switch', generation: 9 },
  // Gen 10, Switch 2 exclusive, 2027 — unreleased, so no availability/transfer yet.
  { gameId: 'ww', label: 'Winds/Waves', platform: 'switch2', generation: 10 },
  { gameId: 'go', label: 'Pokémon GO', platform: 'mobile', generation: 0 },
];

export const GAME_BY_ID = new Map(GAMES.map((g) => [g.gameId, g]));

/** PokéAPI version name → gameId. Unmapped versions (JP-only, GameCube) are ignored. */
export const VERSION_TO_GAME: Record<string, string> = {
  red: 'rb', blue: 'rb', yellow: 'yellow',
  gold: 'gs', silver: 'gs', crystal: 'c',
  ruby: 'rs', sapphire: 'rs', emerald: 'e', firered: 'frlg', leafgreen: 'frlg',
  diamond: 'dp', pearl: 'dp', platinum: 'pt', heartgold: 'hgss', soulsilver: 'hgss',
  black: 'bw', white: 'bw', 'black-2': 'b2w2', 'white-2': 'b2w2',
  x: 'xy', y: 'xy', 'omega-ruby': 'oras', 'alpha-sapphire': 'oras',
  sun: 'sm', moon: 'sm', 'ultra-sun': 'usum', 'ultra-moon': 'usum',
  'lets-go-pikachu': 'lgpe', 'lets-go-eevee': 'lgpe',
  sword: 'swsh', shield: 'swsh',
  'brilliant-diamond': 'bdsp', 'shining-pearl': 'bdsp',
  'legends-arceus': 'pla',
  scarlet: 'sv', violet: 'sv',
};

/**
 * PokéAPI `version_groups.identifier` → our gameId. DLC groups fold into their
 * base game (the-isle-of-armor → swsh, the-indigo-disk → sv). GameCube spin-offs
 * (colosseum, xd), Japan-only groups, and not-yet-released titles (legends-za,
 * champions, mega-dimension) are intentionally unmapped — availability sourced
 * from them is treated as "unknown" rather than guessed.
 */
export const VERSION_GROUP_TO_GAME: Record<string, string> = {
  'red-blue': 'rb', yellow: 'yellow', 'gold-silver': 'gs', crystal: 'c',
  'ruby-sapphire': 'rs', emerald: 'e', 'firered-leafgreen': 'frlg',
  'diamond-pearl': 'dp', platinum: 'pt', 'heartgold-soulsilver': 'hgss',
  'black-white': 'bw', 'black-2-white-2': 'b2w2', 'x-y': 'xy',
  'omega-ruby-alpha-sapphire': 'oras', 'sun-moon': 'sm', 'ultra-sun-ultra-moon': 'usum',
  'lets-go-pikachu-lets-go-eevee': 'lgpe', 'sword-shield': 'swsh',
  'the-isle-of-armor': 'swsh', 'the-crown-tundra': 'swsh',
  'brilliant-diamond-shining-pearl': 'bdsp', 'legends-arceus': 'pla',
  'scarlet-violet': 'sv', 'the-teal-mask': 'sv', 'the-indigo-disk': 'sv',
};

/**
 * Individual games the owner can actually possess — a *release*, one physical
 * cartridge / cart-image per row. Paired versions (Red **and** Blue) are listed
 * separately because you own one cartridge, not the pair. Each release maps to
 * its obtainability `versionGroup` (a GAMES `gameId`): dex availability is
 * genuinely per-group (a species in Red is in Blue too), so owning either
 * release lights up that group's availability. Ownership is tracked here; the
 * obtainability layer above stays at version-group granularity.
 */
export interface ReleaseMeta {
  releaseId: string; // PokéAPI version slug (e.g. 'red', 'lets-go-pikachu')
  label: string;
  platform: Platform;
  generation: number;
  versionGroup: string; // the GAMES gameId this release belongs to
}

/** Every individually-ownable release, in release order (drives the "My Games" list). */
export const RELEASES: ReleaseMeta[] = [
  { releaseId: 'red', label: 'Red', platform: 'gb', generation: 1, versionGroup: 'rb' },
  { releaseId: 'blue', label: 'Blue', platform: 'gb', generation: 1, versionGroup: 'rb' },
  { releaseId: 'yellow', label: 'Yellow', platform: 'gb', generation: 1, versionGroup: 'yellow' },
  { releaseId: 'gold', label: 'Gold', platform: 'gbc', generation: 2, versionGroup: 'gs' },
  { releaseId: 'silver', label: 'Silver', platform: 'gbc', generation: 2, versionGroup: 'gs' },
  { releaseId: 'crystal', label: 'Crystal', platform: 'gbc', generation: 2, versionGroup: 'c' },
  { releaseId: 'ruby', label: 'Ruby', platform: 'gba', generation: 3, versionGroup: 'rs' },
  { releaseId: 'sapphire', label: 'Sapphire', platform: 'gba', generation: 3, versionGroup: 'rs' },
  { releaseId: 'emerald', label: 'Emerald', platform: 'gba', generation: 3, versionGroup: 'e' },
  { releaseId: 'firered', label: 'FireRed', platform: 'gba', generation: 3, versionGroup: 'frlg' },
  { releaseId: 'leafgreen', label: 'LeafGreen', platform: 'gba', generation: 3, versionGroup: 'frlg' },
  { releaseId: 'diamond', label: 'Diamond', platform: 'ds', generation: 4, versionGroup: 'dp' },
  { releaseId: 'pearl', label: 'Pearl', platform: 'ds', generation: 4, versionGroup: 'dp' },
  { releaseId: 'platinum', label: 'Platinum', platform: 'ds', generation: 4, versionGroup: 'pt' },
  { releaseId: 'heartgold', label: 'HeartGold', platform: 'ds', generation: 4, versionGroup: 'hgss' },
  { releaseId: 'soulsilver', label: 'SoulSilver', platform: 'ds', generation: 4, versionGroup: 'hgss' },
  { releaseId: 'black', label: 'Black', platform: 'ds', generation: 5, versionGroup: 'bw' },
  { releaseId: 'white', label: 'White', platform: 'ds', generation: 5, versionGroup: 'bw' },
  { releaseId: 'black-2', label: 'Black 2', platform: 'ds', generation: 5, versionGroup: 'b2w2' },
  { releaseId: 'white-2', label: 'White 2', platform: 'ds', generation: 5, versionGroup: 'b2w2' },
  { releaseId: 'x', label: 'X', platform: '3ds', generation: 6, versionGroup: 'xy' },
  { releaseId: 'y', label: 'Y', platform: '3ds', generation: 6, versionGroup: 'xy' },
  { releaseId: 'omega-ruby', label: 'Omega Ruby', platform: '3ds', generation: 6, versionGroup: 'oras' },
  { releaseId: 'alpha-sapphire', label: 'Alpha Sapphire', platform: '3ds', generation: 6, versionGroup: 'oras' },
  { releaseId: 'sun', label: 'Sun', platform: '3ds', generation: 7, versionGroup: 'sm' },
  { releaseId: 'moon', label: 'Moon', platform: '3ds', generation: 7, versionGroup: 'sm' },
  { releaseId: 'ultra-sun', label: 'Ultra Sun', platform: '3ds', generation: 7, versionGroup: 'usum' },
  { releaseId: 'ultra-moon', label: 'Ultra Moon', platform: '3ds', generation: 7, versionGroup: 'usum' },
  { releaseId: 'lets-go-pikachu', label: "Let's Go Pikachu", platform: 'switch', generation: 7, versionGroup: 'lgpe' },
  { releaseId: 'lets-go-eevee', label: "Let's Go Eevee", platform: 'switch', generation: 7, versionGroup: 'lgpe' },
  { releaseId: 'sword', label: 'Sword', platform: 'switch', generation: 8, versionGroup: 'swsh' },
  { releaseId: 'shield', label: 'Shield', platform: 'switch', generation: 8, versionGroup: 'swsh' },
  { releaseId: 'brilliant-diamond', label: 'Brilliant Diamond', platform: 'switch', generation: 8, versionGroup: 'bdsp' },
  { releaseId: 'shining-pearl', label: 'Shining Pearl', platform: 'switch', generation: 8, versionGroup: 'bdsp' },
  { releaseId: 'legends-arceus', label: 'Legends: Arceus', platform: 'switch', generation: 8, versionGroup: 'pla' },
  { releaseId: 'scarlet', label: 'Scarlet', platform: 'switch', generation: 9, versionGroup: 'sv' },
  { releaseId: 'violet', label: 'Violet', platform: 'switch', generation: 9, versionGroup: 'sv' },
  { releaseId: 'legends-z-a', label: 'Legends: Z-A', platform: 'switch', generation: 9, versionGroup: 'za' },
  // Gen 10, Switch 2 exclusive, upcoming (2027). Listed so ownership can be
  // tracked ahead of launch; availability + HOME transfer stay unknown until then.
  { releaseId: 'winds', label: 'Winds', platform: 'switch2', generation: 10, versionGroup: 'ww' },
  { releaseId: 'waves', label: 'Waves', platform: 'switch2', generation: 10, versionGroup: 'ww' },
  { releaseId: 'go', label: 'Pokémon GO', platform: 'mobile', generation: 0, versionGroup: 'go' },
];

export const RELEASE_BY_ID = new Map(RELEASES.map((r) => [r.releaseId, r]));

const GAME_ORDER = new Map(GAMES.map((g, i) => [g.gameId, i]));

/** Sort gameIds by release order. */
export function byReleaseOrder(a: string, b: string): number {
  return (GAME_ORDER.get(a) ?? 999) - (GAME_ORDER.get(b) ?? 999);
}

/** gameIds that run on Nintendo Switch (drives `catchableOnSwitch`). */
export const SWITCH_GAME_IDS = new Set(GAMES.filter((g) => g.platform === 'switch').map((g) => g.gameId));
