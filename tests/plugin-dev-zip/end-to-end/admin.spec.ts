/**
 * Playwright e2e: plugin dev zip verification
 * ---------------------------------------------------------------------------
 * What this tests:
 *   - The plugin is activated in wp-admin
 *   - Optional, meta-defined pages render expected UI elements
 *
 * Inputs / fixtures:
 *   - PLUGIN_META_JSON (env var): plugin meta contract used across this repo
 *   - E2E_AUTO_MOUNT (env var): local fixture mount path (see tests/plugin-dev-zip/package.json)
 *   - `playground` fixture from end-to-end/fixtures.ts
 */

import { test, expect } from "./fixtures.js";

test.describe("Plugin dev zip e2e", () => {
  test("Plugin active in admin", async ({ page, playground }, testInfo) => {
    const baseUrl: string = playground.cliServer.serverUrl;

    await page.goto(
      new URL("/wp-admin/plugins.php?plugin_status=active", baseUrl).toString(),
    );

    // WordPress uses data-slug on plugin rows; more reliable than name matching.
    const pluginRow = page.locator(`tr[data-slug="${playground.pluginSlug}"]`);
    await expect(pluginRow).toBeVisible();
    await expect(pluginRow).toHaveClass(/active/);

    const pluginsActivePng = await page.screenshot({
      path: testInfo.outputPath("plugins-active.png"),
    });
    await testInfo.attach("plugins-active.png", {
      body: pluginsActivePng,
      contentType: "image/png",
    });
  });

  test("Meta-defined pages", async ({ page, playground }, testInfo) => {
    test.skip(
      !playground.metaE2EPages || playground.metaE2EPages.length === 0,
      "No pluginDevZipE2e.pages configured in PLUGIN_META_JSON",
    );

    const baseUrl: string = playground.cliServer.serverUrl;

    for (const [index, metaPage] of playground.metaE2EPages.entries()) {
      await page.goto(new URL(metaPage.url, baseUrl).toString());

      for (const assertion of metaPage.assertions || []) {
        const locator = page.locator(assertion.selector);
        await expect(locator).toBeVisible();

        if (typeof assertion.text === "string") {
          if (assertion.match === "equals") {
            await expect(locator).toHaveText(assertion.text);
          } else {
            await expect(locator).toContainText(assertion.text);
          }
        }
      }

      const metaPng = await page.screenshot({
        path: testInfo.outputPath(`meta-page-${index + 1}.png`),
      });
      await testInfo.attach(`meta-page-${index + 1}.png`, {
        body: metaPng,
        contentType: "image/png",
      });
    }
  });
});
