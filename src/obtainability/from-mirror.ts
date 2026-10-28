import type pg from 'pg';
import type { EvolveFrom, Obtainability } from '../types.js';
import { RELEASE_BY_ID, VERSION_GROUP_TO_GAME, byReleaseOrder, releaseForVersion } from './games.js';
import { computeObtainabilityFromSources, mostDirect, type ObtainMethod, type ObtainSource } from './compute.js';
import { AVAILABILITY_EXCLUSIONS, EVENT_ONLY_FORMS, STARTER_GIFTS, STATIC_AVAILABILITY } from './curated.js';
import { addEvidence, emptyEvidence, versionRestriction, type RestrictionContext, type Subject } from './versions.js';
import { varietyFormSlug } from '../seed/expand.js';
import { curatedForm } from './regional-forms.js';

/** "kanto-route-25" → "Route 25"; "old-rod" → "old rod". */
const REGION_PREFIX = /^(kanto|johto|hoenn|sinnoh|sinnoh-pt|unova|unova-b2w2|kalos|alola|galar|hisui|paldea)-/;
export function prettyLocation(identifier: string, method: string): string {
  const stripped = identifier.replace(REGION_PREFIX, '');
  const words = stripped.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
  return method && method !== 'walk' ? `${words} (${method.replaceAll('-', ' ')})` : words;
}

/**
 * PokéAPI encounter methods that aren't a wild catch. Everything else (walk,
 * fishing, surf, headbutt, raids, overworld…) is `wild`.
 */
const ENCOUNTER_CLASS: Record<string, ObtainMethod> = {
  gift: 'gift', 'gift-egg': 'gift',
  'npc-trade': 'trade',
  static: 'static', pokeflute: 'static', 'squirt-bottle': 'static', 'wailmer-pail': 'static', 'devon-scope': 'static',
  'roaming-grass': 'roaming', 'roaming-water': 'roaming',
};
export const encounterClass = (method: string): ObtainMethod => ENCOUNTER_CLASS[method] ?? 'wild';

/**
 * Source obtainability for every species from the local PokéAPI mirror, keyed by
 * National Dex number. Availability comes from **pokédex membership** — which
 * games a species appears in (main-series regional dexes) — which already
 * includes legendaries, gifts and evolved forms, so it needs no wild/evolution
 * curation. A wild-encounter check tags the method; the curated shiny-lock +
 * static overlay is folded in by computeObtainabilityFromSources.
 *
 * Throws if the mirror schema/tables aren't present — the seed treats that as
 * "no obtainability this run" (best-effort; run the mirror job first).
 */
export async function obtainabilityFromMirror(client: pg.ClientBase, schema = 'pokeapi'): Promise<Map<number, Obtainability>> {
  return (await obtainabilityWithFormsFromMirror(client, schema)).byDex;
}

/** One summarized encounter list: the most direct method, and its locations. */
function summarizeEncounters(encs: { loc: string; method: string }[]): { method: ObtainMethod; locations: string[] } {
  const method = mostDirect(encs.map((x) => encounterClass(x.method))) as ObtainMethod;
  // Locations of the chosen method first, without a suffix that just repeats
  // it ("gift — Pallet Town", not "Pallet Town (gift)"); the rest keep theirs.
  const locations: string[] = [];
  const add = (pretty: string) => { if (!locations.includes(pretty)) locations.push(pretty); };
  for (const x of encs) {
    if (encounterClass(x.method) === method) add(prettyLocation(x.loc, method === 'wild' ? x.method : 'walk'));
  }
  for (const x of encs) if (encounterClass(x.method) !== method) add(prettyLocation(x.loc, x.method));
  return { method, locations };
}

const REGIONAL_VARIETY = '-(alola|galar|hisui|paldea)(-|$)';

/** Region of a regional form slug (`galar_standard` → galar); null for others (`alola_cap`, `totem_alola`). */
function regionOf(formSlug: string): string | null {
  const m = /^(alola|galar|hisui|paldea)(_|$)/.exec(formSlug);
  return m && !formSlug.endsWith('_cap') ? m[1]! : null;
}

