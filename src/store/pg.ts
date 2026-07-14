import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AvailabilityEntry, Entry, EntryFilters, EntryWithStatus, Ivs, Specimen, SpecimenInput, Status, StatusPatch, Summary } from '../types.js';
import { normalizeSpecimen, type ObtainabilityRecord, type SpecimenSyncResult, type Store, type UpsertResult } from './store.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

interface EntryRow {
  entry_key: string;
  dex: number;
  name: string;
  form_slug: string;
  form_label: string | null;
  gender: Entry['gender'];
  types: string[];
  generation: number;
  sprite_url: string;
  is_cosmetic: boolean;
  s_caught: boolean | null;
  s_caught_at: Date | null;
  s_game_origin: string | null;
  s_method: string | null;
  s_notes: string | null;
  sp_entry_key: string | null;
  sp_shiny: boolean | null;
  sp_event: boolean | null;
  sp_level: number | null;
  sp_origin_game: string | null;
  sp_met_year: number | null;
  sp_iv_perfect: number | null;
  sp_ivs: Ivs | null;
  sp_tera: string | null;
  sp_ball: string | null;
  sp_nature: string | null;
  sp_ability: string | null;
  sp_ribbons: string[] | null;
  sp_nickname: string | null;
  sp_ot: string | null;
  ob_entry_key: string | null;
  ob_availability: AvailabilityEntry[] | null;
  ob_gmax_capable: boolean | null;
  ob_tera_available: boolean | null;
  ob_catchable_on_switch: boolean | null;
  ob_shiny_legal_somewhere: boolean | null;
  ob_unobtainable_legit: boolean | null;
  ob_gender_visual_diff: boolean | null;
  ob_shiny_locked_in: string[] | null;
  ob_origin_games: string[] | null;
}

function rowToEntry(row: EntryRow): EntryWithStatus {
  return {
    entryKey: row.entry_key,
    dex: row.dex,
    name: row.name,
    formSlug: row.form_slug,
    formLabel: row.form_label,
    gender: row.gender,
    types: row.types,
    generation: row.generation,
    spriteUrl: row.sprite_url,
    isCosmetic: row.is_cosmetic,
    status: row.s_caught === null ? null : {
      entryKey: row.entry_key,
      caught: row.s_caught,
      caughtAt: row.s_caught_at ? row.s_caught_at.toISOString() : null,
      gameOrigin: row.s_game_origin,
      method: row.s_method,
      notes: row.s_notes,
    },
    specimen: row.sp_entry_key === null ? null : {
      entryKey: row.sp_entry_key,
      shiny: row.sp_shiny ?? false,
      event: row.sp_event ?? false,
      level: row.sp_level,
      originGame: row.sp_origin_game,
      metYear: row.sp_met_year,
      ivPerfect: row.sp_iv_perfect,
      ivs: row.sp_ivs,
      tera: row.sp_tera,
      ball: row.sp_ball,
      nature: row.sp_nature,
      ability: row.sp_ability,
      ribbons: row.sp_ribbons ?? [],
      nickname: row.sp_nickname,
      ot: row.sp_ot,
    },
    obtainability: row.ob_entry_key === null ? null : {
      availability: row.ob_availability ?? [],
      gmaxCapable: row.ob_gmax_capable ?? false,
      teraAvailable: row.ob_tera_available ?? false,
      catchableOnSwitch: row.ob_catchable_on_switch ?? false,
      shinyLegalSomewhere: row.ob_shiny_legal_somewhere ?? true,
      unobtainableLegit: row.ob_unobtainable_legit ?? false,
      genderVisualDiff: row.ob_gender_visual_diff ?? false,
      shinyLockedIn: row.ob_shiny_locked_in ?? [],
      originGames: row.ob_origin_games ?? [],
    },
  };
}

const BASE_SELECT = `
  select e.entry_key, e.dex, e.name, e.form_slug, e.form_label, e.gender,
         e.types, e.generation, e.sprite_url, e.is_cosmetic,
         s.caught as s_caught, s.caught_at as s_caught_at,
         s.game_origin as s_game_origin, s.method as s_method, s.notes as s_notes,
         sp.entry_key as sp_entry_key, sp.shiny as sp_shiny, sp.event as sp_event,
         sp.level as sp_level, sp.origin_game as sp_origin_game, sp.met_year as sp_met_year,
         sp.iv_perfect as sp_iv_perfect, sp.ivs as sp_ivs, sp.tera as sp_tera,
         sp.ball as sp_ball, sp.nature as sp_nature, sp.ability as sp_ability,
         sp.ribbons as sp_ribbons, sp.nickname as sp_nickname, sp.ot as sp_ot,
         ob.entry_key as ob_entry_key, ob.availability as ob_availability,
         ob.gmax_capable as ob_gmax_capable, ob.tera_available as ob_tera_available,
         ob.catchable_on_switch as ob_catchable_on_switch,
         ob.shiny_legal_somewhere as ob_shiny_legal_somewhere,
         ob.unobtainable_legit as ob_unobtainable_legit,
         ob.gender_visual_diff as ob_gender_visual_diff,
         ob.shiny_locked_in as ob_shiny_locked_in, ob.origin_games as ob_origin_games
  from entries e
  left join status s using (entry_key)
  left join specimen sp using (entry_key)
  left join obtainability ob using (entry_key)
`;

