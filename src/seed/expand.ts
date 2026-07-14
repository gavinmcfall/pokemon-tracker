import type { Entry, Gender, SeedTier } from '../types.js';
import { entryKeyOf } from '../types.js';
import type { RawForm, RawPokemon, RawSpecies } from './pokeapi.js';

/**
 * Everything the expansion needs for one species, prefetched by the runner.
 * `pokemons` holds the included varieties; `forms` holds every pokemon-form
 * fetched for those varieties (labels + cosmetic siblings).
 */
export interface SpeciesBundle {
  species: RawSpecies;
  pokemons: Map<string, RawPokemon>;
  forms: Map<string, RawForm>;
}

const REGIONAL_SEGMENTS = new Set(['alola', 'alolan', 'galar', 'galarian', 'hisui', 'hisuian', 'paldea', 'paldean']);

/** gender_rate → entries to create (spec §3). Non-full tiers collapse dual-gender species to one slot. */
export function gendersFor(genderRate: number, tier: SeedTier): Gender[] {
  if (genderRate === -1) return ['genderless'];
  if (genderRate === 0) return ['male'];
  if (genderRate === 8) return ['female'];
  return tier === 'full' ? ['male', 'female'] : ['male'];
}

export function isRegionalVariety(varietyName: string): boolean {
  return varietyName.split('-').some((segment) => REGIONAL_SEGMENTS.has(segment));
}

/** Which of a species' varieties become entries at this tier. */
export function includedVarieties(species: RawSpecies, tier: SeedTier): { name: string; isDefault: boolean }[] {
  return species.varieties
    .filter((v) => v.is_default || tier !== 'species' || isRegionalVariety(v.pokemon.name))
    .map((v) => ({ name: v.pokemon.name, isDefault: v.is_default }));
}

/**
 * Which pokemon-forms the runner must fetch for a variety:
 * every sibling form when the pokemon has several (cosmetic expansion, tier ≥
 * forms), or just the first for a non-default variety (human label source).
 */
export function neededForms(pokemon: RawPokemon, tier: SeedTier): string[] {
  if (tier !== 'species' && pokemon.forms.length > 1) return pokemon.forms.map((f) => f.name);
  if (!pokemon.is_default && pokemon.forms.length > 0) return [pokemon.forms[0]!.name];
  return [];
}

export function englishName(names: { name: string; language: { name: string } }[], fallback: string): string {
  return names.find((n) => n.language.name === 'en')?.name ?? titleCase(fallback);
}

