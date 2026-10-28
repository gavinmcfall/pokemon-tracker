/**
 * Which forms of a regional-variant species are obtainable in-game, for the
 * games whose mirror data is species-level only (no per-form encounter rows):
 * BDSP, Legends: Arceus, Scarlet/Violet (+ DLC) and Legends: Z-A (+ Mega
 * Dimension). Without this, a species in a game's dex counts every one of its
 * forms as obtainable there (Galarian Ponyta "in" BDSP, Kantonian Growlithe "in"
 * Legends: Arceus).
 *
 * Shape: gameId → dex → formSlug → how. A species not listed for a curated game
 * has only its default form there (the common case). A listed species has
 * exactly the forms listed. `default` with no fields keeps the species-level
 * method/locations; a regional form with no fields does too when the species'
 * default form isn't in that game (so every species-level row is that form).
 * HOME transfer-only and event-only forms are NOT listed. Keys are
 * `varietyFormSlug` values (`alola`, `galar`, `hisui`, `paldea_blaze_breed`…).
 *
 * Researched 2026-10-28. Primary source: Serebii per-game Pokédexes and
 * per-species pages; corroborated by PokémonDB, Dittobase and guide sites
 * (Bulbapedia refused automated fetches). Sources per game below.
 */
import type { ObtainMethod } from './compute.js';

export interface FormSource {
  method?: ObtainMethod;
  locations?: string[];
  /** Release ids when only some cartridges have it (Scarlet vs Violet). */
  versions?: string[];
}

export type GameForms = Readonly<Record<number, Readonly<Record<string, FormSource>>>>;

const hisuiOnly = { hisui: {} } as const;

