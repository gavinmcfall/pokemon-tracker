/// <reference lib="dom" />
import { expect, test } from '@playwright/test';

// The e2e harness (e2e/server.ts) seeds four entries: three in Gen I
// (Charizard default+mega_x, Mewtwo) and one caught Gen VI Vivillon.
const gridButton = '.grid .tile-body';

// On the phone lane most filter chrome lives behind the Filters toggle, and
// while the panel is OPEN it covers the grid (it's a full-height sticky
// header) — so specs open it around header-control interactions and close it
// again before touching tiles, mirroring how a phone user actually works.
// Both helpers no-op on desktop, where everything is always visible.
type Pg = import('@playwright/test').Page;
async function openFilters(page: Pg): Promise<void> {
  const t = page.locator('#filters-btn');
  if (await t.isVisible() && (await t.getAttribute('aria-expanded')) !== 'true') await t.click();
}
async function closeFilters(page: Pg): Promise<void> {
  const t = page.locator('#filters-btn');
  if (await t.isVisible() && (await t.getAttribute('aria-expanded')) === 'true') await t.click();
}

test.beforeEach(async ({ page, request }) => {
  await request.post('/e2e/reset');
  // These specs exercise every slot (forms included); pin the goal scope to
  // "Everything" — the dedicated goal-scope spec covers the other scopes.
  await page.addInitScript(() => localStorage.setItem('livingdex-goal-scope', 'all'));
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
  await openFilters(page);
  await page.locator('.gen-chips button[data-gen="6"]').click();
  await closeFilters(page);
  await expect(page.locator('#region')).toHaveText('Kalos');
  await expect(page.locator(gridButton)).toHaveCount(1);
  const vivillon = page.locator(`${gridButton}[data-entry-key="0666-fancy-female"]`);
  await expect(vivillon).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#caught')).toHaveText('1');
  await expect(page.locator('#pct')).toHaveText('100%');
});

test('ALL generations chip shows the whole national dex and searches across gens', async ({ page }) => {
  await openFilters(page);
  await page.locator('.gen-chips button[data-gen="0"]').click();
  await closeFilters(page);
  await expect(page.locator('#region')).toHaveText('National');
  // every seeded slot at once: 3 Gen I + 4 Gen IV + 1 Gen VI
  await expect(page.locator(gridButton)).toHaveCount(8);
  await expect(page.locator('#total')).toHaveText('/ 8');

  // search now spans the whole dex — no gen hopping to find a name
  await page.locator('#search').fill('vivillon');
  await expect(page.locator(gridButton)).toHaveCount(1);
  await expect(page.locator(gridButton).first()).toHaveAttribute('data-entry-key', '0666-fancy-female');

  // the choice persists across reload
  await page.locator('#search').fill('');
  await page.reload();
  await expect(page.locator(gridButton).first()).toBeVisible();
  await expect(page.locator('#region')).toHaveText('National');
  await expect(page.locator(gridButton)).toHaveCount(8);
});

test('phone header: filter chrome collapses behind the Filters toggle', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'serina', 'phone-width behaviour only');
  // Collapsed is the default state on load.
  await expect(page.locator(gridButton).first()).toBeVisible();
  await expect(page.locator('#gen-chips')).toBeHidden();
  await expect(page.locator('#type-chips')).toBeHidden();
  await expect(page.locator('#games-btn')).toBeHidden();
  // search and the Planner stay one tap away
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#view-btn')).toBeVisible();

  const toggle = page.locator('#filters-btn');
  await toggle.click();
  await expect(page.locator('#gen-chips')).toBeVisible();
  await expect(page.locator('#games-btn')).toBeVisible();

  // expanded, the header scrolls its own overflow (capped to the viewport)
  // instead of letting swipes scroll the dex behind it
  const headerScroll = await page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    if (!bar) return null;
    const cs = getComputedStyle(bar);
    return { overflowY: cs.overflowY, capped: bar.getBoundingClientRect().height <= window.innerHeight + 1 };
  });
  expect(headerScroll).toEqual({ overflowY: 'auto', capped: true });

  // active filters are surfaced on the collapsed toggle
  await page.locator('.type-row button[data-type="fire"]').click();
  await toggle.click();
  await expect(page.locator('#gen-chips')).toBeHidden();
  await expect(toggle).toHaveText('Filters · 1');
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
  await openFilters(page);
  await page.locator('.status-chips button[data-status="needed"]').click();
  await expect(page.locator(gridButton)).toHaveCount(3);

  // catch one, then Caught shows exactly it
  await page.locator('.status-chips button[data-status="all"]').click();
  await closeFilters(page);
  await page.locator(`${gridButton}[data-entry-key="0150-default-genderless"]`).click();
  await openFilters(page);
  await page.locator('.status-chips button[data-status="caught"]').click();
  await expect(page.locator(gridButton)).toHaveCount(1);
  await expect(page.locator(gridButton).first()).toHaveAttribute('data-entry-key', '0150-default-genderless');

  // a search with no matches shows the empty state; its action clears filters
  // INCLUDING the pinned generation (gen resets to ALL: 3 + 4 + 1 = 8 slots)
  await page.locator('.status-chips button[data-status="all"]').click();
  await closeFilters(page);
  await page.locator('#search').fill('zzzzz');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#empty-action').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#region')).toHaveText('National');
  await expect(page.locator(gridButton)).toHaveCount(8);
});

