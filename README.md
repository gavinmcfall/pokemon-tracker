# pokemon-tracker

A personal **National Living Dex tracker**: Postgres is the source of truth, the
full catalogue of collectible slots (species × form × gender) is seeded
server-side from PokéAPI, and the browser only ever talks to the app's own API.

```
                 ┌─────────────────────────┐
  PokéAPI ──▶    │  seed Job / CronJob      │──▶ upsert entries
 (server-only)   └─────────────────────────┘        │
                                                    ▼
  browser ──▶ web (nginx, static SPA) ──▶ api (Hono) ──▶ Postgres (CNPG)
                                   ▲
                  CSV upload ──────┘  (sheet import — no Google OAuth)
```

| Piece | What | Where |
|---|---|---|
| `src/app.ts` + `src/server.ts` | Hono API (Node 22, TypeScript) | `ghcr.io/gavinmcfall/livingdex-api` |
| `src/seed/` | Idempotent PokéAPI seed (same image, `node dist/seed/run.js`) | same image |
| `web/` | Static SPA (implements the Claude Design deliverable) + nginx `/api` proxy | `ghcr.io/gavinmcfall/livingdex-web` |
| `migrations/` | Postgres schema, applied automatically on api/seed boot | — |
| `deploy/` | Flux-ready manifests for the home-ops cluster (CNPG, bjw-s app-template, HTTPRoute) | see `deploy/README.md` |

## Data contract

One **entry** = one collectible slot, keyed `entryKey = {dex4}-{formSlug}-{gender}`
(e.g. `0006-mega_x-male`). Fields per entry: `dex`, `name`, `formSlug`
(`"default"` for the base form), `formLabel`, `gender`
(`male|female|genderless`), `types` (lowercase, primary first), `generation`,
`spriteUrl`, `isCosmetic`. The owner's catch state lives in a separate `status`
row per entry: `caught`, `caughtAt`, `gameOrigin` (e.g. `emu:HeartGold`),
`method`, `notes`.

A third, optional **`specimen`** row per entry holds HOME-derived facts about the
best individual filling a caught slot — `shiny`, `event`, `level`, `originGame`,
`metYear`, `ivPerfect`, `ivs`, `tera`, `ball`, `nature`, `ability`, `ribbons[]`,
`nickname`, `ot`. It's machine-generated from a Pokémon HOME export (regenerated
each sync via `POST /api/specimens`, a full replace) and kept distinct from
`status` so the two never clobber each other. `GET /api/entries` embeds
`status`, `specimen` and `obtainability` (each null when absent). The front-end
surfaces the specimen as shiny/event/6IV badges on caught tiles and a **Best
Specimen** zone in the detail sheet (origin, IVs, Tera, ribbons, ball/nature,
nickname/OT).

A fourth, catalogue-derived **`obtainability`** object per entry says where/how a
slot is legitimately obtainable — `availability[]` (`{gameId, label, platform,
method, shinyPossible}`), plus `gmaxCapable`, `teraAvailable`,
`catchableOnSwitch`, `shinyLegalSomewhere`, `unobtainableLegit`,
`genderVisualDiff`, `shinyLockedIn[]`, `originGames[]`. It's computed by the seed
(not owner data) and powers the front-end's Obtainability filters + detail zone.

### API

All JSON unless noted. `web` proxies `/api` to the api service (one origin, no CORS).