export const REGIONAL_FORMS_BY_GAME: Readonly<Record<string, GameForms>> = {
  // BDSP: no regional forms at all; only National Dex #1–493, original forms.
  // https://www.serebii.net/brilliantdiamondshiningpearl/unobtainable.shtml
  // https://pokemondb.net/pokedex/game/brilliant-diamond-shining-pearl
  bdsp: {},

  // Legends: Arceus (Daybreak added no forms). Hisuian forms replace the
  // original — "If caught in Hisui, it will have its Hisuian Form" — except
  // Sneasel, whose original form is in Obsidian space-time distortions.
  // No Alolan/Galarian/Paldean forms.
  // https://www.serebii.net/legendsarceus/hisuipokedex.shtml
  // https://pokemondb.net/pokedex/game/legends-arceus
  // https://www.serebii.net/pokedex-swsh/sneasel/
  pla: {
    58: hisuiOnly, 59: hisuiOnly, 100: hisuiOnly, 101: hisuiOnly, 157: hisuiOnly,
    211: hisuiOnly, 503: hisuiOnly, 549: hisuiOnly, 570: hisuiOnly, 571: hisuiOnly,
    628: hisuiOnly, 705: hisuiOnly, 706: hisuiOnly, 713: hisuiOnly, 724: hisuiOnly,
    215: {
      default: { method: 'wild', locations: ['Space-time distortion (Obsidian Fieldlands)'] },
      hisui: { method: 'wild', locations: ['Celestica Trail', 'Primeval Grotto', "Avalugg's Legacy", 'Glacier Terrace'] },
    },
  },

  // Scarlet/Violet + The Teal Mask + The Indigo Disk. Regional forms come from
  // the Blueberry Pokédex (form-suffixed sprites) and the Paldea Pokédex
  // (Paldean Wooper/Tauros); Kitakami has none. Not listed = transfer-only
  // (e.g. Alolan Raichu, every Hisuian form but Qwilfish).
  // https://www.serebii.net/scarletviolet/blueberrypokedex.shtml
  // https://www.serebii.net/scarletviolet/paldeapokedex.shtml
  // https://www.serebii.net/scarletviolet/kitakamipokedex.shtml
  // https://serebii.net/scarletviolet/leagueclubtrades.shtml
  // https://www.serebii.net/pokedex-sv/<species>/ (per-version locations)
  sv: {
    27: { default: {}, alola: { method: 'wild', locations: ['Polar Biome (Terarium)'], versions: ['violet'] } },
    28: { default: {}, alola: { method: 'evolve', locations: ['Evolve Alolan Sandshrew (Ice Stone)'], versions: ['violet'] } },
    37: { default: {}, alola: { method: 'wild', locations: ['Polar Biome (Terarium)'], versions: ['scarlet'] } },
    38: { default: {}, alola: { method: 'evolve', locations: ['Evolve Alolan Vulpix (Ice Stone)'], versions: ['scarlet'] } },
    50: { default: {}, alola: { method: 'wild', locations: ['Coastal Biome (Terarium)', 'Torchlit Labyrinth'] } },
    51: { default: {}, alola: { method: 'wild', locations: ['Coastal Biome (Terarium)', 'Torchlit Labyrinth'] } },
    // Alolan Meowth: Serebii's Meowth page only (League Club trade) — single source.
    // Galarian Meowth: https://www.nintendolife.com/guides/pokemon-scarlet-and-violet-how-to-get-galarian-meowth
    52: {
      default: {},
      alola: { method: 'trade', locations: ['League Club trade (Salvatore)'] },
      galar: { method: 'gift', locations: ['Salvatore, after the language final'] },
    },
    53: { default: {}, alola: { method: 'evolve', locations: ['Evolve Alolan Meowth (friendship)'] } },
    74: { default: {}, alola: { method: 'wild', locations: ['Canyon Biome (Terarium)', 'Chargestone Cavern'] } },
    75: { default: {}, alola: { method: 'wild', locations: ['Canyon Biome (Terarium)', 'Chargestone Cavern'] } },
    76: { default: {}, alola: { method: 'evolve', locations: ['Trade-evolve Alolan Graveler'] } },
    // https://www.ggrecon.com/guides/galarian-slowpoke-evolution-pokemon-scarlet-violet-indigo-disk/
    79: { default: {}, galar: { method: 'wild', locations: ['Coastal Biome (Terarium)'] } },
    80: { default: {}, galar: { method: 'evolve', locations: ['Evolve Galarian Slowpoke (Galarica Cuff)'] } },
    88: { default: {}, alola: { method: 'wild', locations: ['Coastal Biome (Terarium)', 'Torchlit Labyrinth'] } },
    89: { default: {}, alola: { method: 'wild', locations: ['Coastal Biome (Terarium)', 'Torchlit Labyrinth'] } },
    103: {
      default: { method: 'wild', locations: ['Savanna Biome (Terarium)'] },
      alola: { method: 'wild', locations: ['Coastal Biome (Terarium)'] },
    },
    // Kantonian Tauros: Savanna Biome (Terarium). Blaze = Scarlet, Aqua = Violet.
    128: {
      default: { method: 'wild', locations: ['Savanna Biome (Terarium)'] },
      paldea_combat_breed: { method: 'wild', locations: ['Asado Desert', 'East Province', 'West Province (Area Two)'] },
      paldea_blaze_breed: { method: 'wild', locations: ['Asado Desert', 'East Province', 'West Province (Area Two)'], versions: ['scarlet'] },
      paldea_aqua_breed: { method: 'wild', locations: ['Asado Desert', 'East Province', 'West Province (Area Two)'], versions: ['violet'] },
    },
    // Johtonian Wooper in Kitakami; Paldean Wooper across Paldea.
    194: {
      default: { method: 'wild', locations: ['Kitakami (The Teal Mask)'] },
      paldea: { method: 'wild', locations: ['Alfornada Cavern', 'Glaseado Mountain', 'Tagtree Thicket'] },
    },
    199: { default: {}, galar: { method: 'evolve', locations: ['Evolve Galarian Slowpoke (Galarica Wreath)'] } },
    211: { default: {}, hisui: { method: 'wild', locations: ['Polar Biome (Terarium)'] } },
  },

  // Legends: Z-A + Mega Dimension (folded into `za`). Only Alolan Raichu and
  // Galarian Slowpoke/Slowbro/Slowking/Stunfisk are in the base game (side
  // missions); the rest are Hyperspace Lumiose (DLC) wild spawns.
  // https://www.serebii.net/legendsz-a/availablepokemon.shtml
  // https://serebii.net/legendsz-a/hyperspacepokedex.shtml
  // https://www.serebii.net/pokedex-sv/<NNN>.shtml (Z-A sections, split by form)
  // https://www.dittobase.com/legends-za/pokedex/
  // https://www.dexerto.com/wikis/pokemon-legends-z-a/all-regional-forms-and-evolutions/
  za: {
    26: { default: {}, alola: { method: 'wild', locations: ['Side Mission 108 "Alola, Raichu!" (trade)', 'Hyperspace Lumiose (Electric)'] } },
    52: {
      default: {},
      alola: { method: 'wild', locations: ['Hyperspace Lumiose (Dark)'] },
      galar: { method: 'wild', locations: ['Hyperspace Lumiose (Steel)'] },
    },
    53: { default: {}, alola: { method: 'wild', locations: ['Hyperspace Lumiose (Dark)'] } },
    79: { default: {}, galar: { method: 'wild', locations: ['Side Mission 39 "Slowpoke for Slowpoke" (trade)', 'Hyperspace Lumiose (Psychic, Poison)'] } },
    80: { default: {}, galar: { method: 'wild', locations: ['Side Mission 75 (Galarica Cuff)', 'Hyperspace Lumiose (Poison)'] } },
    83: { default: {}, galar: { method: 'wild', locations: ['Hyperspace Lumiose (Fighting)'] } },
    105: { default: {}, alola: { method: 'wild', locations: ['Hyperspace Lumiose (Fire)'] } },
    122: { default: {}, galar: { method: 'wild', locations: ['Hyperspace Lumiose (Ice)'] } },
    199: { default: {}, galar: { method: 'wild', locations: ['Side Mission 75 (Galarica Wreath)', 'Hyperspace Lumiose (Poison)'] } },
    211: { default: {}, hisui: { method: 'wild', locations: ['Hyperspace Lumiose (Poison)'] } },
    562: { default: {}, galar: { method: 'wild', locations: ['Hyperspace Lumiose (Ground, Ghost)'] } },
    618: { default: {}, galar: { method: 'wild', locations: ['Side Mission 72 "Find My Galarian Stunfisk!" (gift)', 'Hyperspace Lumiose (Ground)'] } },
    705: { default: {}, hisui: { method: 'wild', locations: ['Hyperspace Lumiose (Dragon)'] } },
    706: { default: {}, hisui: { method: 'wild', locations: ['Hyperspace Lumiose (Dragon)'] } },
    713: { default: {}, hisui: { method: 'wild', locations: ['Hyperspace Lumiose (Ice)'] } },
  },
};

/**
 * Curated verdict for one form in one game: `undefined` = game not curated
 * (use the mirror's own rules), `null` = not obtainable there, else how.
 */
export function curatedForm(gameId: string, dex: number, formSlug: string): FormSource | null | undefined {
  const game = REGIONAL_FORMS_BY_GAME[gameId];
  if (!game) return undefined;
  const species = game[dex];
  if (!species) return formSlug === 'default' ? {} : null;
  return species[formSlug] ?? null;
}
