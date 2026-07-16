-- Generalise game ownership from three fixed boolean columns
-- (cartridge/emulator/romhack) to a `methods text[]` list, so a game can carry
-- platform-appropriate methods instead of a hard-coded trio. Physical/handheld/
-- Switch titles still use cartridge|emulator|romhack; mobile (Pokémon GO) uses a
-- single `digital` method (there is no cartridge to own). The applicable set per
-- game is enforced in the app, not the schema.
alter table game_ownership add column methods text[] not null default '{}';

update game_ownership set methods = array_remove(array[
  case when cartridge then 'cartridge' end,
  case when emulator  then 'emulator'  end,
  case when romhack   then 'romhack'   end
], null);

alter table game_ownership
  drop column cartridge,
  drop column emulator,
  drop column romhack;
