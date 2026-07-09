/// <reference lib="dom" />
import { expect, test } from '@playwright/test';

// The e2e harness (e2e/server.ts) seeds four entries: three in Gen I
// (Charizard default+mega_x, Mewtwo) and one caught Gen VI Vivillon.
const gridButton = '.grid button';

test.beforeEach(async ({ page, request }) => {
  await request.post('/e2e/reset');
  await page.goto('/');
  await expect(page.locator(gridButton).first()).toBeVisible();
});

test('loads the generation-scoped grid with header progress', async ({ page }) => {
  await expect(page).toHaveTitle('Living Dex');
  await expect(page.locator('#region')).toHaveText('Kanto');
  // Gen I is the default view: 3 entries, none caught
  await expect(page.locator(gridButton)).toHaveCount(3);
  await expect(page.locator('#caught')).toHaveText('0');
  await expect(page.locator('#total')).toHaveText('/ 3');
  await expect(page.locator('#pct')).toHaveText('0%');
});

test('switching generation rescopes the view and shows the caught Vivillon', async ({ page }) => {
  await page.locator('.gen-chips button[data-gen="6"]').click();
  await expect(page.locator('#region')).toHaveText('Kalos');
  await expect(page.locator(gridButton)).toHaveCount(1);
  const vivillon = page.locator(`${gridButton}[data-entry-key="0666-fancy-female"]`);
  await expect(vivillon).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#caught')).toHaveText('1');
  await expect(page.locator('#pct')).toHaveText('100%');
});

test('toggles caught state and updates the header count', async ({ page }) => {
  const charizard = page.locator(`${gridButton}[data-entry-key="0006-default-male"]`);
  await expect(charizard).toHaveAttribute('aria-pressed', 'false');
  await charizard.click();
  await expect(charizard).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#caught')).toHaveText('1');

  await charizard.click();
  await expect(charizard).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#caught')).toHaveText('0');
});

test('a catch persists across reload (server-backed, not localStorage)', async ({ page }) => {
  await page.locator(`${gridButton}[data-entry-key="0006-mega_x-male"]`).click();
  await expect(page.locator('#caught')).toHaveText('1');
  await page.reload();
  await expect(page.locator(gridButton).first()).toBeVisible();
  await expect(page.locator(`${gridButton}[data-entry-key="0006-mega_x-male"]`)).toHaveAttribute('aria-pressed', 'true');
});

test('status and type filters narrow the grid; empty state offers a reset', async ({ page }) => {
  // status: Needed hides nothing yet (all 3 uncaught)
  await page.locator('.status-chips button[data-status="needed"]').click();
  await expect(page.locator(gridButton)).toHaveCount(3);

  // catch one, then Caught shows exactly it
  await page.locator('.status-chips button[data-status="all"]').click();
  await page.locator(`${gridButton}[data-entry-key="0150-default-genderless"]`).click();
  await page.locator('.status-chips button[data-status="caught"]').click();
  await expect(page.locator(gridButton)).toHaveCount(1);
  await expect(page.locator(gridButton).first()).toHaveAttribute('data-entry-key', '0150-default-genderless');

  // a search with no matches shows the empty state; its action clears filters
  await page.locator('.status-chips button[data-status="all"]').click();
  await page.locator('#search').fill('zzzzz');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#empty-action').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator(gridButton)).toHaveCount(3);
});

test('search matches by dex number', async ({ page }) => {
  await page.locator('#search').fill('#6');
  await expect(page.locator(gridButton)).toHaveCount(2); // Charizard default + mega_x
  for (const key of ['0006-default-male', '0006-mega_x-male']) {
    await expect(page.locator(`${gridButton}[data-entry-key="${key}"]`)).toBeVisible();
  }
});

test('keyboard-only: a tile is reachable and toggleable without a pointer', async ({ page }) => {
  const mewtwo = page.locator(`${gridButton}[data-entry-key="0150-default-genderless"]`);
  await mewtwo.focus();
  await expect(mewtwo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mewtwo).toHaveAttribute('aria-pressed', 'true');
  // focus survives the in-place restyle (no grid rebuild while status=all)
  await expect(mewtwo).toBeFocused();
  await page.keyboard.press('Space');
  await expect(mewtwo).toHaveAttribute('aria-pressed', 'false');
});

test('theme toggle cycles auto → light → dark', async ({ page }) => {
  const btn = page.locator('#theme-btn');
  await expect(btn).toHaveText('◐ Auto');
  await btn.click();
  await expect(btn).toHaveText('○ Light');
  await expect(page.locator('html')).toHaveAttribute('style', /color-scheme:\s*light/);
  await btn.click();
  await expect(btn).toHaveText('● Dark');
});

test('no horizontal overflow on a phone viewport', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
