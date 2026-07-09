import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawForm, RawPokemon, RawSpecies } from '../src/seed/pokeapi.js';
import type { SpeciesBundle } from '../src/seed/expand.js';
import { includedVarieties, neededForms } from '../src/seed/expand.js';
import type { SeedTier } from '../src/types.js';

const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pokeapi', 'bundle.json');

interface FixtureBundle {
  species: Record<string, RawSpecies>;
  pokemon: Record<string, RawPokemon>;
  form: Record<string, RawForm>;
}

const fixtures: FixtureBundle = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

/** Build a SpeciesBundle from the trimmed real-PokéAPI fixture file, the same way the runner does. */
export function bundleFor(speciesName: string, tier: SeedTier): SpeciesBundle {
  const species = fixtures.species[speciesName];
  if (!species) throw new Error(`no fixture for species "${speciesName}"`);
  const pokemons = new Map<string, RawPokemon>();
  const forms = new Map<string, RawForm>();
  for (const v of includedVarieties(species, tier)) {
    const pokemon = fixtures.pokemon[v.name];
    if (!pokemon) throw new Error(`no fixture for pokemon "${v.name}"`);
    pokemons.set(v.name, pokemon);
    for (const formName of neededForms(pokemon, tier)) {
      const form = fixtures.form[formName];
      if (!form) throw new Error(`no fixture for form "${formName}"`);
      forms.set(formName, form);
    }
  }
  return { species, pokemons, forms };
}
