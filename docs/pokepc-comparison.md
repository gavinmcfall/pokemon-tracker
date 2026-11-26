# Tracker vs pokepc/dataset: obtainability comparison

*Findings, 2026-11-26. For deciding whether pokepc/dataset should become the
tracker's main source of "which form can be obtained in which game".*

## Bottom line

pokepc/dataset disagrees with the live tracker in 3,814 form-and-game pairs.
Most spot-checked disagreements came out in pokepc's favour, or were a
difference in how the two models define "obtainable". Of the cases checked
against sources, only the Paldean Tauros breeds needed a correction on top.
Most of the gap is things we miss (3,575). Most of what we wrongly claim comes
from counting "in the game's regional Pokédex" as "obtainable" (145 pairs,
plus 23 that pokepc marks event-only).

pokepc does not have locations ("Route 228"). It says *which* forms are
obtainable in *which* cartridge, plus whether that is event-only, transfer-only
or needs a link trade. Our location strings would still come from PokéAPI's
encounter data and our hand-checked notes.

## What was compared

- **pokepc/dataset** at commit `f2cd072` (2026-11-19), MIT licence. Its
  1,595 per-form records give per-cartridge lists: `obtainableIn`,
  `eventOnlyIn`, `transferOnlyIn`, `linkRequiredIn`, `shinyLockedIn`.
- **The live tracker database**, read-only, on the 2026-11-23 seed of
  `4264727`: 1,569 forms after merging genders.
- 1,309 forms matched on both sides. They were matched by dex number plus
  PokéAPI form slug, using the `refs.pkApiFormSlug` that pokepc carries.
- **Not compared:**
  - pokepc's battle-only and female-only records. Our female slots are the
    same form.
  - Forms only one side has:
    - 260 only in the tracker: 92 megas, 30 Gigantamax, 12 totem species,
      plus slug mismatches such as Burmy cloaks and Unown A.
    - 21 only in pokepc: its "default" for species we split by form.
  - Winds/Waves.
- **Version exclusives:** a pokepc cartridge listed in `linkRequiredIn` (only
  by trade from the other version) was not counted as native. That matches
  the tracker's model.