const ORDER_BY = `
  order by e.dex,
           case when e.form_slug = 'default' then 0 else 1 end,
           e.form_slug,
           case e.gender when 'male' then 0 when 'female' then 1 else 2 end
`;

export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
      );
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        await client.query('begin');
        try {
          // Serialize concurrent migrators (api boot + seed job racing at install time).
          await client.query('select pg_advisory_xact_lock(727566)');
          const { rowCount } = await client.query('select 1 from schema_migrations where name = $1', [file]);
          if (!rowCount) {
            const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
            await client.query(sql);
            await client.query('insert into schema_migrations (name) values ($1)', [file]);
          }
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw err;
        }
      }
    } finally {
      client.release();
    }
  }

  async upsertEntries(entries: Entry[]): Promise<UpsertResult> {
    const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const e of entries) {
        const res = await client.query<{ inserted: boolean }>(
          `insert into entries (entry_key, dex, name, form_slug, form_label, gender, types, generation, sprite_url, is_cosmetic)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (entry_key) do update set
             dex = excluded.dex, name = excluded.name, form_slug = excluded.form_slug,
             form_label = excluded.form_label, gender = excluded.gender, types = excluded.types,
             generation = excluded.generation, sprite_url = excluded.sprite_url,
             is_cosmetic = excluded.is_cosmetic, updated_at = now()
           where (entries.dex, entries.name, entries.form_slug, entries.form_label, entries.gender,
                  entries.types, entries.generation, entries.sprite_url, entries.is_cosmetic)
             is distinct from
                 (excluded.dex, excluded.name, excluded.form_slug, excluded.form_label, excluded.gender,
                  excluded.types, excluded.generation, excluded.sprite_url, excluded.is_cosmetic)
           returning (xmax = 0) as inserted`,
          [e.entryKey, e.dex, e.name, e.formSlug, e.formLabel, e.gender, e.types, e.generation, e.spriteUrl, e.isCosmetic],
        );
        const row = res.rows[0];
        if (!row) result.unchanged += 1;        // conflict + WHERE false → no row returned
        else if (row.inserted) result.inserted += 1;
        else result.updated += 1;
      }
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async listEntries(filters: EntryFilters): Promise<EntryWithStatus[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.gen !== undefined) {
      params.push(filters.gen);
      where.push(`e.generation = $${params.length}`);
    }
    if (filters.type !== undefined) {
      params.push(filters.type.toLowerCase());
      where.push(`$${params.length} = any(e.types)`);
    }
    if (filters.status === 'caught') where.push('s.caught is true');
    if (filters.status === 'uncaught') where.push('coalesce(s.caught, false) = false');
    if (filters.q !== undefined && filters.q !== '') {
      params.push(`%${escapeLike(filters.q)}%`);
      where.push(`(e.name ilike $${params.length} or e.form_label ilike $${params.length} or e.entry_key ilike $${params.length})`);
    }
    const sql = BASE_SELECT + (where.length ? ` where ${where.join(' and ')}` : '') + ORDER_BY;
    const res = await this.pool.query<EntryRow>(sql, params);
    return res.rows.map(rowToEntry);
  }

  async listEntryKeys(): Promise<Set<string>> {
    const res = await this.pool.query<{ entry_key: string }>('select entry_key from entries');
    return new Set(res.rows.map((r) => r.entry_key));
  }

  async getSummary(gen?: number): Promise<Summary> {
    const params: unknown[] = [];
    let where = '';
    if (gen !== undefined) {
      params.push(gen);
      where = ` where e.generation = $${params.length}`;
    }
    const totals = await this.pool.query<{ caught: string; total: string }>(
      `select count(*) filter (where s.caught) as caught, count(*) as total
       from entries e left join status s using (entry_key)${where}`,
      params,
    );
    const byType = await this.pool.query<{ type: string; caught: string; total: string }>(
      `select t.type, count(*) filter (where s.caught) as caught, count(*) as total
       from entries e
       cross join lateral unnest(e.types) as t(type)
       left join status s using (entry_key)${where}
       group by t.type order by t.type`,
      params,
    );
    const caught = Number(totals.rows[0]?.caught ?? 0);
    const total = Number(totals.rows[0]?.total ?? 0);
    return {
      caught,
      total,
      pct: total === 0 ? 0 : Math.round((caught / total) * 1000) / 10,
      byType: byType.rows.map((r) => ({ type: r.type, caught: Number(r.caught), total: Number(r.total) })),
    };
  }

  async setStatus(patch: StatusPatch): Promise<Status | null> {
    const res = await this.pool.query<{
      entry_key: string; caught: boolean; caught_at: Date | null;
      game_origin: string | null; method: string | null; notes: string | null;
    }>(
      `insert into status (entry_key, caught, caught_at, game_origin, method, notes)
       select $1, $2,
              case when $2 then now() end,
              $3::text, $4::text, $5::text
       where exists (select 1 from entries where entry_key = $1)
       on conflict (entry_key) do update set
         caught = excluded.caught,
         caught_at = case
           when not excluded.caught then null
           when status.caught then status.caught_at
           else now()
         end,
         game_origin = case when $6 then excluded.game_origin else status.game_origin end,
         method      = case when $7 then excluded.method      else status.method      end,
         notes       = case when $8 then excluded.notes       else status.notes       end,
         updated_at = now()
       returning entry_key, caught, caught_at, game_origin, method, notes`,
      [
        patch.entryKey,
        patch.caught,
        patch.gameOrigin ?? null,
        patch.method ?? null,
        patch.notes ?? null,
        patch.gameOrigin !== undefined,
        patch.method !== undefined,
        patch.notes !== undefined,
      ],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      entryKey: row.entry_key,
      caught: row.caught,
      caughtAt: row.caught_at ? row.caught_at.toISOString() : null,
      gameOrigin: row.game_origin,
      method: row.method,
      notes: row.notes,
    };
  }

  async replaceSpecimens(inputs: SpecimenInput[]): Promise<SpecimenSyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Which payload keys exist in the catalogue? (report the rest as unmatched)
      const keys = inputs.map((i) => i.entryKey);
      const present = new Set<string>();
      if (keys.length > 0) {
        const res = await client.query<{ entry_key: string }>(
          'select entry_key from entries where entry_key = any($1)',
          [keys],
        );
        for (const r of res.rows) present.add(r.entry_key);
      }
      const unmatched = keys.filter((k) => !present.has(k));

      // Full-sync: clear then insert the matched set. `on conflict` makes a
      // duplicate entryKey in the payload last-write-wins (matching MemoryStore)
      // instead of throwing a primary-key violation.
      await client.query('delete from specimen');
      const seen = new Set<string>();
      for (const input of inputs) {
        if (!present.has(input.entryKey)) continue;
        const s = normalizeSpecimen(input);
        await client.query(
          `insert into specimen
             (entry_key, shiny, event, level, origin_game, met_year, iv_perfect, ivs,
              tera, ball, nature, ability, ribbons, nickname, ot)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           on conflict (entry_key) do update set
             shiny=excluded.shiny, event=excluded.event, level=excluded.level,
             origin_game=excluded.origin_game, met_year=excluded.met_year, iv_perfect=excluded.iv_perfect,
             ivs=excluded.ivs, tera=excluded.tera, ball=excluded.ball, nature=excluded.nature,
             ability=excluded.ability, ribbons=excluded.ribbons, nickname=excluded.nickname, ot=excluded.ot`,
          [
            s.entryKey, s.shiny, s.event, s.level, s.originGame, s.metYear, s.ivPerfect,
            s.ivs === null ? null : JSON.stringify(s.ivs),
            s.tera, s.ball, s.nature, s.ability, s.ribbons, s.nickname, s.ot,
          ],
        );
        seen.add(input.entryKey);
      }
      await client.query('commit');
      return { upserted: seen.size, unmatched };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async replaceObtainability(records: ObtainabilityRecord[]): Promise<SpecimenSyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const keys = records.map((r) => r.entryKey);
      const present = new Set<string>();
      if (keys.length > 0) {
        const res = await client.query<{ entry_key: string }>(
          'select entry_key from entries where entry_key = any($1)',
          [keys],
        );
        for (const r of res.rows) present.add(r.entry_key);
      }
      const unmatched = keys.filter((k) => !present.has(k));

      // `on conflict` makes a duplicate entryKey last-write-wins (matching
      // MemoryStore) rather than throwing a primary-key violation.
      await client.query('delete from obtainability');
      const seen = new Set<string>();
      for (const { entryKey, obtainability: o } of records) {
        if (!present.has(entryKey)) continue;
        await client.query(
          `insert into obtainability
             (entry_key, availability, gmax_capable, tera_available, catchable_on_switch,
              shiny_legal_somewhere, unobtainable_legit, gender_visual_diff, shiny_locked_in, origin_games)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (entry_key) do update set
             availability=excluded.availability, gmax_capable=excluded.gmax_capable,
             tera_available=excluded.tera_available, catchable_on_switch=excluded.catchable_on_switch,
             shiny_legal_somewhere=excluded.shiny_legal_somewhere, unobtainable_legit=excluded.unobtainable_legit,
             gender_visual_diff=excluded.gender_visual_diff, shiny_locked_in=excluded.shiny_locked_in,
             origin_games=excluded.origin_games`,
          [
            entryKey, JSON.stringify(o.availability), o.gmaxCapable, o.teraAvailable, o.catchableOnSwitch,
            o.shinyLegalSomewhere, o.unobtainableLegit, o.genderVisualDiff, o.shinyLockedIn, o.originGames,
          ],
        );
        seen.add(entryKey);
      }
      const upserted = seen.size;
      await client.query('commit');
      return { upserted, unmatched };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async ready(): Promise<void> {
    await this.pool.query('select 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
