-- HOME-derived enrichment: the best individual filling a caught slot, one per
-- entry_key. Separate from `status` on purpose — `status` is owner-authored
-- catch tracking (hand-edited in the UI); `specimen` is machine-generated from a
-- Pokémon HOME export and regenerated on every sync, so the two must not clobber
-- each other. Cascades with the entry (same as status), so a re-keyed or pruned
-- entry cleans up its specimen automatically.
create table specimen (
  entry_key   text primary key references entries(entry_key) on delete cascade,
  shiny       boolean not null default false,
  event       boolean not null default false,   -- fateful encounter = event/gift
  level       integer,
  origin_game text,                              -- game slug: swsh/sv/go/lgpe/xy/oras…
  met_year    integer,
  iv_perfect  integer,                           -- count of 31 IVs, 0..6
  ivs         jsonb,                             -- {hp,atk,def,spa,spd,spe}, 0..31
  tera        text,                              -- SV-origin only, else null
  ball        text,
  nature      text,
  ability     text,
  ribbons     text[]  not null default '{}',     -- decoded ribbon names
  nickname    text,
  ot          text,
  updated_at  timestamptz not null default now()
);
create index on specimen (shiny) where shiny;
create index on specimen (event) where event;
