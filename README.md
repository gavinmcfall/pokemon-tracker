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
  shiny-locked-everywhere species, and a small static/gift supplement. Defaults
  stay conservative — shiny is legal unless a curated entry says otherwise, so a
  gap under-claims rather than misleads.

Version-group→game rollup lives in `src/obtainability/games.ts`
(`VERSION_GROUP_TO_GAME`; DLC folds into its base game, GameCube/JP/unreleased
groups are unmapped → "unknown"). Known limits (documented, not fabricated):
obtainability is species-level (pokédex membership can't split Alolan vs
Kantonian Raichu — regional-form exclusivity is future work), and a handful of
National-dex-only event mons show empty availability rather than a guess.

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