```
GET  /api/entries?gen=&type=&status=caught|uncaught&q=
       -> Entry[]  (each with an embedded `status` object, null if untouched)
GET  /api/summary?gen=      -> { caught, total, pct, byType: [{type, caught, total}] }
POST /api/status            { entryKey, caught, gameOrigin?, method?, notes? } -> Status
       (metadata fields are patch-style: omitted = keep, null/"" = clear;
        caughtAt is server-managed — set on catch, kept on re-affirm, cleared on uncatch)
POST /api/import[?dryRun=1] multipart field `file` (or raw text/csv body)
       -> { matched, updated, unmatched: [{line, reason, raw}] }
       (dryRun=1: resolve + report only, no writes; adds
        { changed, changes:[{entryKey, caught:{from,to}, metaChanged}] })
GET  /api/export            -> text/csv (round-trips through import)
POST /api/specimens         JSON array (or { specimens:[...] }) of HOME-derived
       records -> { synced, unmatched }  (full-sync: replaces the whole set)
GET  /api/games             -> GameWithOwnership[]  (individual releases — Red
       and Blue are separate cartridges — each with { versionGroup,
       applicableMethods, owned, methods, notes })
POST /api/ownership         { gameId, methods:[…], notes? } -> GameOwnership
       (gameId is a release slug e.g. "red"; multi-method; empty + no notes clears.
        methods must be applicable to the game's platform: cartridge|emulator|
        romhack for consoles, digital for mobile/GO)
GET  /api/transfer          -> { [gameId]: TransferInfo }  (how each game group's
       catches reach Pokémon HOME: native | go | bank | chain | none | unknown)
GET  /api/plan?scope=&gender= -> { species:[{entryKey, verdict, via?, route?, needs?}],
       summary, acquisitions, scope, gender, phase? }  (living-dex planner: per-
       species verdict — have|ready|need-game|unknown|event-only — given owned
       games + Bank. gender = all | distinct: `distinct` collapses ♂/♀ pairs
       except the ~101 visually gender-dimorphic species)
GET  /api/acquire?mode=&rank=&scope= -> { steps:[{id,label,platform,generation,owned,
       via,catchCount,entryKeys,prereq}], missingTotal, coverable, leftover, scope,
       phase? }  (the completion itinerary: the ordered games to play — owned AND
       to-acquire — each with the species to catch there. mode = cartridge-only |
       emulator-only | emu-first | cartridge-first; rank = fewest-games |
       fewest-consoles | oldest-gen; scope = species | species-regional | all |
       phased — what "finishing the dex" means, see Goal scopes below)
GET  /api/transfer          -> { [gameId]: TransferInfo }  (how each game's
       catches reach Pokémon HOME: reach native|go|bank|chain|none|unknown,
       requiresBank, requiresGames (AND-of-ORs), human route string)
GET  /api/sprites/status    -> { enabled, running, total, mirrored, fetched, failed, … }
POST /api/sprites/mirror    -> 202; downloads all sprites to SPRITE_DIR in the background
GET  /api/sprites/:key      -> image/png from the local mirror (404 if not mirrored)
GET  /healthz  /readyz      -> k8s probes
```

CSV import matches rows by `entryKey` when present, otherwise by `dex`
(+ optional `form`, `gender` columns — a flat one-row-per-species sheet marks
every matching slot). Unmatched rows are reported, never fatal. Header aliases
like `National Dex`, `Owned`, `Game` are recognized.

## Front-end (`web/public/`)

An implementation of the Claude Design deliverable *Living Dex Tracker*
(project `2258ee1c`). The DC-framework design prototype is reproduced as a
dependency-free static SPA (no build step) wired to the API instead of its
mock data + localStorage:

- **Generation-scoped view** — the header count, progress mosaic and Needed/Caught
  chips reflect the selected generation (the region shown beside the wordmark).
