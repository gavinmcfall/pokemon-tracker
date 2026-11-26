-- Forms Pokémon HOME can't store (fusions, held-item forms, battle-only forms)
-- live in a game save instead.
--   obtainability.kept_in: catalogue-derived {kind: 'save'|'battle', releases}
--     from pokepc/dataset's storableIn; null = HOME stores the form.
--   status.held_in: owner-authored release id of the save holding the caught
--     form (for battle-only forms: the save with the base form + trigger item).
alter table obtainability add column if not exists kept_in jsonb;
alter table status add column if not exists held_in text;
