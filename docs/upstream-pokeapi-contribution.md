# Side-project: contribute modern-game encounter data upstream to PokéAPI

**Status:** idea, scoped — not started.
**Owner:** Gavin (PR from his GitHub account); implementation help from Claude sessions.
**Prereq reading:** [PokéAPI Gen 9 discussion #769](https://github.com/PokeAPI/pokeapi/discussions/769),
[community contribution design doc](https://gist.github.com/DJ-Meyers/23f89af0889e8950f5dd78935b99516e).

## Why

PokéAPI has **no encounter data** for BDSP, Legends: Arceus, Scarlet/Violet or
Legends: Z-A — no API does. This tracker works around it with the Serebii
location supplement (`src/supplement/`), which is presence-level only
("Bulbasaur: Indigo Disk, Coastal Biome") because that's all a living-dex
checklist needs.

Contributing real encounter data upstream:

- fixes it for everyone, not just this tracker;
- **retires our own workaround automatically** — the mirror syncs upstream
  CSVs daily, and the seed prefers mirror locations over the supplement by
  design, so the day upstream merges a game's encounters, that game's
  supplement data stops being used with zero code changes here;
- is explicitly wanted: the design doc above is the community's schema/process
  for exactly this, sourced (like our supplement) from Serebii/Bulbapedia.

## What upstream needs (vs what we have)

PokéAPI's encounter model is **slot-level**, spread across CSVs in
`data/v2/csv/` (all of which we already mirror into Postgres):

| file | contents | modern-game status |
|---|---|---|
| `locations.csv` | region + location identifier | Paldea/Lumiose/Hisui-era rows largely **missing** — must be minted |
| `location_areas.csv` | sub-areas of locations | missing for modern games |
| `encounters.csv` | (version, location_area, encounter_slot, pokemon, min/max level) | **zero rows** for BDSP/PLA/SV/ZA |
| `encounter_slots.csv` | (version_group, method, slot, rarity %) | missing for modern version groups |
| `encounter_condition_value_map.csv` | time/weather/season conditions | needed for SV weather-gated spawns |

Our supplement is species-centric and presence-level. Upstream needs
**area-centric, slot-level** data: per version, per area, which species, at
what levels, at what rarity, under which conditions. That granularity lives on
Serebii's **PokéArth area pages** (e.g. `/pokearth/paldea/southprovincearea1.shtml`)
and Bulbapedia area pages — not the per-species pages the supplement uses.

## Proposed phases

1. **Coordinate first (cheap, do before writing code).** Comment on
   discussion #769: which game slice is unclaimed, whether the design doc's
   schema decisions are current, how new location IDs should be allocated.
   Nothing kills a data PR faster than colliding with an in-flight effort.
2. **One game, base only: Scarlet/Violet without DLC.** ~120 areas.
   - Scraper: area-centric walk of Serebii PokéArth Paldea pages → normalized
     intermediate JSON (area, species, versions, levels, rarity, conditions).
   - Generator: intermediate JSON → PokéAPI CSV rows with deterministic new
     IDs (continuing each file's max ID), matching the design doc.
   - Validation: round-trip the generated CSVs through **this repo's mirror
     loader + obtainability seed** as a smoke test — if our own planner can
     consume them, the shape is right. Also run PokéAPI's own CI/validators.
3. **Upstream PR** for SV base. Expect review iterations; keep the scraper +
   generator in a public repo so maintainers can re-run it.
4. **Repeat** for SV DLC, then PLA, then BDSP, then Z-A (each smaller than the
   first — the tooling exists by then).

## Risks / honesty

- **Slot rarity data is uneven.** Serebii/Bulbapedia don't always publish
  exact spawn percentages for open-world games; the design doc's stance on
  approximations must be followed rather than guessed. Presence + levels may
  be acceptable where rates are unknown — ask in #769.
- **Provenance.** Facts (what spawns where) aren't copyrightable, and the
  community doc already names Serebii/Bulbapedia as sources — but follow
  whatever attribution convention the maintainers ask for.
- **Review latency.** PokéAPI has no full-time data team; PRs can sit. That's
  fine — the tracker's supplement keeps us unblocked meanwhile.
- **Upstream schema drift.** If the maintainers land their own Gen 9 effort
  first: celebrate, delete this file, done.

## Definition of done (per game)

- Upstream PR merged; `encounters.csv` has rows for that game's versions.
- Our mirror sync picks them up; seed run shows mirror-derived locations for
  that game (supplement no longer consulted for it — verify via the
  `locsByKey`-wins path in `src/obtainability/from-mirror.ts`).
- Supplement scope note updated in the README.

## Starting checklist when picking this up

- [ ] Read #769 end-to-end + the design doc; note current claims/owners.
- [ ] Post intent in #769 (SV base game slice).
- [ ] Spike: scrape ONE PokéArth area page, hand-map it to CSV rows, sanity
      check against the in-game reality you know.
- [ ] Decide repo home for the tooling (suggest: separate public repo,
      `pokeapi-gen9-encounters`).
