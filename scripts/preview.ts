/**
 * Local dev preview: serves web/public and the API on one origin, backed by
 * the real Postgres from DATABASE_URL (the nginx+api split does this in prod).
 *
 *   DATABASE_URL=postgres://… npm run preview
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, type AppOptions } from '../src/app.js';
import { PgStore } from '../src/store/pg.js';
import { SpriteMirror } from '../src/sprites.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const port = Number.parseInt(process.env.PORT ?? '8321', 10);

const store = new PgStore(databaseUrl);
await store.migrate();

const appOptions: AppOptions = {};
if (process.env.SPRITE_DIR) {
  const sprites = new SpriteMirror({ dir: process.env.SPRITE_DIR });
  await sprites.init();
  appOptions.sprites = sprites;
}

const app = createApp(store, appOptions);
app.use('*', serveStatic({ root: 'web/public' }));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`preview on http://127.0.0.1:${info.port}`);
});