test('a typed query searches the whole national dex, not just the pinned gen', async ({ page }) => {
  // Default view is Gen I — Vivillon is Gen VI, but search must still find it.
  await expect(page.locator('#region')).toHaveText('Kanto');
  await page.locator('#search').fill('vivillon');
  await expect(page.locator(gridButton)).toHaveCount(1);
  await expect(page.locator(gridButton).first()).toHaveAttribute('data-entry-key', '0666-fancy-female');
  await expect(page.locator('#result-label')).toContainText('SEARCHING ALL GENS');
  // clearing the query restores the gen scope
  await page.locator('#search').fill('');
  await expect(page.locator(gridButton)).toHaveCount(3);
  await expect(page.locator('#result-label')).not.toContainText('SEARCHING ALL GENS');
});

test('tile toggle shows an Undo toast, and Needed keeps the tile in place', async ({ page }) => {
  const charizard = page.locator(`${gridButton}[data-entry-key="0006-default-male"]`);

  // Under "Needed", catching must NOT reflow the grid under your finger.
  await openFilters(page);
  await page.locator('.status-chips button[data-status="needed"]').click();
  await closeFilters(page);
  await expect(page.locator(gridButton)).toHaveCount(3);
  await charizard.click();
  await expect(charizard).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(gridButton)).toHaveCount(3); // still in place, restyled

  // Undo restores the previous state from the toast.
  const undo = page.locator('.toast .toast-action');
  await expect(undo).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Charizard ♂ — marked caught');
  await undo.click();
  await expect(charizard).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#caught')).toHaveText('0');

  // The next explicit render reconciles membership: catch again, switch filter.
  await charizard.click();
  await openFilters(page);
  await page.locator('.status-chips button[data-status="all"]').click();
  await page.locator('.status-chips button[data-status="needed"]').click();
  await closeFilters(page);
  await expect(page.locator(gridButton)).toHaveCount(2); // now it's gone from Needed
});

test('the active view survives a reload (planner stays planner)', async ({ page }) => {
  await page.locator('#view-btn').click();
  await expect(page.locator('#planner')).toBeVisible();
  await page.reload();
  await expect(page.locator('#planner')).toBeVisible();
  await expect(page.locator('#view-btn')).toHaveText('← Dex');
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
  await openFilters(page); // theme button lives behind the phone Filters toggle
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
  await openFilters(page); // mirror button lives behind the phone Filters toggle
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
  await openFilters(page);
  await page.locator('.gen-chips button[data-gen="6"]').click();
  await closeFilters(page);
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
  await openFilters(page);
  await expect(page.locator('#obtain-row')).toBeVisible();
  await expect(page.locator('#obtain-chips button[data-obtain="gmax"]')).toBeVisible();
  await closeFilters(page);

  // the Charizard detail sheet shows the Obtainability zone with its game + GMAX badge
  const cz = `${gridButton}[data-entry-key="0006-default-male"]`;
  await page.locator(`${cz} ~ .tile-info`).click();
  const obtain = page.locator('.sheet-section.obtain');
  await expect(obtain).toBeVisible();
  await expect(obtain).toContainText('OBTAINABILITY');
  await expect(obtain).toContainText("Let's Go");
  await expect(obtain).toContainText('GMAX');
  // Charizard is available in Let's Go (Switch → HOME-native), so the route line shows it
  await expect(obtain).toContainText('TO POKÉMON HOME');
  await expect(obtain).toContainText('HOME-NATIVE');
});