- **VIEW consolidation** (dex only, independent of the planner's goal scope) —
  **Every slot** (default) shows all forms × genders; **One per species** /
  **+ Regional forms** collapse each group to a single tile, represented by a
  caught slot when any slot of the group is caught (so the species reads as
  done regardless of which gender/form you banked). Display-only: it never
  changes what's stored, and the planner's GOAL is chosen separately.
- **GENDERS preference** (one setting, shared by the dex grid and the planner
  goal — chips in both places) — **All** keeps a ♂ and ♀ slot for every
  dual-gender species (807 of 1,025); **Distinct only** collapses each ♂/♀
  pair to one slot unless the species is visually gender-dimorphic
  (`has_gender_differences` from the games' own data — ~101 species like
  Pikachu, Hippowdon). Data-driven, not a guess: the identical-looking pairs
  it drops have no female sprite because the games render them identically.
- **Progress mosaic** — one bar segment per primary type that has returned to the
  dex, coloured by type.
- **Filters** — generation chips, All/Needed/Caught, a multi-select type row, and
  name/`#dex` search; all client-side over the full catalogue for instant response.
- **Type-tinted tiles** — caught entries fill with their primary type's colour and
  carry a secondary-type accent; needed entries are greyscale. Catch state is
  **server-backed** (`POST /api/status`) with an optimistic update, not localStorage.
- **Theming** — light/dark via CSS `light-dark()`; a header button cycles
  auto → light → dark (persisted). Reduced-motion, keyboard operation, 44px touch
  targets and focus rings are carried over from the design.
- CSV **Import/Export** buttons wire the §6 sheet round-trip into the header.
- **Mirror** button (shown only when `SPRITE_DIR` is set) — triggers the sprite
  mirror and polls progress; once complete the grid switches to local sprites.
- **Per-entry detail sheet** (v2) — a `⋯` on each tile (or long-press) opens a
  sheet with a **My Catch** editor (caught toggle + Game / Method / Notes,
  combo-suggested, saving to `POST /api/status`) and an **Obtainability** zone.
- **Obtainability** filters + zone are driven by the catalogue-derived
  `obtainability` object (`availability[]`, `gmaxCapable`, `teraAvailable`,
  `shinyLockedIn`, …) the seed now computes (see **Obtainability** below); they
  light up automatically wherever the API provides it.
- **My Games** button — a modal (grouped by platform) to record which games you
  own and how: cartridge, emulator and/or romhack per game (mobile titles like
  Pokémon GO show a single **Playing** toggle instead), with an optional note
  (`GET /api/games` + `POST /api/ownership`). Games are **individual
  releases** — Red and Blue are separate cartridges, not a collated "Red/Blue".
  Obtainability availability stays at version-group granularity (a species in
  Red is in Blue too), so owning either release lights up that group's
  availability chips as `✓ OWNED` and feeds the **In a game I own** filter. Like the other obtainability filters,
  it hides only *known* non-matches — a slot with no availability data stays
  visible (unknown, never a guess). Also tracks the **bridge services** (Pokémon
  Bank, HOME Premium) the planner needs, under a "Services" group.
- **Planner** view (header toggle) — the living-dex planner (`src/planner/`). Its
  primary output is a **completion itinerary**: the minimal ordered set of games
  to play — the ones you **own** and the ones to **acquire** — each with the exact
  species to catch there, covering everything you're missing (`GET /api/acquire`).
  Tap a stop to see its species. A greedy set-cover assigns each species to its
  simplest-tier game (direct-to-HOME over Bank over transfer-chain), so the list
  is dominated by modern one-stop games; any Bank / chain-intermediate a stop
  needs is a `prereq` step. Three levers:
    - **Goal scopes** (`src/planner/scope.ts`) — what "finishing the dex" means.
      The seed stores every slot (forms × genders); the goal picks which count:
      **Species** (one per species — the classic National Living Dex), **+
      Regional** (adds Alolan/Galarian/Hisuian/Paldean forms), **Everything**
      (all slots), or **Phased** (the default: the goal is everything, worked
      species-first → regional forms → every remaining slot; the planner and the
      dex grid target the first incomplete phase and show `PHASE n/3` progress).
      A species/form group counts as caught when ANY of its slots is caught — the
      planner never asks you to re-catch a species because you ticked the other
      gender. The goal scope drives the **plan only**; how the dex grid displays
      is the separate VIEW control below.
    - **Acquire** — how you get games: cartridge-only / emulator-only / emu-first
      / cartridge-first. `-only` modes ignore your copies held in the other form;
      `-first` modes keep everything you own and label new buys by preference.
    - **Order** — fewest games / fewest consoles / oldest-gen-first.
  If the itinerary needs Pokémon Bank you don't have, the planner shows a
  reality-check warning: Bank can no longer be newly downloaded (the 3DS eShop
  closed in March 2023), so pre-Switch routes assume it's already installed.
- **Companion checklist** — tapping a stop shows the species assigned there
  *plus* an "ALSO CATCHABLE HERE" section (everything else you still need
  that's available in that game — planned for other stops, but grab it while
  you're playing). Each row shows **how/where**: `wild — Route 119 (super rod)`
  from the mirror's encounter data (Gen 1→SwSh; newer games have no encounter
  tables upstream, so their dex members read as "catchable here"), or
  `evolve from <prevo>` with a **TRADE EVO** flag when every evolution path
  needs a trade. A **quick-tick** button on each row marks the catch without
  opening the sheet, recording the stop's game as `gameOrigin` (unless one was
  already set) and flagging it **in transit** (`inHome: false`).
