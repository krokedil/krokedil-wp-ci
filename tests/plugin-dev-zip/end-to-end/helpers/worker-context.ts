/**
 * E2E Playground worker context
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Build a worker-scoped context used by the Playground test fixture.
 *
 * Inputs (environment variables):
 *   - PLUGIN_META_JSON (required): must include { slug } at minimum.
 *   - E2E_AUTO_MOUNT (optional): host path to mount the plugin folder from.
 *
 * Behavior:
 *   1) Reads plugin metadata and derives test settings.
 *   2) Builds the snapshot blueprint JSON and validates it.
 *   3) Computes snapshot cache key and verifies snapshot readiness.
 *
 * Failure modes:
 *   - Missing/invalid PLUGIN_META_JSON.slug throws.
 *   - Missing snapshot throws with guidance to run globalSetup.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MetaE2EAssertion, MetaE2EPage } from "./types.js";

export type PlaygroundWorkerContext = {
  pluginSlug: string;
  pluginNameForReport: string;
  blogname: string;
  requiresPlugins: string[];
  metaE2EPages: MetaE2EPage[];
  pluginAutoMount: string;
  snapshotBlueprintJson: string;
  snapshotBlueprint: any;
  snapshotWordpressTemplateDir: string;
};

export async function buildPlaygroundWorkerContext(): Promise<PlaygroundWorkerContext> {
  const requireForShared = createRequire(import.meta.url);
  const {
    BlueprintBuilder,
    applyKrokedilBlueprintTemplate,
    computeSnapshotCacheKey,
  } = requireForShared("../../../../scripts/lib/blueprint/index.js") as any;
  const {
    loadMeta,
    getOptionalString,
    getOptionalArray,
    getOptionalArrayOfObjects,
  } = requireForShared("../../../../scripts/lib/plugin-meta.js") as any;

  // ---------------------------------------------------------------------
  // Inputs: plugin meta (must include slug)
  // ---------------------------------------------------------------------
  const META = loadMeta({ requireEnv: true });

  const pluginSlug = getOptionalString(META, "slug") || "";
  if (!pluginSlug) {
    throw new Error("PLUGIN_META_JSON.slug is required for e2e tests");
  }

  const pluginName = getOptionalString(META, "name");
  const pluginNameForReport = pluginName || pluginSlug || "(unknown)";
  const blogname = pluginName ? `${pluginName} dev zip` : "Plugin dev zip";

  const requiresPlugins = (
    (getOptionalArray(META, "requiresPlugins") as unknown[]) || []
  )
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).trim())
    .filter(Boolean);

  const metaE2EPages: MetaE2EPage[] = [];
  const rawPages =
    getOptionalArrayOfObjects(META, "pluginDevZipE2e.pages") || [];
  for (const raw of rawPages) {
    const url = typeof raw.url === "string" ? raw.url : undefined;
    if (!url) continue;

    const assertions: MetaE2EAssertion[] = [];
    const rawAssertions = Array.isArray(raw.assertions) ? raw.assertions : [];
    for (const a of rawAssertions) {
      if (!a || typeof a !== "object") continue;
      const selector = typeof a.selector === "string" ? a.selector : undefined;
      if (!selector) continue;
      const text = typeof a.text === "string" ? a.text : undefined;
      const match = a.match === "equals" ? "equals" : "contains";
      assertions.push({ selector, text, match });
    }

    metaE2EPages.push({
      url,
      assertions: assertions.length ? assertions : undefined,
    });
  }

  // Mounting contract:
  // - Local runs: E2E_AUTO_MOUNT points to a plugin folder.
  // - GitHub Actions: prepared plugin is available under ./zipfile/<slug>.
  const pluginAutoMount =
    process.env.E2E_AUTO_MOUNT || `./zipfile/${pluginSlug}`;

  // ---------------------------------------------------------------------
  // Blueprints
  // ---------------------------------------------------------------------
  // We split blueprint responsibilities:
  // - snapshot blueprint: heavier, run once per worker and cached
  // - server blueprint: lighter, run per test against a fresh snapshot copy

  const snapshotBlueprintVariables: Record<string, any> = {
    blogname,
    plugin_blueprints: ["woocommerce", pluginSlug],
    reset_wordpress: true,
    install_storefront: true,
    configure_title_permalinks: true,
    install_woocommerce: true,
    install_wc_beta_tester: true,
    activate_plugin_slugs: pluginSlug,
  };

  const snapshotBuilder = new BlueprintBuilder(
    snapshotBlueprintVariables,
    applyKrokedilBlueprintTemplate,
  );

  await snapshotBuilder.assertValidWithSchema();
  const snapshotBlueprintJson =
    JSON.stringify(snapshotBuilder.blueprint, null, 2) + "\n";

  // ---------------------------------------------------------------------
  // Snapshot cache
  // ---------------------------------------------------------------------
  const cacheKey = computeSnapshotCacheKey({
    pluginSlug,
    snapshotBlueprintJson,
    pluginDir: resolve(pluginAutoMount),
  });
  const cacheDir = resolve("./playground-snapshots", cacheKey);

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    resolve(cacheDir, "snapshot-blueprint.json"),
    snapshotBlueprintJson,
  );

  // Snapshot is built in Playwright globalSetup. The worker fixture must never
  // attempt to rebuild, and must not delete/overwrite an existing snapshot.
  const snapshotDir = resolve(cacheDir, "snapshot");
  const wordpressDir = resolve(snapshotDir, "wordpress");
  const wpAdminDir = resolve(wordpressDir, "wp-admin");
  const wpConfigPath = resolve(wordpressDir, "wp-config.php");
  const globalSetupMarker = resolve(cacheDir, "global-setup.ok.json");

  const looksReady = existsSync(wpAdminDir) && existsSync(wpConfigPath);
  if (!looksReady) {
    throw new Error(
      "Snapshot is missing or incomplete, and snapshot rebuild is disabled during tests. " +
        "Expected Playwright globalSetup to build it first. " +
        `cacheDir=${cacheDir} ` +
        `globalSetupMarker=${existsSync(globalSetupMarker) ? "present" : "missing"}`,
    );
  }

  return {
    pluginSlug,
    pluginNameForReport,
    blogname,
    requiresPlugins,
    metaE2EPages,
    pluginAutoMount,
    snapshotBlueprintJson,
    snapshotBlueprint: snapshotBuilder.blueprint,
    snapshotWordpressTemplateDir: wordpressDir,
  };
}