function titleCase(slugish: string): string {
  return slugish
    .split(/[-_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function generationNumber(species: RawSpecies): number {
  const match = species.generation.url.match(/\/generation\/(\d+)\/?$/);
  if (!match) throw new Error(`cannot parse generation from ${species.generation.url} (${species.name})`);
  return Number(match[1]);
}

function stripPrefix(name: string, prefix: string): string {
  return name.startsWith(`${prefix}-`) ? name.slice(prefix.length + 1) : name;
}

function toSlug(raw: string): string {
  return raw.replaceAll('-', '_');
}

/**
 * PokéAPI encodes visible gender differences of some species as varieties
 * (meowstic-male/-female, indeedee, basculegion, oinkologne, and compounds
 * like meowstic-female-mega). Extract the gender segment so those collapse
 * into our species × form × gender model instead of becoming fake "forms".
 */
export function splitGenderSegment(slugParts: string[]): { parts: string[]; gender: Gender | null } {
  const idx = slugParts.findIndex((p) => p === 'male' || p === 'female');
  if (idx === -1) return { parts: slugParts, gender: null };
  const gender = slugParts[idx] as Gender;
  return { parts: slugParts.filter((_, i) => i !== idx), gender };
}

function typesOf(pokemon: RawPokemon, form?: RawForm): string[] {
  const formTypes = form?.types;
  const source = formTypes && formTypes.length > 0 ? formTypes : pokemon.types;
  return [...source].sort((a, b) => a.slot - b.slot).map((t) => t.type.name.toLowerCase());
}

function sameTypes(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function fallbackSprite(dex: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
}

interface Slot {
  formSlug: string;
  formLabel: string | null;
  types: string[];
  isCosmetic: boolean;
  spriteDefault: string | null;
  spriteFemale: string | null;
  genderOverride: Gender | null;
}

/** Expand one species into entries for the given tier. Pure; unit-tested on real fixtures. */
export function expandSpecies(bundle: SpeciesBundle, tier: SeedTier): Entry[] {
  const { species, pokemons, forms } = bundle;
  const dex = species.id;
  const name = englishName(species.names, species.name);
  const generation = generationNumber(species);
  const speciesGenders = gendersFor(species.gender_rate, tier);

  // Does any non-default variety encode a gender? (meowstic-female etc.)
  const hasGenderVariety = species.varieties.some((v) => {
    if (v.is_default) return false;
    const parts = stripPrefix(v.pokemon.name, species.name).split('-');
    return parts.includes('male') || parts.includes('female');
  });

  const slots: Slot[] = [];
  for (const variety of includedVarieties(species, tier)) {
    const pokemon = pokemons.get(variety.name);
    if (!pokemon) throw new Error(`missing pokemon "${variety.name}" for species ${species.name}`);

    let formSlug: string;
    let genderOverride: Gender | null = null;
    if (variety.isDefault) {
      formSlug = 'default';
      // meowstic-male is "the default", but only force the gender when a
      // female counterpart variety exists — frillish-male/pyroar-male are
      // defaults without one and cover both genders via gender_rate.
      if (hasGenderVariety) {
        const parts = stripPrefix(pokemon.name, species.name).split('-');
        genderOverride = splitGenderSegment(parts).gender;
      }
    } else {
      const split = splitGenderSegment(stripPrefix(pokemon.name, species.name).split('-'));
      genderOverride = split.gender;
      formSlug = split.parts.length === 0 ? 'default' : toSlug(split.parts.join('-'));
    }

    const siblingForms = pokemon.forms
      .map((f) => forms.get(f.name))
      .filter((f): f is RawForm => f !== undefined)
      .filter((f) => !f.is_battle_only)
      .sort((a, b) => a.form_order - b.form_order || a.id - b.id);

    if (tier !== 'species' && pokemon.forms.length > 1 && siblingForms.length > 1) {
      // Visual sibling forms (Unown letters, Vivillon patterns, Furfrou trims,
      // Alcremie decorations, Arceus plates…): one slot per form, replacing the
      // variety-level slot. Cosmetic = the form doesn't even change the type.
      // Some species encode gender appearance as sibling forms instead
      // (frillish-male/-female) — those fold into the gender dimension.
      const baseTypes = typesOf(pokemon);
      for (const form of siblingForms) {
        // The base pokemon-form (empty form_name, e.g. `pichu`, `genesect`)
        // among a set of named siblings (`pichu-spiky-eared`, `genesect-douse`)
        // is the species' default slot — not a form of its own. Without this,
        // its name-derived slug (`pichu`) would leave the species with no
        // `default` entry and mark it cosmetic.
        const isBaseForm = form.form_name === '';
        const rawOwn = stripPrefix(stripPrefix(form.name, pokemon.name), species.name);
        const parts = (formSlug === 'default' ? [] : formSlug.split('_')).concat(rawOwn.split('-'));
        const split = splitGenderSegment(parts);
        const slotSlug = isBaseForm || split.parts.length === 0 ? 'default' : toSlug(split.parts.join('-'));
        const slotGender = split.gender ?? genderOverride;
        const formTypes = typesOf(pokemon, form);
        slots.push({
          formSlug: slotSlug,
          formLabel: slotSlug === 'default'
            ? null
            : englishName(form.names, form.form_name ? `${form.form_name} ${name}` : name),
          types: formTypes,
          isCosmetic: !isBaseForm && split.gender === null && sameTypes(formTypes, baseTypes),
          // The form sprite is the right one for both genders; a generic
          // front_female would show the wrong pattern/trim.
          spriteDefault: form.sprites?.front_default ?? pokemon.sprites.front_default,
          spriteFemale: form.sprites?.front_default ?? pokemon.sprites.front_female,
          genderOverride: slotGender,
        });
      }
      continue;
    }

    const labelForm = pokemon.forms.length > 0 ? forms.get(pokemon.forms[0]!.name) : undefined;
    slots.push({
      formSlug,
      formLabel: formSlug === 'default'
        ? null
        : (labelForm ? englishName(labelForm.names, `${titleCase(formSlug)} ${name}`) : `${titleCase(formSlug)} ${name}`),
      types: typesOf(pokemon),
      isCosmetic: false,
      spriteDefault: pokemon.sprites.front_default,
      spriteFemale: pokemon.sprites.front_female,
      genderOverride,
    });
  }

  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const genders = slot.genderOverride ? [slot.genderOverride] : speciesGenders;
    for (const gender of genders) {
      const entryKey = entryKeyOf(dex, slot.formSlug, gender);
      if (seen.has(entryKey)) throw new Error(`duplicate entry key ${entryKey} while expanding ${species.name}`);
      seen.add(entryKey);
      const sprite = gender === 'female'
        ? (slot.spriteFemale ?? slot.spriteDefault ?? fallbackSprite(dex))
        : (slot.spriteDefault ?? fallbackSprite(dex));
      entries.push({
        entryKey,
        dex,
        name,
        formSlug: slot.formSlug,
        formLabel: slot.formLabel,
        gender,
        types: slot.types,
        generation,
        spriteUrl: sprite,
        isCosmetic: slot.isCosmetic,
      });
    }
  }
  return entries;
}