- **Transfer backlog** — a catch is either banked in HOME (`status.inHome`,
  default true so HOME imports stay truthful) or sitting in its origin game.
  Quick-ticked session catches are in transit; the planner shows a
  **TRANSFER BACKLOG** grouped by game with the HOME route reminder and a bulk
  **Mark transferred** per game; the detail sheet has an `In HOME / not in
  HOME` toggle. Releasing a catch resets the flag. Round-trips through CSV
  export/import (`inHome` column).
  A demand-based greedy set-cover reaches full coverage (handling the Gen-3→4→5→
  Bank chains a naïve greedy would stall on). Below the plan: per-species verdicts
  (**Have / Ready / Need-a-game / Unknown / Event-only**, `GET /api/plan`) with a
  filterable list, and an ownership-aware "YOUR PLAN" line in the detail sheet.
  A game owned *only* via romhack is **not** a HOME-legal route; Bank status gates
  the pre-Switch routes.
- **To Pokémon HOME** route line (detail sheet) — the simplest legit route into
  Pokémon HOME across the games a species is available in (`GET /api/transfer`,
  data in `src/obtainability/transfer.ts`): HOME-native (Switch line + GO), via
  Pokémon Bank, or via the Gen 3→4→5 transfer chain. Curated + research-verified
  against official HOME / Bulbapedia sources; anything uncertain is `unknown`,
  never guessed. Ownership-agnostic for now — the living-dex planner will turn it
  into "with the games you own" and flag the intermediate games each chain needs.

Replacing it is a drop-in: overwrite `web/public/` and keep speaking the API above.
Notes: the Google font loads from the internet (system-ui fallback keeps it usable
offline); sprites are remote by default but can be mirrored locally for a fully
offline LAN app (see **Sprite mirror** below). Catch metadata (`gameOrigin`/`method`/`notes`) is stored and
CSV-importable but the design surfaces only the binary catch toggle; a metadata
editor is a future addition.

## Sprite mirror (offline sprites)

Sprites default to canonical PokéAPI GitHub URLs. To make the app fully offline
on the LAN, set **`SPRITE_DIR`** on the api to a writable (persistent) path and
click **Mirror** in the UI (or `POST /api/sprites/mirror`). The api streams every
referenced sprite into `SPRITE_DIR` (bounded concurrency, retry/backoff), then
`GET /api/entries` rewrites each `spriteUrl` to `/api/sprites/<file>` for any
sprite present on disk — served by the api (proxied through nginx like the rest
of `/api`). Nothing is bundled in the image, so it stays small and the mirror is
a one-click, on-demand step after deploy.

Idempotent and resumable: re-running only fetches what's missing, and the DB is
never mutated (canonical remote URLs stay in `entries.sprite_url`; rewriting is
per-response), so a re-seed can't undo a mirror. When `SPRITE_DIR` is unset the
feature is disabled end to end (the button hides; the routes report `enabled:false`).

## Seed

`SEED_TIER` decides what counts as an entry:

- `species` — base form of every species + regional variants (Alolan/Galarian/Hisuian/Paldean).
- `forms` — + all battle/visual varieties (megas, gmax, Rotom, Deoxys…) and
  visual sibling forms (Unown letters, Vivillon patterns, Furfrou trims,
  Alcremie decorations…).
- `full` (default) — + gender expansion: dual-gender species get a male and a
  female slot each.

Policy encoded in `src/seed/expand.ts` (all unit-tested against real PokéAPI data):

- Default variety → `formSlug: "default"` even when PokéAPI names it
  `deoxys-normal` / `zygarde-50`.
- Gender-as-variety species (Meowstic, Indeedee, Basculegion, Oinkologne) and
  gender-as-form species (Frillish, Pyroar) collapse into the gender dimension
  instead of becoming fake forms.
- Curated **fixed-gender event forms** (`FIXED_GENDER_FORMS` in
  `src/obtainability/curated.ts`) override the species gender ratio: all 8 cap
  Pikachu are ♂-only, Cosplay Pikachu and its costumes ♀-only, Ash-Greninja
  ♂-only (Bulbapedia-verified) — the ratio alone would fabricate slots no game
  can produce. Only documented locks are asserted; uncertain event genders
  (e.g. Fancy Vivillon) stay unlocked.
- **`SEED_PRUNE=1`** deletes DB entries the catalogue no longer produces (after
  a curated correction like the above, a tier change, or an upstream removal) —
  their status/specimen/obtainability rows cascade away. Off by default since
  pruning discards any catch status on those slots; the seed logs the stale
  keys either way.