Every pair is in [pokepc-comparison.csv](pokepc-comparison.csv). The check
now lives in `scripts/compare-pokepc.ts` (see [Outcome](#outcome)).

## Counts per game

| Game | pokepc has it, we don't | We have it, pokepc doesn't | We have it, pokepc says event-only | Version split differs |
|---|---|---|---|---|
| Red/Blue | 0 | 0 | 0 | 0 |
| Yellow | 0 | 13 | 0 | 0 |
| Gold/Silver | 0 | 19 | 0 | 6 |
| Crystal | 0 | 29 | 0 | 0 |
| Ruby/Sapphire | 0 | 0 | 0 | 2 |
| Emerald | 33 | 7 | 0 | 0 |
| FireRed/LeafGreen | 92 | 0 | 0 | 0 |
| Diamond/Pearl | 286 | 3 | 0 | 4 |
| Platinum | 227 | 11 | 0 | 0 |
| HeartGold/SoulSilver | 174 | 0 | 0 | 4 |
| Black/White | 320 | 5 | 2 | 0 |
| Black 2/White 2 | 185 | 7 | 0 | 0 |
| X/Y | 135 | 9 | 0 | 5 |
| Omega Ruby/Alpha Sapphire | 292 | 0 | 0 | 12 |
| Sun/Moon | 84 | 3 | 0 | 10 |
| Ultra Sun/Ultra Moon | 180 | 6 | 0 | 8 |
| Let's Go | 0 | 1 | 0 | 0 |
| Sword/Shield | 71 | 2 | 0 | 8 |
| BDSP | 357 | 2 | 0 | 4 |
| Legends: Arceus | 2 | 5 | 0 | 0 |
| Scarlet/Violet | 28 | 21 | 2 | 8 |
| Legends: Z-A | 0 | 2 | 19 | 0 |
| Pokémon GO | 1,109 | 0 | 0 | 0 |
| **Total** | **3,575** | **145** | **23** | **71** |

## What the disagreements are

### pokepc has it, we don't (3,575)

The tracker only knows what a game's *regional* Pokédex lists, plus PokéAPI's
encounter tables. That misses post-game National Dex areas and most special
ways to get a Pokémon. Samples that match known ways to get them (checked by
sense, not sourced one by one):
- **Diamond/Pearl:** Trapinch (Route 228, post-game), Glaceon (evolve Eevee at
  the Ice Rock).
- **FireRed/LeafGreen:** Raikou and Entei (roaming), Unown (Tanoby Ruins).
- **Emerald:** Johto Pokémon in the Safari Zone extension.
- **Omega Ruby/Alpha Sapphire:** Cyndaquil (Johto starter gift).
- **Sword/Shield:** Raikou, Entei, Xerneas and Stakataka (Dynamax Adventures).
- **BDSP:** Grimer and Clamperl (Grand Underground).
- **Scarlet/Violet:** Lugia, Rayquaza, Solgaleo and Necrozma (Snacksworth
  legendaries), and Urshifu Rapid Strike.
- **Legends: Arceus:** Alolan Vulpix and Ninetales. Fixed in PR #39.

**Pokémon GO (1,109)** is a modelling choice, not an error. The tracker only
lists GO for a handful of curated mythicals. Showing GO for everything would
make nearly every Pokémon "available in GO", which may be more noise than
help.

### We have it, pokepc doesn't (145)

Mostly regional-Pokédex membership that isn't actually catchable, plus form
mix-ups in our data. pokepc looks right on these:
- **Gold/Silver and Crystal:** Kanto starters, Articuno and Mewtwo. They are
  in the Johto Pokédex, but no game gives them.
- **Yellow:** Weedle, Ekans and Meowth, which Yellow removed.
- **Black 2/White 2:** Tornadus, Thundurus and Landorus (only via Dream Radar
  transfer).
- **X/Y:** Volcanion, Diancie and Hoopa (event-only). These also belong in our
  event-only list.
- **Sun/Moon and Ultra Sun/Ultra Moon:** Kantonian Rattata, Raticate,
  Dugtrio, Graveler and Golem shown as obtainable. Only their Alolan forms
  live in Alola.
- **Platinum:** Origin Dialga and Palkia. Those forms didn't exist until
  Legends: Arceus.
- **Legends: Arceus:** Darkrai and Shaymin (save-data bonuses only), Bloodmoon
  Ursaluna (a Scarlet/Violet form), and Red/Blue-Striped Basculin (Hisui only
  has White-Striped).
- **Several games:** Eternal Floette, which was never released.
- **Scarlet/Violet:** roaming Gimmighoul, which only comes from GO.

These looked like **pokepc errors**, but checking proved pokepc right (see
[Outcome](#outcome)):
- **Platinum:** Spiritomb, Murkrow, Misdreavus, Glameow and Stunky.
- **Emerald:** Surskit, Meditite and Roselia.

Undecided, see [Open questions](#open-questions): Vivillon patterns and
Ursaluna in Scarlet/Violet, and Dusk Lycanroc in Sun/Moon and Ultra Sun/Ultra
Moon.

### We have it, pokepc says event-only (23)

- **Scarlet/Violet:** Walking Wake and Iron Leaves, which were limited-time
  raids.
- **Legends: Z-A:** 19 Vivillon patterns, event-only there.
- **Black/White:** Zorua and Zoroark. Both needed an event Celebi or Entei.

### Version split differs (71)

Several of these are real version exclusives we've missed:
- **Scarlet/Violet:** Koraidon is Scarlet-only, Miraidon Violet-only;
  Armarouge is Scarlet-only, Ceruledge Violet-only.
- **Omega Ruby/Alpha Sapphire:** Zangoose and Seviper, Lunatone and Solrock.

The rest go the other way: our encounter data shows only one version and
pokepc both. Examples are Caterpie and Weedle in Gold/Silver (both appear in
the Bug-Catching Contest in either version) and Paldean Tauros Blaze/Aqua.
These need checking pair by pair.

## Caveats

- pokepc is curated community data (the successor to supereffective.gg's
  living-dex dataset), not datamined. It agreed with every case we had a
  cited answer for. The one error found is that it lists the Paldean Tauros
  breeds in both Scarlet and Violet.
- The comparison works at form level. Gender-only differences are not
  compared.
- Slug mismatches (Burmy cloaks, Unown A versus "default") left a few forms
  uncompared. An adoption would need a small mapping table.

## Open questions

1. Should GO availability be shown for every Pokémon pokepc lists, or stay
   curated?
2. Vivillon patterns in Scarlet/Violet and Z-A: pokepc says not obtainable or
   event-only, and we say available. Ursaluna in Scarlet/Violet and Dusk
   Lycanroc in Sun/Moon and Ultra Sun/Ultra Moon also need confirming.
3. The "one version only" cases where pokepc says both versions need a per-pair
   check before trusting either side.

## Outcome

*2026-11-26.* Adopted as the base layer: see "pokepc/dataset base layer" in the
README.

Gavin's answers:
1. Show GO where pokepc lists it as obtainable. Its audit counts only wild
   spawns, permanent research and recurring raids.
2. The open cases were checked against Serebii and PokémonDB. pokepc was right
   on all of them except the Paldean Tauros breeds:
   - Vivillon: Z-A has Meadow, Marine (the museum Spewpa) and Garden; SV has
     Fancy.
   - SV has no regular Ursaluna.
   - Dusk Lycanroc was a USUM event.
   - Platinum Spiritomb needs other players in the Underground.
   - Platinum Murkrow, Misdreavus, Glameow and Stunky are trade-only.
   - Emerald Surskit comes from record-mixing swarms.
   - Scarlet Gulpin comes from Jacq's League Club trade.
   - Gold/Silver Caterpie and Weedle appear in the Bug-Catching Contest in both
     versions.
   - The Tauros breeds are version exclusives, so they get a correction in
     `POKEPC_CORRECTIONS`. Serebii says each is exclusive; pokepc lists both
     versions.

After the switch, `scripts/compare-pokepc.ts` shows what the next seed would
write. It differs from pokepc in 2 pairs, Original and World Cap Pikachu in GO,
because cap Pikachu stay event-only on purpose. Before the switch there were
3,854 pairs.
