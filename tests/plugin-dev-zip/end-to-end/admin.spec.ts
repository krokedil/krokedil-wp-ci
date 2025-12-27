import { test, expect } from "@playwright/test";
import { runCLI } from "@wp-playground/cli";
import { resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";

// Increase timeout because blueprint setup can take a while
test.setTimeout(120_000);

test.describe("Workshop Tests", () => {
  let cliServer: any;

  test.beforeAll(async () => {
    // Generate blueprint file (shared source of truth under /scripts)
    const require = createRequire(import.meta.url);
    const { createPlaygroundE2EBlueprint } = require(
      "../../../scripts/lib/playground-blueprint.js"
    );

    const generatedDir = resolve("./.generated");
    mkdirSync(generatedDir, { recursive: true });

    const blueprintPath = resolve("./.generated/blueprint.json");
    const blueprintObj = createPlaygroundE2EBlueprint({
      uploadsDirVfs: "/wordpress/wp-content/uploads/krokedil-wp-ci",
    });
    writeFileSync(blueprintPath, JSON.stringify(blueprintObj, null, 2) + "\n");

    cliServer = await runCLI({
      command: "server",
      mount: [
        {
          hostPath: "./playground-temp-logs",
          vfsPath: "/wordpress/wp-content/uploads/krokedil-wp-ci",
        },
      ],
      autoMount: "./playground-temp-logs/klarna-checkout-for-woocommerce",
      blueprint: blueprintPath,
      quiet: false,
    });
  });

  test.afterAll(async () => {
    if (cliServer?.server) {
      await cliServer.server.close();
    }
  });

  test("Plugin active in admin", async ({ page }) => {
    const baseUrl: string = cliServer.serverUrl;
    const wpAdminUrl = new URL(
      "/wp-admin/plugins.php?plugin_status=active",
      baseUrl
    );

    await page.goto(wpAdminUrl.toString());

    await expect(
      page.getByText("Kustom Checkout for WooCommerce", { exact: true })
    ).toBeVisible();
  });

  test("Plugin settings page title visible", async ({ page }) => {
    const baseUrl: string = cliServer.serverUrl;
    const wpAdminUrl = new URL(
      "/wp-admin/admin.php?page=wc-settings&tab=checkout&section=kco&from=WCADMIN_PAYMENT_SETTINGS",
      baseUrl
    );

    await page.goto(wpAdminUrl.toString());

    await expect(
      page.getByRole("heading", { level: 2, name: "Kustom Checkout" })
    ).toBeVisible();
  });
});