- `is_cosmetic` = a sibling form that doesn't even change typing (Vivillon
  patterns yes; Arceus plates no). The effectively-unobtainable Poké Ball
  Vivillon is listed and flagged, per the "every variant" goal.
- Battle-only sibling forms (Cherrim-Sunshine, Mimikyu-Busted, Castform
  weather) are transient states, not slots — excluded. Battle-only *varieties*
  (megas, gmax) are kept: they're explicitly wanted.
- Totem/costume/build varieties are included (inclusive by default — see open
  decisions).

Operationally: ≤8 concurrent requests, retry/backoff honoring `Retry-After`,
and every response cached on disk (`SEED_CACHE_DIR`, a PVC in-cluster), so
re-runs are cheap, offline-repeatable, and a weekly refresh picks up new
species/forms automatically (current data: 1025 species → **2675 entries** at
`full`). The seed never deletes: rows that disappear upstream are logged as
stale for review. Re-seeding never touches `status` — owner data survives
refreshes, and a run against unchanged data is a zero-diff no-op.

## Obtainability

The seed derives a per-slot **obtainability** record (`src/obtainability/`,
stored in the `obtainability` table, embedded in `GET /api/entries`) — **sourced
from the local PokéAPI mirror** (see below), not live HTTP:

- **Availability from pokédex membership** (`src/obtainability/from-mirror.ts`):
  which games a species appears in (its game-specific regional Pokédex entries,
  `pokemon_dex_numbers → pokedexes → version_groups`), mapped to our gameIds. A
  wild-encounter check tags the method (`wild` vs `available`). Because a game's
  Pokédex already lists legendaries, gift mons and evolved forms, this covers
  **~99.7% of species** with accurate per-game availability and needs **no**
  wild/evolution curation. `gmaxCapable`, `genderVisualDiff`,
  `catchableOnSwitch`, `teraAvailable`, `originGames` come from the same tables.
