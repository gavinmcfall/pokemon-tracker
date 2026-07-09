/// <reference lib="dom" />
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
  await request.post('/e2e/reset');
  await page.goto('/');
  await expect(page.locator('.card').first()).toBeVisible();
});

test('loads the grid with summary and entries', async ({ page }) => {
  await expect(page).toHaveTitle('Living Dex');
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.locator('#summary-count')).toHaveText('1 / 4');
  const fancy = page.locator('.card[data-entry-key="0666-fancy-female"]');
  await expect(fancy).toHaveAttribute('aria-pressed', 'true');
  await expect(fancy.locator('.form')).toHaveText('Fancy Vivillon');
});

test('toggles caught state and updates the summary', async ({ page }) => {
  const charizard = page.locator('.card[data-entry-key="0006-default-male"]');
  await expect(charizard).toHaveAttribute('aria-pressed', 'false');
  await charizard.click();
  await expect(charizard).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#summary-count')).toHaveText('2 / 4');

  await charizard.click();
  await expect(charizard).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#summary-count')).toHaveText('1 / 4');
});

test('filters narrow the grid', async ({ page }) => {
  await page.locator('#f-status').selectOption('caught');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card').first()).toHaveAttribute('data-entry-key', '0666-fancy-female');

  await page.locator('#f-status').selectOption('');
  await page.locator('#f-q').fill('mega');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card').first()).toHaveAttribute('data-entry-key', '0006-mega_x-male');
});

test('keyboard-only: cards are reachable and toggleable without a pointer', async ({ page }) => {
  const mewtwo = page.locator('.card[data-entry-key="0150-default-genderless"]');
  await mewtwo.focus();
  await expect(mewtwo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mewtwo).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(mewtwo).toHaveAttribute('aria-pressed', 'false');
});

test('no horizontal overflow on small viewports', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
