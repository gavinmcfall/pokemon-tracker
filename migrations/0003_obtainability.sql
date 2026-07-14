-- Catalogue-derived obtainability: where/how each slot is legitimately obtained
-- plus shiny/mechanic flags. Computed by the seed from PokéAPI encounters +
-- evolution chains + a curated overlay, and regenerated on every seed run
-- (full replace). Keyed by entry_key, cascades with the entry like status and
-- specimen. `availability` is an array of {gameId,label,platform,method,
-- shinyPossible} objects.
create table obtainability (
  entry_key           text primary key references entries(entry_key) on delete cascade,
  availability        jsonb   not null default '[]',
  gmax_capable        boolean not null default false,
  tera_available      boolean not null default false,
  catchable_on_switch boolean not null default false,
  shiny_legal_somewhere boolean not null default true,
  unobtainable_legit  boolean not null default false,
  gender_visual_diff  boolean not null default false,
  shiny_locked_in     text[]  not null default '{}',
  origin_games        text[]  not null default '{}',
  updated_at          timestamptz not null default now()
);
