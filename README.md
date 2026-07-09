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
| `web/` | Static SPA + nginx `/api` proxy (placeholder until the Claude Design front-end lands) | `ghcr.io/gavinmcfall/livingdex-web` |
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

### API

All JSON unless noted. `web` proxies `/api` to the api service (one origin, no CORS).

```
GET  /api/entries?gen=&type=&status=caught|uncaught&q=
       -> Entry[]  (each with an embedded `status` object, null if untouched)
GET  /api/summary?gen=      -> { caught, total, pct, byType: [{type, caught, total}] }
POST /api/status            { entryKey, caught, gameOrigin?, method?, notes? } -> Status
       (metadata fields are patch-style: omitted = keep, null/"" = clear;
        caughtAt is server-managed — set on catch, kept on re-affirm, cleared on uncatch)
POST /api/import            multipart field `file` (or raw text/csv body)
       -> { matched, updated, unmatched: [{line, reason, raw}] }
GET  /api/export            -> text/csv (round-trips through import)
GET  /healthz  /readyz      -> k8s probes
```

CSV import matches rows by `entryKey` when present, otherwise by `dex`
(+ optional `form`, `gender` columns — a flat one-row-per-species sheet marks
every matching slot). Unmatched rows are reported, never fatal. Header aliases
like `National Dex`, `Owned`, `Game` are recognized.

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
- The e2e "serina" lane already caught one real bug (disabled-button focus
  loss breaking keyboard toggling). Port the full SCBridge multi-persona pack
  when the real front-end lands.

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
