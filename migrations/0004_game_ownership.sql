-- Game ownership: which games the (single) owner actually has, and how — by
-- physical cartridge, emulator, and/or romhack. Per-game and multi-method: a
-- game can be owned more than one way at once (own the cartridge AND emulate it).
-- game_id is a GAMES slug (validated in the app, not FK'd — GAMES lives in code,
-- not a table). A row exists only for games with some ownership or a note; the
-- app deletes a row that becomes empty. Drives the "in a game you own" signal on
-- obtainability and, later, the living-dex planner.
create table game_ownership (
  game_id     text primary key,
  cartridge   boolean not null default false,
  emulator    boolean not null default false,
  romhack     boolean not null default false,
  notes       text,
  updated_at  timestamptz not null default now()
);
