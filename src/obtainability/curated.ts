/**
 * Curated obtainability overlays — the finite, well-documented facts PokéAPI
 * does not expose (shiny locks, static/gift availability for mons with no wild
 * encounter tables). Derivable facts (wild encounters, evolution, gmax, gender
 * differences) are computed in compute.ts and must NOT be duplicated here.
 *
 * This is a spot-checkable v1 focused on high-confidence, well-defined cases
 * (primarily gen 6–9 starters and box/static legendaries, where shiny locks are
 * consistent and documented). It is intended to be extended over time — the
 * shapes matter as much as the current contents. Keys are National Dex numbers.
 */

export type StaticMethod = 'gift' | 'static' | 'event' | 'roaming' | 'fossil' | 'trade';

export interface StaticAvailability {
  gameId: string;
  method: StaticMethod;
}

/**
 * Species whose shiny form is not legitimately obtainable in ANY game
 * (shiny-locked everywhere, never distributed as shiny). High-confidence only —
 * when in doubt, omit (the default is "shiny is legal"). Mostly event mythicals
 * that have never had a shiny release.
 */
export const SHINY_LOCKED_EVERYWHERE = new Set<number>([
  494, // Victini
  649, // Genesect
  801, // Magearna
  807, // Zeraora (shiny never released as of this dataset)
  893, // Zarude
]);

/**
 * Species/forms not legitimately obtainable at all (event-only distributions
 * that never happened, or removed content). Keyed by dex; keep tiny + certain.
 */
export const UNOBTAINABLE_LEGIT = new Set<number>([
  // (intentionally conservative — populate as concrete cases are confirmed)
]);

/**
 * Per-game shiny locks for static/gift encounters: `gameId -> dex numbers`
 * that are shiny-locked when obtained in that game. Covers the consistent,
 * documented modern cases (gen 6–9 starters + box/version legendaries).
 */
export const STATIC_SHINY_LOCK: Record<string, number[]> = {
  // Gen 6
  xy: [650, 651, 652, 653, 654, 655, 656, 657, 658, 716, 717], // Kalos starters + Xerneas/Yveltal
  oras: [252, 253, 254, 255, 256, 257, 258, 259, 260, 383, 382, 384], // Hoenn starters + Groudon/Kyogre/Rayquaza
  // Gen 7
  sm: [722, 723, 724, 725, 726, 727, 728, 729, 730, 791, 792, 800], // Alola starters + Solgaleo/Lunala/Necrozma
  usum: [722, 723, 724, 725, 726, 727, 728, 729, 730, 791, 792, 800],
  // Gen 8
  swsh: [810, 811, 812, 813, 814, 815, 816, 817, 818, 888, 889, 890], // Galar starters + Zacian/Zamazenta/Eternatus
  bdsp: [387, 388, 389, 390, 391, 392, 393, 394, 395, 483, 484, 487], // Sinnoh starters + Dialga/Palkia/Giratina
  pla: [722, 155, 501, 483, 484, 486, 641, 642, 645, 905], // Hisui starters + fixed encounters (Dialga/Palkia/Enamorus…)
  // Gen 9
  sv: [906, 907, 908, 909, 910, 911, 912, 913, 914, 1007, 1008], // Paldea starters + Koraidon/Miraidon
};

/**
 * Static / gift / event availability for notable mons that have no wild
 * encounter tables (so their availability isn't blank). `dex -> entries`.
 * v1 covers the gen 6–9 box legendaries and starters that pair with the shiny
 * locks above; extend as needed. Wild-catchable and evolution-reachable mons
 * are handled by compute.ts and don't belong here.
 */
export const STATIC_AVAILABILITY: Record<number, StaticAvailability[]> = {
  // Kalos legendaries
  716: [{ gameId: 'xy', method: 'static' }],
  717: [{ gameId: 'xy', method: 'static' }],
  // Hoenn box legendaries (ORAS)
  382: [{ gameId: 'oras', method: 'static' }],
  383: [{ gameId: 'oras', method: 'static' }],
  384: [{ gameId: 'oras', method: 'static' }],
  // Alola legendaries
  791: [{ gameId: 'sm', method: 'static' }, { gameId: 'usum', method: 'static' }],
  792: [{ gameId: 'sm', method: 'static' }, { gameId: 'usum', method: 'static' }],
  800: [{ gameId: 'sm', method: 'static' }, { gameId: 'usum', method: 'static' }],
  // Galar legendaries
  888: [{ gameId: 'swsh', method: 'static' }],
  889: [{ gameId: 'swsh', method: 'static' }],
  890: [{ gameId: 'swsh', method: 'static' }],
  // Paldea legendaries
  1007: [{ gameId: 'sv', method: 'static' }],
  1008: [{ gameId: 'sv', method: 'static' }],
};

/** Starter lines are gift-obtained in their debut region's games. dex -> gameIds. */
export const STARTER_GIFTS: Record<number, string[]> = {
  // Gen 6 Kalos
  650: ['xy'], 653: ['xy'], 656: ['xy'],
  // Gen 8 Galar
  810: ['swsh'], 813: ['swsh'], 816: ['swsh'],
  // Gen 9 Paldea
  906: ['sv'], 909: ['sv'], 912: ['sv'],
};
