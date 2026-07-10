import { serve } from '@hono/node-server';
import { createApp, type AppOptions } from './app.js';
import { PgStore } from './store/pg.js';
import { SpriteMirror } from './sprites.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const port = Number.parseInt(process.env.PORT ?? '8080', 10);

const store = new PgStore(databaseUrl);
await store.migrate();

const appOptions: AppOptions = {};
if (process.env.SPRITE_DIR) {
  const sprites = new SpriteMirror({
    dir: process.env.SPRITE_DIR,
    log: (msg) => console.warn(`[sprites] ${msg}`),
  });
  await sprites.init();
  appOptions.sprites = sprites;
  console.log(`sprite mirror enabled at ${sprites.dir} (${sprites.progress().mirrored} present)`);
}

const app = createApp(store, appOptions);
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`livingdex-api listening on :${info.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
  });
}
