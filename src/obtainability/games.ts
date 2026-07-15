/**
 * Game / version metadata for the obtainability layer.
 *
 * PokéAPI reports wild encounters per *version* (e.g. `red`, `sword`); we roll
 * those up to a *gameId* (a version-group-ish slug like `rb`, `swsh`) for
 * display, matching the slugs the HOME importer already emits (`swsh`, `sv`,
 * `go`, `lgpe`, `xy`, `oras`) and the front-end's GAME_LABELS.
 */

export type Platform = 'gb' | 'gbc' | 'gba' | 'ds' | '3ds' | 'switch' | 'mobile';

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

const GAME_ORDER = new Map(GAMES.map((g, i) => [g.gameId, i]));

/** Sort gameIds by release order. */
export function byReleaseOrder(a: string, b: string): number {
  return (GAME_ORDER.get(a) ?? 999) - (GAME_ORDER.get(b) ?? 999);
}

/** gameIds that run on Nintendo Switch (drives `catchableOnSwitch`). */
export const SWITCH_GAME_IDS = new Set(GAMES.filter((g) => g.platform === 'switch').map((g) => g.gameId));
