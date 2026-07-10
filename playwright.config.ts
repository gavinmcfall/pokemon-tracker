import { defineConfig, devices } from '@playwright/test';

/**
 * Two lanes (spec §8):
 *  - desktop: baseline Chrome
 *  - serina: the gating persona — phone viewport, reduced motion, and
 *    keyboard-driven assertions inside the specs. Port the full multi-persona
 *    pack from the SCBridge QA Advocate when wiring the real front-end.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  // Both projects share one harness server (mutable MemoryStore state), so
  // lanes must not interleave. Each test restores the state it changes.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8199',
    trace: 'retain-on-failure',
    // Allow overriding the browser binary in environments with a
    // pre-installed Chromium (e.g. PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium).
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: 'npx tsx e2e/server.ts',
    url: 'http://127.0.0.1:8199/healthz',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'serina',
      use: {
        ...devices['Pixel 7'],
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],
});