/**
 * Games set in a regional form's own region, among those with per-form
 * encounter data. There, an original-form pre-evolution evolves into the
 * regional form (Pikachu → Alolan Raichu in Alola, Koffing → Galarian Weezing
 * in Galar), and the original form of a species with a native form isn't found.
 */
const NATIVE_GAMES: Record<string, string[]> = { alola: ['sm', 'usum'], galar: ['swsh'] };

/**
 * Species-level obtainability (`byDex`) plus per-form obtainability for
 * regional forms (`byForm`, keyed `${dex}:${formSlug}`, including the species'
 * default form). Regional forms differ from their species in two provable ways:
 *
 * - a form can't be in a game released before it was introduced (no Alolan
 *   Vulpix in Red/Blue);
 * - where the mirror has encounter rows per form (Gen 7 → SwSh), each form
 *   gets only its own rows — Vulpix in Sun/Moon is the Alolan one; a form
 *   with none is evolved, or absent beside the game's native regional form.
 *
 * - games with no per-form data (BDSP, PLA, SV, Z-A) use the cited table in
 *   regional-forms.ts for which forms exist there and how.
 */
export async function obtainabilityWithFormsFromMirror(
  client: pg.ClientBase,
  schema = 'pokeapi',
): Promise<{ byDex: Map<number, Obtainability>; byForm: Map<string, Obtainability> }> {
  const q = (name: string) => `"${schema.replaceAll('"', '""')}"."${name}"`;

  const meta = await client.query<{ id: string; generation_id: string; has_gender_differences: string; has_gmax: boolean }>(
    `select s.id, s.generation_id, s.has_gender_differences,
            exists(
              select 1 from ${q('pokemon')} p
              join ${q('pokemon_forms')} f on f.pokemon_id = p.id
              where p.species_id = s.id and f.identifier like '%-gmax'
            ) as has_gmax
     from ${q('pokemon_species')} s`,
  );

  // Which game version-groups is each species in (per game-specific regional
  // dex), and is it wild-encounterable there? The wild (species, version-group)
  // set is precomputed once in a CTE and left-joined, rather than a correlated
  // subquery per row — the mirror tables are unindexed text, so the one-pass
  // form is much cheaper on the full dataset.
  const membership = await client.query<{ species_id: string; version_group: string; wild: boolean }>(
    `with wild as (
       select distinct p.species_id, v.version_group_id
       from ${q('encounters')} e
       join ${q('versions')} v on v.id = e.version_id
       join ${q('pokemon')} p on p.id = e.pokemon_id
     )
     select dn.species_id, vg.identifier as version_group,
            bool_or(w.species_id is not null) as wild
     from ${q('pokemon_dex_numbers')} dn
     join ${q('pokedexes')} pd on pd.id = dn.pokedex_id and pd.is_main_series = '1'
     join ${q('pokedex_version_groups')} pvg on pvg.pokedex_id = dn.pokedex_id
     join ${q('version_groups')} vg on vg.id = pvg.version_group_id
     left join wild w on w.species_id = dn.species_id and w.version_group_id = vg.id
     group by dn.species_id, vg.identifier`,
  );

  // Where each species is wild-encounterable, per version-group: distinct
  // location + encounter-method pairs (mirror has this for Gen 1→SwSh; the
  // newest games ship no encounter rows, so their entries just omit locations).
  const encounterLocs = await client.query<{ species_id: string; version_group: string; loc: string; method: string; pokemon_id: string }>(
    `select distinct p.species_id, vg.identifier as version_group,
            l.identifier as loc, coalesce(em.identifier, 'walk') as method, p.id as pokemon_id
     from ${q('encounters')} e
     join ${q('versions')} v on v.id = e.version_id
     join ${q('version_groups')} vg on vg.id = v.version_group_id
     join ${q('pokemon')} p on p.id = e.pokemon_id
     join ${q('location_areas')} la on la.id = e.location_area_id
     join ${q('locations')} l on l.id = la.location_id
     left join ${q('encounter_slots')} es on es.id = e.encounter_slot_id
     left join ${q('encounter_methods')} em on em.id = es.encounter_method_id
     order by 1, 2, 3, 4`,
  );
  const encountersByKey = new Map<string, { loc: string; method: string }[]>(); // `${dex}:${gameId}`
  const encountersByVariety = new Map<string, { loc: string; method: string }[]>(); // `${pokemonId}:${gameId}`
  const pushEnc = (map: Map<string, { loc: string; method: string }[]>, key: string, enc: { loc: string; method: string }) => {
    const arr = map.get(key) ?? map.set(key, []).get(key)!;
    if (!arr.some((x) => x.loc === enc.loc && x.method === enc.method)) arr.push(enc);
  };
  for (const row of encounterLocs.rows) {
    const gameId = VERSION_GROUP_TO_GAME[row.version_group];
    if (!gameId) continue;
    const enc = { loc: row.loc, method: row.method };
    pushEnc(encountersByKey, `${row.species_id}:${gameId}`, enc);
    pushEnc(encountersByVariety, `${row.pokemon_id}:${gameId}`, enc);
  }
  const locsByKey = new Map<string, string[]>(); // `${dex}:${gameId}` -> pretty locations
  const encounterMethodByKey = new Map<string, ObtainMethod>(); // most direct encounter class
  for (const [key, encs] of encountersByKey) {
    const { method, locations } = summarizeEncounters(encs);
    encounterMethodByKey.set(key, method);
    locsByKey.set(key, locations);
  }

  // Serebii supplement (see src/supplement/): locations for the games PokéAPI
  // has no encounter data for (sv, za). Only ever fills gaps — mirror-derived
  // locations win — and only for games the species is already available in.
  // Best-effort: absent schema (job never run) just means no supplement.
  const supByKey = new Map<string, string[]>();
  // Per-cartridge catch evidence for version exclusives (see versions.ts).
  const evidence = emptyEvidence();
  try {
    const sup = await client.query<{ dex: string; game_id: string; version: string; locations: string[] }>(
      `select dex::text, game_id, version, locations from "supplement"."serebii_locations"`,
    );
    for (const row of sup.rows) {
      const release = row.version ? RELEASE_BY_ID.get(row.version) : undefined;
      if (release && release.versionGroup === row.game_id && row.locations.length) {
        addEvidence(evidence, Number(row.dex), row.game_id, release.releaseId);
      }
      const key = `${row.dex}:${row.game_id}`;
      if (locsByKey.has(key)) continue; // mirror data wins
      const arr: string[] = [];
      for (const l of row.locations) if (!arr.includes(l)) arr.push(l);
      const existing = supByKey.get(key);
      if (existing) { for (const l of arr) if (!existing.includes(l)) existing.push(l); }
      else supByKey.set(key, arr);
    }
  } catch { /* supplement schema not present — nothing to merge */ }

  // Which cartridges each species is wild in (DLC versions fold into theirs).
  // Per form too (subject `p<pokemon id>`), for regional forms' own exclusives.
  const wildVersions = await client.query<{ species_id: string; version: string; pokemon_id: string }>(
    `select distinct p.species_id, v.identifier as version, p.id as pokemon_id
     from ${q('encounters')} e
     join ${q('versions')} v on v.id = e.version_id
     join ${q('pokemon')} p on p.id = e.pokemon_id`,
  );
  for (const row of wildVersions.rows) {
    const releaseId = releaseForVersion(row.version);
    const release = releaseId ? RELEASE_BY_ID.get(releaseId) : undefined;
    if (!release) continue;
    addEvidence(evidence, Number(row.species_id), release.versionGroup, release.releaseId);
    addEvidence(evidence, `p${row.pokemon_id}`, release.versionGroup, release.releaseId);
  }

  // How each species is reached by evolution: its pre-evolution, and whether
  // every evolution path to it requires a trade (Kadabra → Alakazam).
  const evolutions = await client.query<{ id: string; from_id: string; from_name: string; trade_only: boolean }>(
    `select s.id, s.evolves_from_species_id as from_id, fs.identifier as from_name,
            bool_and(coalesce(et.identifier, '') = 'trade') as trade_only
     from ${q('pokemon_species')} s
     join ${q('pokemon_species')} fs on fs.id = s.evolves_from_species_id
     left join ${q('pokemon_evolution')} pe on pe.evolved_species_id = s.id
     left join ${q('evolution_triggers')} et on et.id = pe.evolution_trigger_id
     group by s.id, s.evolves_from_species_id, fs.identifier`,
  );
  const evolveFromByDex = new Map<number, EvolveFrom>();
  for (const row of evolutions.rows) {
    const name = row.from_name.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
    evolveFromByDex.set(Number(row.id), { dex: Number(row.from_id), name, trade: row.trade_only });
  }

  const sourcesByDex = new Map<number, ObtainSource[]>();
  const push = (dex: number, source: ObtainSource) => {
    const arr = sourcesByDex.get(dex);
    if (arr) arr.push(source);
    else sourcesByDex.set(dex, [source]);
  };
  // Dex membership isn't obtainability for event-only listings (Jirachi is in
  // the Hoenn dex but was never catchable in gen 3) — drop the curated
  // exceptions; real routes come back via STATIC_AVAILABILITY.
  const members = membership.rows
    .map((row) => ({ row, dex: Number(row.species_id), gameId: VERSION_GROUP_TO_GAME[row.version_group] }))
    .filter((m): m is typeof m & { gameId: string } => Boolean(m.gameId) && !AVAILABILITY_EXCLUSIONS[m.dex]?.includes(m.gameId!));
  const inGame = new Set(members.map((m) => `${m.dex}:${m.gameId}`));
  const membersByDex = new Map<number, typeof members>();
  for (const m of members) (membersByDex.get(m.dex) ?? membersByDex.set(m.dex, []).get(m.dex)!).push(m);

  // Regional forms + their species' default form (best-effort: a mirror without
  // form metadata just means species-level obtainability for every form).
  interface Variety { pokemonId: string; dex: number; formSlug: string; suffix: string; introGame: string | null }
  const varieties: Variety[] = [];
  try {
    const rows = await client.query<{ pokemon_id: string; species_id: string; identifier: string; species: string; is_default: string; intro_vg: string | null }>(
      `select p.id as pokemon_id, p.species_id, p.identifier, s.identifier as species, p.is_default,
              vg.identifier as intro_vg
       from ${q('pokemon')} p
       join ${q('pokemon_species')} s on s.id = p.species_id
       left join ${q('pokemon_forms')} f on f.pokemon_id = p.id and f.is_default = '1'
       left join ${q('version_groups')} vg on vg.id = f.introduced_in_version_group_id
       where p.species_id in (select species_id from ${q('pokemon')} where identifier ~ '${REGIONAL_VARIETY}')
         and (p.is_default = '1' or p.identifier ~ '${REGIONAL_VARIETY}')`,
    );
    for (const r of rows.rows) {
      const isDefault = r.is_default === '1';
      const formSlug = isDefault ? 'default' : varietyFormSlug(r.identifier, r.species);
      varieties.push({
        pokemonId: r.pokemon_id,
        dex: Number(r.species_id),
        formSlug,
        suffix: isDefault ? '' : (regionOf(formSlug) ?? formSlug), // 'alola', 'galar', …
        introGame: isDefault || !r.intro_vg ? null : (VERSION_GROUP_TO_GAME[r.intro_vg] ?? null),
      });
    }
  } catch { /* mirror without form metadata — species-level only */ }
  const varietyBySuffix = new Map(varieties.map((v) => [`${v.dex}:${v.suffix}`, v]));
  const varietyByPid = new Map(varieties.map((v) => [v.pokemonId, v]));
  // A form isn't in games released before it was introduced, nor — in games
  // with only species-level data — when the curated table leaves it out.
  const formInGame = (v: Variety, gameId: string) =>
    (!v.introGame || byReleaseOrder(gameId, v.introGame) >= 0) && curatedForm(gameId, v.dex, v.formSlug) !== null;

  // Subjects are species (dex) or forms (`p<pokemon id>`). A form evolves from
  // its pre-evolution's same-region form when there is one (Galarian Rapidash ←
  // Galarian Ponyta), else from the species.
  const variety = (s: Subject) => (typeof s === 'string' ? varietyByPid.get(s.slice(1)) : undefined);
  const ctx: RestrictionContext = {
    evidence,
    evolvesFrom: (s) => {
      const v = variety(s);
      const preDex = evolveFromByDex.get(v ? v.dex : Number(s))?.dex;
      if (preDex === undefined) return null;
      const preVariety = v ? varietyBySuffix.get(`${preDex}:${v.suffix}`) : undefined;
      return preVariety ? `p${preVariety.pokemonId}` : preDex;
    },
    inGame: (s, gameId) => {
      const v = variety(s);
      return v ? inGame.has(`${v.dex}:${gameId}`) && formInGame(v, gameId) : inGame.has(`${s}:${gameId}`);
    },
  };

  /** One game's source for a species (`form` absent) or one of its forms. */
  const sourceFor = (row: (typeof members)[number]['row'], dex: number, gameId: string, form?: Variety): ObtainSource => {
    const key = `${dex}:${gameId}`;
    // Per-form encounter rows exist for this game: use only this form's.
    if (form && encountersByKey.has(key)) {
      const own = encountersByVariety.get(`${form.pokemonId}:${gameId}`);
      const sum = own ? summarizeEncounters(own) : null;
      const versions = versionRestriction(`p${form.pokemonId}`, gameId, ctx);
      return {
        gameId, method: sum?.method ?? 'available',
        ...(sum ? { locations: sum.locations } : {}),
        ...(versions ? { versions } : {}),
      };
    }
    // Curated games: a form with its own entry uses it; a regional form whose
    // species' default isn't in the game owns every species-level row.
    const cur = form ? curatedForm(gameId, dex, form.formSlug) : undefined;
    const hasOwnEntry = Boolean(cur && (cur.method || cur.locations || cur.versions));
    const besideDefault = Boolean(cur && form!.formSlug !== 'default' && curatedForm(gameId, dex, 'default') !== null);
    if (cur && (hasOwnEntry || besideDefault)) {
      return {
        gameId, method: cur.method ?? 'available',
        ...(cur.locations ? { locations: cur.locations } : {}),
        ...(cur.versions ? { versions: cur.versions } : {}),
      };
    }
    const locations = locsByKey.get(key) ?? supByKey.get(key);
    const versions = versionRestriction(dex, gameId, ctx);
    // Encounter rows say how (wild / gift / trade / static / roaming); a dex
    // member with no rows is just `available`.
    const method = encounterMethodByKey.get(key) ?? (row.wild ? 'wild' : 'available');
    return {
      gameId, method,
      ...(locations ? { locations } : {}),
      ...(versions ? { versions } : {}),
    };
  };

  // Curated static/gift as a supplement, for the rare mon a regional dex omits.
  const curated = (dex: number): ObtainSource[] => [
    ...(STATIC_AVAILABILITY[dex] ?? []).map((e): ObtainSource => ({ gameId: e.gameId, method: e.method })),
    ...(STARTER_GIFTS[dex] ?? []).map((gameId): ObtainSource => ({ gameId, method: 'gift' })),
  ];

  for (const { row, dex, gameId } of members) push(dex, sourceFor(row, dex, gameId));
  for (const dexStr of new Set([...Object.keys(STATIC_AVAILABILITY), ...Object.keys(STARTER_GIFTS)])) {
    for (const s of curated(Number(dexStr))) push(Number(dexStr), s);
  }

  const metaByDex = new Map(meta.rows.map((m) => [Number(m.id), m]));
  const build = (dex: number, sources: ObtainSource[]): Obtainability => {
    const m = metaByDex.get(dex)!;
    return computeObtainabilityFromSources({
      dex,
      generation: Number(m.generation_id),
      hasGenderDifferences: m.has_gender_differences === '1',
      hasGmaxVariety: m.has_gmax,
      sources,
      evolveFrom: evolveFromByDex.get(dex) ?? null,
    });
  };

  const byDex = new Map<number, Obtainability>();
  for (const dex of metaByDex.keys()) byDex.set(dex, build(dex, sourcesByDex.get(dex) ?? []));

  // A form with no encounter rows of its own, in a game whose data is per form:
  // evolve it from an obtainable pre-evolution, or — an original form beside
  // the game's own native regional form — it isn't there (no Kantonian Vulpix
  // in Sun/Moon). Anything else stays as the data says (a mirror gap is not
  // proof of absence).
  const gamesWithEncounters = new Set([...encountersByKey.keys()].map((k) => k.slice(k.indexOf(':') + 1)));
  const varietiesByDex = new Map<number, Variety[]>();
  for (const v of varieties) (varietiesByDex.get(v.dex) ?? varietiesByDex.set(v.dex, []).get(v.dex)!).push(v);
  type Presence = 'rows' | 'evolve' | 'absent' | 'unknown';
  const presence = new Map<string, Presence>();
  const obtainable = (s: Subject, gameId: string): boolean => {
    const v = variety(s);
    return v ? presenceOf(v, gameId) !== 'absent' : inGame.has(`${s}:${gameId}`);
  };
  const presenceOf = (v: Variety, gameId: string): Presence => {
    const key = `${v.pokemonId}:${gameId}`;
    const known = presence.get(key);
    if (known) return known;
    presence.set(key, 'unknown'); // cycle guard
    let p: Presence;
    if (!inGame.has(`${v.dex}:${gameId}`) || !formInGame(v, gameId)) p = 'absent';
    else if (encountersByVariety.has(key)) p = 'rows';
    else if (!gamesWithEncounters.has(gameId) || curatedForm(gameId, v.dex, v.formSlug) !== undefined
      || (v.formSlug !== 'default' && !regionOf(v.formSlug))) p = 'unknown';
    else {
      const native = v.formSlug === 'default'
        ? (varietiesByDex.get(v.dex) ?? []).find((o) => o !== v && NATIVE_GAMES[o.suffix]?.includes(gameId) && obtainable(`p${o.pokemonId}`, gameId))
        : undefined;
      const pre = ctx.evolvesFrom(`p${v.pokemonId}`);
      const preDex = evolveFromByDex.get(v.dex)?.dex;
      // Natively, an original pre-evolution without a native form of its own
      // evolves into the regional form, not this one.
      const yieldsNative = native !== undefined && !varietyBySuffix.has(`${preDex}:${native.suffix}`);
      if (pre !== null && !yieldsNative && obtainable(pre, gameId)) p = 'evolve';
      else p = native ? 'absent' : 'unknown';
    }
    presence.set(key, p);
    return p;
  };

  const byForm = new Map<string, Obtainability>();
  for (const v of varieties) {
    if (!metaByDex.has(v.dex)) continue;
    const sources: ObtainSource[] = [];
    for (const { row, gameId } of membersByDex.get(v.dex) ?? []) {
      if (!formInGame(v, gameId)) continue;
      const p = presenceOf(v, gameId);
      if (p === 'absent') continue;
      const s = sourceFor(row, v.dex, gameId, v);
      sources.push(p === 'evolve' ? { gameId, method: 'evolve', ...(s.versions ? { versions: s.versions } : {}) } : s);
    }
    for (const s of curated(v.dex)) if (formInGame(v, s.gameId)) sources.push(s);
    byForm.set(`${v.dex}:${v.formSlug}`, build(v.dex, sources));
  }
  // Event-only forms (Pikachu in a cap): no game gives one, nothing evolves into one.
  for (const key of EVENT_ONLY_FORMS) {
    const base = byDex.get(Number(key.split(':')[0]));
    if (base) byForm.set(key, { ...base, availability: [], catchableOnSwitch: false, unobtainableLegit: true, evolveFrom: null });
  }
  return { byDex, byForm };
}
