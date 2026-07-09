-- Living Dex schema (spec §4). One row in `entries` = one collectible slot
-- (species × form × gender), seeded from PokéAPI. `status` is the owner's data.

create table entries (
  entry_key   text primary key,
  dex         integer not null,
  name        text    not null,
  form_slug   text    not null default 'default',
  form_label  text,
  gender      text    not null check (gender in ('male', 'female', 'genderless')),
  types       text[]  not null default '{}',   -- primary first
  generation  integer not null,
  sprite_url  text    not null,
  is_cosmetic boolean not null default false,  -- e.g. Vivillon patterns, Furfrou trims
  updated_at  timestamptz not null default now()
);
create index on entries (generation);
create index on entries using gin (types);
create index on entries (dex);

-- Single-owner v1. Extension point: if a second collector is added, promote the
-- PK to (owner_id, entry_key) with owner_id text not null default 'owner', add
-- an owners table, and key API reads/writes by owner. Do not build that now.
create table status (
  entry_key   text primary key references entries(entry_key) on delete cascade,
  caught      boolean not null default false,
  caught_at   timestamptz,
  game_origin text,
  method      text,
  notes       text,
  updated_at  timestamptz not null default now()
);
