/// <reference lib="dom" />
import { expect, test } from '@playwright/test';

// The e2e harness (e2e/server.ts) seeds four entries: three in Gen I
// (Charizard default+mega_x, Mewtwo) and one caught Gen VI Vivillon.
const gridButton = '.grid .tile-body';

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

test('mirror-sprites control mirrors and rewrites tile sprite URLs to local', async ({ page }) => {
  // The harness enables the sprite mirror (fake fetch), so the button shows.
  const mirror = page.locator('#mirror-btn');
  await expect(mirror).toBeVisible();
  await mirror.click();
  // completes quickly (fake fetch) — button settles to the mirrored state
  await expect(mirror).toHaveText('Mirrored ✓', { timeout: 10_000 });
  // the grid now points at the local mirror rather than a remote URL
  await expect(page.locator('.grid .tile-body img').first()).toHaveAttribute('src', /^\/api\/sprites\//);
});

test('detail sheet: opens via ⋯, edits metadata, persists across reload', async ({ page }) => {
  const mega = `${gridButton}[data-entry-key="0006-mega_x-male"]`;
  await page.locator(`${mega} ~ .tile-info`).click();
  const panel = page.locator('.sheet-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('MY CATCH');
  await expect(panel).toContainText('Mega Charizard X');
  // the harness now provides obtainability → the sheet shows the zone
  await expect(page.locator('.sheet-section.obtain')).toHaveCount(1);

  await panel.getByLabel('Close details').click(); // reopen fresh below; first fill fields
  await page.locator(`${mega} ~ .tile-info`).click();
  await page.locator('.sheet-panel input[list="dex-game-suggestions"]').fill('emu:Emerald');
  await page.locator('.sheet-panel input[list="dex-method-suggestions"]').fill('bred');
  await page.locator('.sheet-panel textarea').fill('shiny after 300 eggs');
  await page.locator('.sheet-panel textarea').blur();
  // mark caught from inside the sheet
  await page.locator('.sheet-section button[aria-pressed]').first().click();
  await expect(page.locator('#caught')).toHaveText('1');

  await page.reload();
  await expect(page.locator(gridButton).first()).toBeVisible();
  await page.locator(`${mega} ~ .tile-info`).click();
  const panel2 = page.locator('.sheet-panel');
  await expect(panel2.locator('input[list="dex-game-suggestions"]')).toHaveValue('emu:Emerald');
  await expect(panel2.locator('input[list="dex-method-suggestions"]')).toHaveValue('bred');
  await expect(panel2.locator('textarea')).toHaveValue('shiny after 300 eggs');
  await expect(panel2.locator('button[aria-pressed="true"]').first()).toBeVisible();
});

test('specimen: caught Vivillon shows shiny/event/6IV badges and a Best Specimen zone', async ({ page }) => {
  await page.locator('.gen-chips button[data-gen="6"]').click();
  const vivillon = `${gridButton}[data-entry-key="0666-fancy-female"]`;
  await expect(page.locator(vivillon)).toBeVisible();
  // at-a-glance badges on the tile
  await expect(page.locator(`${vivillon} .tile-badge[data-kind="shiny"]`)).toBeVisible();
  await expect(page.locator(`${vivillon} .tile-badge[data-kind="event"]`)).toBeVisible();
  await expect(page.locator(`${vivillon} .tile-badge[data-kind="sixiv"]`)).toBeVisible();

  // open the sheet → Best Specimen zone with the rich detail
  await page.locator(`${vivillon} ~ .tile-info`).click();
  const zone = page.locator('.sheet-section.specimen');
  await expect(zone).toBeVisible();
  await expect(zone).toContainText('BEST SPECIMEN');
  await expect(zone).toContainText('✨ SHINY');
  await expect(zone).toContainText('TERA FAIRY');
  await expect(zone).toContainText('Scarlet/Violet'); // originGame slug -> friendly label
  await expect(zone).toContainText('2023');
  await expect(zone).toContainText('Papillon'); // nickname
  await expect(zone).toContainText('Serina'); // OT
  await expect(zone).toContainText('🎀 Classic'); // ribbon
});

test('specimen: an uncaught entry has no badges and no Best Specimen zone', async ({ page }) => {
  const charizard = `${gridButton}[data-entry-key="0006-default-male"]`;
  await expect(page.locator(`${charizard} .tile-badge`)).toHaveCount(0);
  await page.locator(`${charizard} ~ .tile-info`).click();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await expect(page.locator('.sheet-section.specimen')).toHaveCount(0);
});

test('obtainability: filters appear and the detail sheet shows availability', async ({ page }) => {
  // enrichment is present, so the obtain filter row shows
  await expect(page.locator('#obtain-row')).toBeVisible();
  await expect(page.locator('#obtain-chips button[data-obtain="gmax"]')).toBeVisible();

  // the Charizard detail sheet shows the Obtainability zone with its game + GMAX badge
  const cz = `${gridButton}[data-entry-key="0006-default-male"]`;
  await page.locator(`${cz} ~ .tile-info`).click();
  const obtain = page.locator('.sheet-section.obtain');
  await expect(obtain).toBeVisible();
  await expect(obtain).toContainText('OBTAINABILITY');
  await expect(obtain).toContainText("Let's Go");
  await expect(obtain).toContainText('GMAX');
});

test('obtainability: the GMax filter narrows the grid to gmax-capable entries', async ({ page }) => {
  // Gen I: Charizard default + mega_x are gmax-capable; Mewtwo is not
  await expect(page.locator(gridButton)).toHaveCount(3);
  await page.locator('#obtain-chips button[data-obtain="gmax"]').click();
  await expect(page.locator(gridButton)).toHaveCount(2);
  for (const key of ['0006-default-male', '0006-mega_x-male']) {
    await expect(page.locator(`${gridButton}[data-entry-key="${key}"]`)).toBeVisible();
  }
});

test('detail sheet: Escape and scrim click close it', async ({ page }) => {
  await page.locator('.grid .tile-info').first().click();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-panel')).toHaveCount(0);

  await page.locator('.grid .tile-info').first().click();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await page.locator('.sheet-scrim').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.sheet-panel')).toHaveCount(0);
});
