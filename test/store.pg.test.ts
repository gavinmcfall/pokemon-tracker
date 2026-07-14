import { afterAll, describe, it } from 'vitest';
import pg from 'pg';
import { PgStore } from '../src/store/pg.js';
import { storeContract } from './store-contract.js';

/**
 * Integration lane: runs the same contract as MemoryStore against a real
 * Postgres. Set TEST_DATABASE_URL to a DISPOSABLE database — tables are
 * dropped before each store is created. Skipped when unset (CI always sets it).
 */
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe('store contract: PgStore', () => {
    it.skip('skipped — set TEST_DATABASE_URL to a disposable database to run', () => {});
  });
} else {
  const stores: PgStore[] = [];

  storeContract('PgStore', async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('drop table if exists specimen, status, entries, schema_migrations cascade');
    await admin.end();
    const store = new PgStore(url);
    stores.push(store);
    await store.migrate();
    return store;
  });

  afterAll(async () => {
    await Promise.all(stores.map((s) => s.close()));
  });
}