test('obtainability filter hides known non-matches but keeps entries with unknown data', async ({ page }) => {
  // Gen I harness: Charizard default is Switch-catchable (known true); mega_x is
  // not (known false); Mewtwo has no obtainability at all (unknown). The Switch
  // filter must hide the known-false one but keep the unknown one — we never
  // hide on a guess.
  await expect(page.locator(gridButton)).toHaveCount(3);
  await openFilters(page);
  await page.locator('#obtain-chips button[data-obtain="switch"]').click();
  await closeFilters(page);
  await expect(page.locator(gridButton)).toHaveCount(2);
  await expect(page.locator(`${gridButton}[data-entry-key="0006-default-male"]`)).toBeVisible();   // known true → kept
  await expect(page.locator(`${gridButton}[data-entry-key="0006-mega_x-male"]`)).toHaveCount(0);   // known false → hidden
  await expect(page.locator(`${gridButton}[data-entry-key="0150-default-genderless"]`)).toBeVisible(); // unknown → kept
});

test('My Games: owning a game marks its availability and enables the "owned" filter', async ({ page }) => {
  // Charizard (default) is obtainable in Let's Go (version-group lgpe); mega_x
  // only in Red/Blue (rb); Mewtwo has no obtainability. Owning the Let's Go
  // Pikachu release (versionGroup lgpe) should flag Charizard's chip, reveal the
  // "In a game I own" filter, and (with the filter on) keep Charizard + the
  // unknown Mewtwo while hiding the known-non-match mega_x.
  await openFilters(page); // My Games lives behind the phone Filters toggle
  await page.locator('#games-btn').click();
  const modal = page.locator('.games-panel');
  await expect(modal).toBeVisible();

  // Pokémon GO (mobile) shows only the single "Playing" (digital) toggle — no cart/emu/romhack
  await expect(modal.locator('.game-row[data-game-id="go"] button[data-method="digital"]')).toBeVisible();
  await expect(modal.locator('.game-row[data-game-id="go"] button[data-method="cartridge"]')).toHaveCount(0);

  await modal.locator('button[data-game-id="lets-go-pikachu"][data-method="cartridge"]').click();
  await expect(modal.locator('button[data-game-id="lets-go-pikachu"][data-method="cartridge"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  // the owned filter appears now that a game is owned
  const ownedFilter = page.locator('#obtain-chips button[data-obtain="owned"]');
  await expect(ownedFilter).toBeVisible();
  await closeFilters(page);

  // Charizard's detail sheet marks the Let's Go chip as owned
  await page.locator(`${gridButton}[data-entry-key="0006-default-male"] ~ .tile-info`).click();
  await expect(page.locator('.sheet-section.obtain')).toContainText('✓ OWNED');
  await page.keyboard.press('Escape');

  // the owned filter keeps known-match + unknown, hides the known non-match
  await openFilters(page);
  await ownedFilter.click();
  await closeFilters(page);
  await expect(page.locator(`${gridButton}[data-entry-key="0006-default-male"]`)).toBeVisible();       // owned lets-go → kept
  await expect(page.locator(`${gridButton}[data-entry-key="0006-mega_x-male"]`)).toHaveCount(0);        // only rb → hidden
  await expect(page.locator(`${gridButton}[data-entry-key="0150-default-genderless"]`)).toBeVisible();  // unknown → kept

  // ownership is server-backed: it survives a reload
  await page.reload();
  await expect(page.locator(gridButton).first()).toBeVisible();
  await openFilters(page);
  await page.locator('#games-btn').click();
  await expect(page.locator('.games-panel button[data-game-id="lets-go-pikachu"][data-method="cartridge"]')).toHaveAttribute('aria-pressed', 'true');
});

test('planner: verdicts + acquisitions, and owning a game flips a species to Ready', async ({ page }) => {
  // Harness obtainability: Charizard default → Let's Go (lgpe, HOME-native);
  // mega_x → Red/Blue (rb, via Bank); Vivillon is caught; Mewtwo has no data.
  // Open the phone filter panel first: #games-btn (needed mid-spec) is only
  // reachable while it's open, and the panel chrome hides in planner view.
  await openFilters(page);
  await page.locator('#view-btn').click();
  const planner = page.locator('#planner');
  await expect(planner).toBeVisible();
  await expect(planner).toContainText('LIVING-DEX PLANNER');
  await expect(planner).toContainText('COMPLETION PLAN');

  // itinerary: Let's Go (lgpe) is a catch stop for Charizard default; default mode
  // is emu-first and it's unowned, so the stop is tagged EMULATE.
  const lgpeStep = planner.locator('.acq-step[data-id="lgpe"]');
  await expect(lgpeStep).toBeVisible();
  await expect(lgpeStep).toContainText("Let's Go");
  await expect(lgpeStep).toContainText('EMULATE');

  // tapping the stop shows exactly what to catch there (Charizard default)
  await lgpeStep.click();
  await expect(planner).toContainText("CATCH IN LET'S GO");
  await expect(planner.locator('.planner-row[data-entry-key="0006-default-male"]')).toBeVisible();

  // switching to Cartridge-only re-labels the unowned stop as a cartridge buy
  await planner.locator('.acquire button[data-mode="cartridge-only"]').click();
  await expect(planner.locator('.acq-step[data-id="lgpe"]')).toContainText('BUY CART');

  // My Games: Bank is a service (Active toggle, no cartridge); own Let's Go Pikachu
  await page.locator('#games-btn').click();
  const modal = page.locator('.games-panel');
  await expect(modal.locator('.game-row[data-game-id="bank"] button[data-method="subscription"]')).toBeVisible();
  await expect(modal.locator('.game-row[data-game-id="bank"] button[data-method="cartridge"]')).toHaveCount(0);
  await modal.locator('button[data-game-id="lets-go-pikachu"][data-method="cartridge"]').click();
  await page.keyboard.press('Escape');

  // Now you own Let's Go → it stays as a stop but flips to OWN (still where you
  // catch it). Ready = Charizard + both Turtwig slots (all reachable via lgpe).
  await expect(planner.locator('.acq-step[data-id="lgpe"]')).toContainText('OWN');
  await expect(planner.locator('.plan-tile[data-verdict="ready"]')).toContainText('3');

  // back to the dex
  await page.locator('#view-btn').click();
  await expect(page.locator(gridButton).first()).toBeVisible();
});

test('goal scope drives the plan only; the dex has its own VIEW consolidation', async ({ page }) => {
  // Everything (pinned by beforeEach): Gen I shows all 3 slots.
  await expect(page.locator(gridButton)).toHaveCount(3);

  await page.locator('#view-btn').click();
  const planner = page.locator('#planner');
  await expect(planner.locator('button[data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(planner.locator('[data-role="goal-progress"]')).toContainText('EVERYTHING');

  // Switch the GOAL to Phased → phase 1 is species (Mega X leaves the PLAN)…
  await planner.locator('button[data-scope="phased"]').click();
  await expect(planner.locator('[data-role="goal-progress"]')).toContainText('PHASE 1/3 — SPECIES');
  await expect(planner.locator('[data-role="goal-progress"]')).toContainText('1/5 caught'); // Vivillon, of 5 species

  // …but the DEX GRID is untouched: still every slot.
  await page.locator('#view-btn').click();
  await expect(page.locator(gridButton)).toHaveCount(3);
  await expect(page.locator('#total')).toHaveText('/ 3');

  // The dex's own VIEW chips consolidate the grid (display only).
  await page.locator('#view-chips button[data-view="species"]').click();
  await expect(page.locator(gridButton)).toHaveCount(2); // one Charizard tile, no mega_x
  await expect(page.locator(`${gridButton}[data-entry-key="0006-mega_x-male"]`)).toHaveCount(0);
  await expect(page.locator('#total')).toHaveText('/ 2');

  await page.locator('#view-chips button[data-view="all"]').click();
  await expect(page.locator(gridButton)).toHaveCount(3);
});

test('gender preference: Distinct only collapses identical pairs, keeps dimorphic ones', async ({ page }) => {
  // Gen IV fixture: Turtwig ♂/♀ (identical) + Hippopotas ♂/♀ (visually distinct).
  await openFilters(page);
  await page.locator('.gen-chips button[data-gen="4"]').click();
  await closeFilters(page);
  await expect(page.locator(gridButton)).toHaveCount(4);

  await page.locator('#gender-chips button[data-gender="distinct"]').click();
  await expect(page.locator(gridButton)).toHaveCount(3); // Turtwig collapses to one slot
  await expect(page.locator(`${gridButton}[data-entry-key="0387-default-female"]`)).toHaveCount(0);
  await expect(page.locator(`${gridButton}[data-entry-key="0449-default-male"]`)).toBeVisible();
  await expect(page.locator(`${gridButton}[data-entry-key="0449-default-female"]`)).toBeVisible();
  await expect(page.locator('#total')).toHaveText('/ 3');

  // The preference is shared with the planner goal: 8 slots → 7.
  await page.locator('#view-btn').click();
  const planner = page.locator('#planner');
  await expect(planner.locator('button[data-gender="distinct"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(planner.locator('[data-role="goal-progress"]')).toContainText('1/7 caught');
  await planner.locator('button[data-gender="all"]').click();
  await expect(planner.locator('[data-role="goal-progress"]')).toContainText('1/8 caught');
});

test('companion checklist: how/where lines, also-catchable extras, quick tick-off', async ({ page }) => {
  await page.locator('#view-btn').click();
  const planner = page.locator('#planner');

  // Tap the Let's Go stop → checklist: 1 planned (Charizard) + 2 more possible (Turtwig ♂/♀).
  await planner.locator('.acq-step[data-id="lgpe"]').click();
  await expect(planner).toContainText("CATCH IN LET'S GO — 1 PLANNED · 2 MORE POSSIBLE");
  const charRow = planner.locator('.planner-row[data-entry-key="0006-default-male"]');
  await expect(charRow.locator('.row-how')).toContainText('wild — Route 21, Pallet Town');

  // Default layout is the hunt route: grouped by primary zone, planned and
  // opportunistic merged, catch-all buckets sunk to the end.
  await expect(planner.locator('button[data-group="zones"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(planner.locator('.zone-head').first()).toHaveText('ROUTE 21 (1)');
  await expect(planner.locator('.zone-head').last()).toHaveText('⚡ EVOLVE OR BREED (2)');
  // The Turtwig pair is planned for SV — here it carries the ALSO pill.
  await expect(planner.locator('.planner-row[data-entry-key="0387-default-male"] .row-also')).toBeVisible();
  await expect(charRow.locator('.row-also')).toHaveCount(0); // planned here, no pill

  // BY DEX keeps the classic two-section layout.
  await planner.locator('button[data-group="dex"]').click();
  await expect(planner.locator('.zone-head')).toHaveCount(0);
  await expect(planner.locator('[data-role="also-here"]')).toContainText('ALSO CATCHABLE HERE (2)');
  // Turtwig has no confirmed catch method here → the evolve hint + trade flag shows.
  await expect(planner.locator('.planner-row[data-entry-key="0387-default-male"] .row-how')).toContainText('evolve from Tradevo · TRADE EVO');
  // Back to zones for the rest of the flow (and to leave the default persisted).
  await planner.locator('button[data-group="zones"]').click();
  await expect(planner.locator('.zone-head').first()).toBeVisible();

  // Quick tick-off: mark Charizard caught from the row — no sheet needed.
  await charRow.locator('.row-tick').click();
  await expect(charRow.locator('.row-tick')).toHaveText('◉');

  // A session catch is in transit: it lands in the TRANSFER BACKLOG under its game.
  const backlog = planner.locator('.backlog');
  await expect(backlog).toContainText('TRANSFER BACKLOG — 1 caught, not yet in HOME');
  await expect(backlog.locator('.backlog-group')).toContainText('Let’s Go — 1 waiting');
  await expect(backlog.locator('.backlog-group')).toContainText('→ HOME'); // the route reminder

  // The catch recorded the game as its origin, and the sheet shows the transit
  // state with a toggle.
  await charRow.click();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await expect(page.locator('.sheet-panel input[list="dex-game-suggestions"]')).toHaveValue('Let’s Go'); // gameLabel() uses the curly apostrophe
  await expect(page.locator('.sheet-panel .home-toggle')).toContainText('not in HOME');
  await page.keyboard.press('Escape');

  // Bulk "Mark transferred" clears the backlog.
  await backlog.locator('.backlog-done').click();
  await expect(planner.locator('.backlog')).toHaveCount(0);

  // The detail sheet also carries the evolve-from hint.
  await planner.locator('.planner-row[data-entry-key="0387-default-male"]').click();
  await expect(page.locator('.sheet-panel .evolve-from')).toContainText('Tradevo');
  await expect(page.locator('.sheet-panel .evolve-from')).toContainText('trade evolution');
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