- **Curated overlay** (`src/obtainability/curated.ts`) now only for what the
  data can't say: per-game **shiny locks** (gen 6–9 starters + box legendaries),
  shiny-locked-everywhere species, a small static/gift supplement, and the
  **mythical truth table** — dex membership lists mythicals in games where they
  were event-only (Jirachi is in the Hoenn dex but was never catchable in gen 3),
  so `AVAILABILITY_EXCLUSIONS` drops those listings, `STATIC_AVAILABILITY` adds
  the real still-working routes (GO Special Research for Mew/Celebi/Jirachi, the
  GO Mystery Box for Meltan/Melmetal, Keldeo's Crown Tundra quest), and
  `UNOBTAINABLE_LEGIT` marks the truly event-only ones (Victini, Meloetta,
  Genesect, Magearna, Marshadow, Zeraora, Zarude, Pecharunt) so they render as
  **Event-only**, not as a catch stop. Defaults stay conservative — shiny is
  legal unless a curated entry says otherwise, so a gap under-claims rather than
  misleads.

Version-group→game rollup lives in `src/obtainability/games.ts`
(`VERSION_GROUP_TO_GAME`; DLC folds into its base game — including Legends: Z-A's
`legends-za` + `mega-dimension` (Mega Dimension DLC) → `za`; GameCube/JP/
unreleased groups are unmapped → "unknown"). Known limits (documented, not
fabricated): obtainability is species-level (pokédex membership can't split
Alolan vs Kantonian Raichu — regional-form exclusivity is future work).

The seed sources obtainability best-effort: if the mirror schema isn't populated
yet it writes the catalogue and skips obtainability (leaving prior values), so
run the `pokeapi-mirror` job before the seed.

## PokéAPI mirror (`src/mirror/`)

A self-syncing local mirror of PokéAPI's source data — the foundation for
richer, offline, join-based enrichment (obtainability v2, game-ownership
planning, …). `node dist/mirror/run.js`:

1. Finds the latest commit that touched `PokeAPI/pokeapi`'s `data/v2/csv` path.
2. If it matches what we last loaded (`<schema>.mirror_meta.synced_sha`) it's a
   **no-op** — so a daily CronJob only does work when upstream actually changes
   (a game/DLC release, a few times a year). Import *and* monitor in one job.
3. Otherwise it loads **every** CSV into the `pokeapi` schema — one text-column
   table per file (`pokemon_species`, `pokemon_dex_numbers`, `pokedexes`,
   `version_groups`, `encounters`, …) via `COPY`, in a single transaction
   (readers see the old tables until commit), and records the new SHA.

Mirroring the *whole* dataset (not a curated subset) is deliberate: loading a
CSV is uniform, so any future feature already has its data locally as SQL
instead of a new HTTP integration. The mirror is a faithful passthrough (all
columns `text`, empty cells → `NULL`); consumers cast/join as needed.

Config (env): `DATABASE_URL` (required), `MIRROR_SCHEMA` (default `pokeapi`),
`POKEAPI_REPO` (`PokeAPI/pokeapi`), `POKEAPI_CSV_PATH` (`data/v2/csv`),
`GITHUB_TOKEN` (optional — raises the API rate limit; unauthenticated is fine
for a daily job's two API calls), `MIRROR_FORCE=1` (reload even if unchanged).

Why it matters: pokédex membership (`pokemon_dex_numbers` → `pokedexes` →
`version_groups`) says which *games* a species is in — including legendaries and
gift/evolution mons that have no wild-encounter table — so obtainability can be
sourced accurately by SQL join rather than curation.

## Run locally

```bash
npm ci
docker compose up --build          # postgres + api + web on http://localhost:8090
docker compose run --rm seed       # one-shot full catalogue seed

# or without docker (needs a Postgres):
DATABASE_URL=postgres://… npm run seed
DATABASE_URL=postgres://… npm run preview   # UI + API on :8321
```

## Testing (QA lanes)

```bash
npm run typecheck
npm test                 # unit + API + store contract (in-memory)
TEST_DATABASE_URL=postgres://…/disposable_db npm test   # + the same contract on real Postgres
npm run test:e2e         # Playwright: desktop lane + "serina" lane (Pixel 7,
                         # reduced motion, keyboard-only assertions) — both gate CI
```

- `test/store-contract.ts` runs identically against MemoryStore and PgStore so
  the test fake can't drift from production.
- `test/fixtures/pokeapi/bundle.json` is trimmed **real** PokéAPI data for the
  nasty cases (Nidoran, Unown, Vivillon, Alcremie, Meowstic, Frillish, Arceus,
  Minior, Mimikyu…).
- Seed idempotency, uniqueness and gender/form edge cases per spec §8 are
  covered in `test/expand.test.ts`; CSV round-trip in `test/csv.test.ts`.
- `e2e/smoke.spec.ts` drives the real front-end against the API (gen scoping,
  catch toggle + persistence across reload, filters, empty state, dex search,
  keyboard-only toggling, theme cycle, no mobile overflow). The "serina" lane
  already caught two real bugs — disabled-button focus loss breaking keyboard
  toggling, and `[hidden]` losing to a `display:flex` rule. Port the full
  SCBridge multi-persona pack to broaden this lane.

CI (GitHub Actions) runs typecheck, the full test suite against a Postgres 16
service, both e2e lanes, then builds and (on `main`) pushes both images to GHCR
tagged `latest` + commit sha.

## Deploy

See [`deploy/README.md`](deploy/README.md) — copy `deploy/` into the home-ops
repo, adjust the marked placeholders (storage class, app-template chartRef,
Gateway parentRef, image tags), reconcile, then apply the one-shot seed Job.

## Open decisions (defaults chosen, flag to change)

1. **API stack**: Hono on Node (built) rather than PostgREST — one small owned,
   testable surface for read/write/seed/import instead of splitting the glue
   across DB roles and extra jobs.
2. **Sprites**: canonical PokéAPI GitHub URLs (v1 default). Mirroring into
   R2/MinIO for a fully offline LAN app is a contained follow-up (rewrite
   `sprite_url` at seed time).
3. **Single owner**: yes for v1. The extension point (composite
   `(owner_id, entry_key)` PK) is marked in `migrations/0001_init.sql`; nothing
   multi-user is built.
4. **Exposure**: manifests default to the internal (LAN) Gateway; switching to
   the Cloudflare-Tunnel gateway is a one-line `parentRefs` change.
5. **Seed tier**: `full` (every gender, every variant) as specified.
6. **Inclusivity of odd variants** (new): totem and costume-cap Pikachu
   varieties are *included* since PokéAPI lists them and the goal is "every
   variant" — easy to exclude with a filter in `expand.ts` if unwanted.
