-- Transfer backlog: is a caught slot actually banked in Pokémon HOME, or
-- sitting in its origin game awaiting transfer? Defaults true so existing
-- rows (sourced from the owner's HOME export) stay truthful; fresh catches
-- ticked off during a play session are recorded as in-transit by the UI.
alter table status add column if not exists in_home boolean not null default true;
