/**
 * Playwright global setup: prebuild Playground snapshot
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Build (and cache) the WordPress Playground snapshot before any tests run.
 *   If snapshot creation fails, abort the entire run early with a clear error.
 *
 * Inputs (env vars):
 *   - PLUGIN_META_JSON (required): JSON string containing at least { slug }.
 *   - E2E_AUTO_MOUNT (optional): host path to mount the plugin folder from.
 *     If omitted, defaults to ./zipfile/<slug> (GitHub Actions layout).
 *
 * Behavior:
 *   - Computes the snapshot cache key using the same inputs as the worker fixture.
 *   - Ensures snapshot zip is built and extracted into the cache directory.
 *   - Writes a small marker file into the cache dir on success.
 *
 * Failure modes:
 *   - Throws with context (cacheDir, pluginAutoMount) so Playwright stops before tests.
 */

import type { FullConfig } from "@playwright/test";
import { runCLI } from "@wp-playground/cli";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import unzipper from "unzipper";

export default async function globalSetup(_config: FullConfig) {
  const requireForShared = createRequire(import.meta.url);
  const {
    BlueprintBuilder,
    applyKrokedilBlueprintTemplate,
    computeSnapshotCacheKey,
    ensureSnapshotExtracted,
  } = requireForShared("../../../scripts/lib/playground/index.js") as any;
  const { loadMeta, getOptionalString } = requireForShared(
    "../../../scripts/lib/plugin-meta.js",
  ) as any;

  // ---------------------------------------------------------------------------
  // Inputs: plugin meta (must include slug)
  // ---------------------------------------------------------------------------
  const META = loadMeta({ requireEnv: true });
  const pluginSlug = getOptionalString(META, "slug") || "";
  if (!pluginSlug) {
    throw new Error("PLUGIN_META_JSON.slug is required for e2e tests");
  }

  const pluginName = getOptionalString(META, "name");
  const blogname = pluginName ? `${pluginName} dev zip` : "Plugin dev zip";

  const pluginAutoMount =
    process.env.E2E_AUTO_MOUNT || `./zipfile/${pluginSlug}`;

  // ---------------------------------------------------------------------------
  // Snapshot blueprint (must stay aligned with end-to-end/fixtures.ts)
  // ---------------------------------------------------------------------------
  const snapshotBlueprintVariables: Record<string, any> = {
    blogname,
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

  // ---------------------------------------------------------------------------
  // Snapshot cache (zip + extracted wordpress template)
  // ---------------------------------------------------------------------------
  const cacheKey = computeSnapshotCacheKey({
    pluginSlug,
    snapshotBlueprintJson,
    pluginDir: resolve(pluginAutoMount),
  });

  const cacheDir = resolve("./playground-snapshots", cacheKey);
  mkdirSync(cacheDir, { recursive: true });

  // Keep a copy for debugging/repro.
  writeFileSync(
    resolve(cacheDir, "snapshot-blueprint.json"),
    snapshotBlueprintJson,
  );

  const unzip = async ({
    zipPath,
    outDir,
  }: {
    zipPath: string;
    outDir: string;
  }) => {
    await createReadStream(zipPath)
      .pipe((unzipper as any).Extract({ path: outDir }))
      .promise();
  };

  try {
    await ensureSnapshotExtracted({
      cacheDir,
      pluginAutoMount,
      snapshotBlueprint: snapshotBuilder.blueprint,
      buildSnapshotZip: async ({ outfile, blueprint }: any) => {
        try {
          await runCLI({
            command: "build-snapshot",
            outfile,
            blueprint,
            autoMount: pluginAutoMount,
            quiet: true,
          });
        } catch (error) {
          // runCLI sometimes throws due to a Playground issue (process.exit(0)).
          // Only ignore the error if the expected output file exists.
          if (!existsSync(outfile)) {
            throw error;
          }
        }
      },
      unzip,
    });

    // Simple, human-friendly success marker (useful when debugging CI caches).
    writeFileSync(
      resolve(cacheDir, "global-setup.ok.json"),
      JSON.stringify(
        {
          ok: true,
          at: new Date().toISOString(),
          cacheDir,
          cacheKey,
          pluginSlug,
          pluginAutoMount,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new Error(
      "E2E snapshot prebuild failed; aborting Playwright run. " +
        `cacheDir=${cacheDir} pluginAutoMount=${pluginAutoMount}`,
      { cause: err },
    );
  }
}
