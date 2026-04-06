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
import { readPluginSlugFromEnvOrFile } from "./helpers/plugin-meta.js";

const pluginSlug = readPluginSlugFromEnvOrFile();

test.describe("With WooCommerce", () => {
  test("Plugin active in admin", async ({ page, playground }, testInfo) => {
    const baseUrl: string = playground.cliServer.serverUrl;

    await page.goto(
      new URL("/wp-admin/plugins.php?plugin_status=active", baseUrl).toString(),
    );

    // WordPress uses data-slug on plugin rows; more reliable than name matching.
    // Use .first() because WordPress may add a second row with the same data-slug
    // for update notifications.
    const pluginRow = page
      .locator(`tr[data-slug="${playground.pluginSlug}"]`)
      .first();
    await expect(pluginRow).toBeVisible();
    await expect(pluginRow).toHaveClass(/(^|\s)active(\s|$)/);

    const pluginsActivePng = await page.screenshot({
      path: testInfo.outputPath("plugins-active.png"),
    });
    await testInfo.attach("plugins-active.png", {
      body: pluginsActivePng,
      contentType: "image/png",
    });
  });

  test("Plugin meta-defined pages works", async ({
    page,
    playground,
  }, testInfo) => {
    test.skip(
      !playground.metaE2EPages || playground.metaE2EPages.length === 0,
      "No pluginDevZipE2e.pages configured in PLUGIN_META_JSON",
    );

    const baseUrl: string = playground.cliServer.serverUrl;

    for (const [index, metaPage] of playground.metaE2EPages.entries()) {
      await page.goto(new URL(metaPage.url, baseUrl).toString(), {
        waitUntil: "networkidle",
      });

      for (const assertion of metaPage.assertions || []) {
        const matchType = assertion.match === "equals" ? "equals" : "contains";
        const label = `Assert "${assertion.selector}" ${matchType} "${assertion.text ?? "(visible only)"}"`;

        await test.step(label, async () => {
          const locator = page.locator(assertion.selector);
          // WooCommerce admin pages may render content via React after initial
          // page load. Use a longer timeout so Playwright keeps polling while
          // JS frameworks hydrate and fetch data.
          await expect(locator).toBeVisible({ timeout: 30_000 });

          if (typeof assertion.text === "string") {
            if (assertion.match === "equals") {
              await expect(locator).toHaveText(assertion.text);
            } else {
              await expect(locator).toContainText(assertion.text);
            }
          }
        });
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

test.describe("Without WooCommerce", () => {
  test.use({
    serverBlueprintVarsOverrides: {
      custom_wp_cli_command: `wp plugin deactivate --all --skip-plugins --skip-themes && wp plugin activate ${pluginSlug}`,
    },
  });

  test("Plugin works without WooCommerce", async ({
    page,
    playground,
  }, testInfo) => {
    const baseUrl: string = playground.cliServer.serverUrl;

    const requiresWooCommerce = playground.requiresPlugins
      .map((s) => s.toLowerCase())
      .includes("woocommerce");

    if (requiresWooCommerce) {
      await page.goto(
        new URL(
          "/wp-admin/plugins.php?plugin_status=inactive",
          baseUrl,
        ).toString(),
      );
      const pluginRow = page
        .locator(`tr[data-slug="${playground.pluginSlug}"]`)
        .first();
      await expect(pluginRow).toBeVisible();
      await expect(pluginRow).toHaveClass(/(^|\s)inactive(\s|$)/);
    } else {
      await page.goto(
        new URL(
          "/wp-admin/plugins.php?plugin_status=active",
          baseUrl,
        ).toString(),
      );
      const pluginRow = page
        .locator(`tr[data-slug="${playground.pluginSlug}"]`)
        .first();
      await expect(pluginRow).toBeVisible();
      await expect(pluginRow).toHaveClass(/(^|\s)active(\s|$)/);
    }

    const withoutWooPng = await page.screenshot({
      path: testInfo.outputPath("without-woocommerce.png"),
    });
    await testInfo.attach("without-woocommerce.png", {
      body: withoutWooPng,
      contentType: "image/png",
    });
  });
});
