/** Name mapping between pokepc/dataset and the tracker. No data import, so
 *  scripts/update-pokepc.ts can use it to generate pokepc-data.ts. */

/** pokepc cartridge id → tracker release ids. Others (bank, home, colosseum,
 *  XD, ranch, champions, box) are not games the tracker plans catches in.
 *  pokepc's FireRed/LeafGreen is one cartridge on GBA and Switch (2026); the
 *  tracker splits them because only the Switch release reaches HOME. */
export const POKEPC_CARTRIDGES: Record<string, string[]> = {
  'rb-r': ['red'], 'rb-b': ['blue'], y: ['yellow'], 'gs-g': ['gold'], 'gs-s': ['silver'], c: ['crystal'],
  'rs-r': ['ruby'], 'rs-s': ['sapphire'], e: ['emerald'],
  'frlg-fr': ['firered', 'firered-switch'], 'frlg-lg': ['leafgreen', 'leafgreen-switch'],
  'dp-d': ['diamond'], 'dp-p': ['pearl'], pt: ['platinum'], 'hgss-hg': ['heartgold'], 'hgss-ss': ['soulsilver'],
  'bw-b': ['black'], 'bw-w': ['white'], 'b2w2-b2': ['black-2'], 'b2w2-w2': ['white-2'],
  'xy-x': ['x'], 'xy-y': ['y'], 'oras-or': ['omega-ruby'], 'oras-as': ['alpha-sapphire'],
  'sm-s': ['sun'], 'sm-m': ['moon'], 'usum-us': ['ultra-sun'], 'usum-um': ['ultra-moon'],
  'lgpe-lgp': ['lets-go-pikachu'], 'lgpe-lge': ['lets-go-eevee'], 'swsh-sw': ['sword'], 'swsh-sh': ['shield'],
  'bdsp-bd': ['brilliant-diamond'], 'bdsp-sp': ['shining-pearl'], la: ['legends-arceus'],
  'sv-s': ['scarlet'], 'sv-v': ['violet'], lza: ['legends-z-a'], go: ['go'],
};

/**
 * Where a form can be kept, from pokepc's `storableIn` and `isBattleOnlyForm`:
 * `home` — Pokémon HOME stores it (most forms); `save` — HOME can't (fusions
 * and held-item forms revert or are refused), so it lives in a game save;
 * `battle` — it only exists mid-battle, so what you keep is the base form plus
 * the item that triggers it, in a game that can.
 */
export type PokepcStorage = 'home' | 'save' | 'battle';

export function pokepcStorage(storableIn: string[] | undefined, battleOnly: boolean): PokepcStorage {
  if (battleOnly) return 'battle';
  return (storableIn ?? []).includes('home') ? 'home' : 'save';
}

/**
 * The species prefix of a dex number's pokepc record ids: the hyphen segments
 * they all share (`minior`, `minior-red`, `minior-blue` → `minior`). A species
 * with one record is its whole id (`mr-mime`).
 */
export function speciesPrefix(ids: string[]): string {
  const parts = ids.map((id) => id.split('-'));
  const first = parts[0] ?? [];
  let n = first.length;
  for (const p of parts) {
    let i = 0;
    while (i < n && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('-');
}

/**
 * The tracker form slug for a pokepc record: its name (PokéAPI form name when
 * pokepc has one) minus the species prefix, `-` → `_` (`unown-a` → `a`,
 * `tauros-paldea-blaze-breed` → `paldea_blaze_breed`). A default record also
 * answers to `default`, since the seed calls a species' only form that
 * (`meloetta-aria` is Meloetta).
 */
export function pokepcSlugs(prefix: string, name: string, isDefault: boolean): { slug: string; alias: string | null } {
  const rest = name.startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : '';
  const slug = rest === '' ? 'default' : rest.replaceAll('-', '_');
  return { slug, alias: isDefault && slug !== 'default' ? 'default' : null };
}
