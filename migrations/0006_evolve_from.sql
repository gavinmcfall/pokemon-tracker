-- Companion "how" hint: how a species is reached by evolution, from the
-- mirror's evolution data — {dex, name, trade}. Null when the species doesn't
-- evolve from anything (or the seed hasn't recomputed yet). Availability
-- location hints ride inside the existing `availability` jsonb.
alter table obtainability add column if not exists evolve_from jsonb;
