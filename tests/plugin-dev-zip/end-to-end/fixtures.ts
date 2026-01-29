/**
 * Playwright e2e fixtures: WordPress Playground harness
 * ---------------------------------------------------------------------------
 * What this file provides:
 *   1) A global `page` fixture that captures browser console + page errors and
 *      attaches them to the Playwright report.
 *   2) A `playground` fixture that:
 *        - Reads plugin metadata (PLUGIN_META_JSON)
 *        - Uses a cached WordPress Playground snapshot prepared in globalSetup
 *        - Starts a per-test Playground server mounted with:
 *            * per-test logs dir (uploads/krokedil-wp-ci)
 *            * plugin under test (E2E_AUTO_MOUNT)
 *        - Attaches useful artifacts (debug.log, WooCommerce logs, system report)
 *
 * Why this exists:
 *   - Keep spec files (e.g. plugin-dev-zip-e2e.spec.ts) focused on assertions.
 *   - Centralize snapshot/server lifecycle + logging so multiple specs can reuse it.
 *
 * Inputs (env vars):
 *   - PLUGIN_META_JSON (required): JSON string containing at least { slug }.
 *   - E2E_AUTO_MOUNT (optional): host path to mount the plugin folder from.
 *     If omitted, defaults to ./zipfile/<slug> (GitHub Actions layout).
 *
 * Internal env vars:
 *   - KROKEDIL_E2E_PER_TEST_LOGS_DIR: set by the `playground` fixture so the
 *     console-capture fixture can also write browser-console.log next to debug.log.
 *
 * Failure modes / debugging:
 *   - Playground startup/snapshot failures surface as fixture setup failures.
 *   - When that happens, check attached artifacts + the per-test log folder.
 */

import { test as base, expect } from "@playwright/test";
import {
  mkdirSync,
} from "node:fs";
import { attachEndOfTestArtifacts } from "./helpers/artifacts.js";
import { runConsoleCapture } from "./helpers/console-capture.js";
import { buildPerTestLogsDir } from "./helpers/paths.js";
import {
  persistSnapshotBlueprint,
  preparePerTestSnapshot,
} from "./helpers/per-test-snapshot.js";
import {
  buildEffectiveServerBlueprintVars,
  buildServerBlueprintJson,
  createEnsureWcReport,
  persistServerBlueprintJson,
  startPlaygroundServer,
} from "./helpers/server.js";
import { startStdIoCapture } from "./helpers/stdio-capture.js";
import {
  buildPlaygroundWorkerContext,
  type PlaygroundWorkerContext,
} from "./helpers/worker-context.js";
import type { MetaE2EPage } from "./helpers/types.js";
export type { MetaE2EPage } from "./helpers/types.js";

// ---------------------------------------------------------------------------
// Console capture (global)
// ---------------------------------------------------------------------------

const testBase = base.extend({
  page: async ({ page }, use, testInfo) => {
    await runConsoleCapture({ page, testInfo, use });
  },
});

export { expect };

// ---------------------------------------------------------------------------
// Playground harness fixture
// ---------------------------------------------------------------------------

/**
 * The plugin-meta contract can optionally define pages + selectors to check.
 * This keeps assertions in spec files minimal and data-driven.
 */

export type PlaygroundTestContext = {
  cliServer: any;
  pluginSlug: string;
  requiresPlugins: string[];
  perTestLogsDir: string;
  metaE2EPages: MetaE2EPage[];
  blueprints: {
    snapshotJson: string;
    serverJson: string;
  };
  ensureWcReport: () => Promise<string>;
};

const DEFAULT_SERVER_BLUEPRINT_VARS: Record<string, any> = {
  configure_debug_logs: true,
  generate_site_health_report: true,
  generate_wc_status_report: true,
};

export const test = testBase.extend<
  {
    playground: PlaygroundTestContext;
    serverBlueprintVars: Record<string, any>;
    serverBlueprintVarsOverrides: Record<string, any>;
  },
  {
    playgroundWorker: PlaygroundWorkerContext;
  }
>({
  serverBlueprintVars: [{}, { option: true }],
  serverBlueprintVarsOverrides: [{}, { option: true }],

  playgroundWorker: [
    async ({}, use) => {
      await use(await buildPlaygroundWorkerContext());
    },
    { scope: "worker" },
  ],

  playground: async (
    { playgroundWorker, serverBlueprintVars, serverBlueprintVarsOverrides },
    use,
    testInfo,
  ) => {
    const {
      pluginSlug,
      pluginNameForReport,
      requiresPlugins,
      metaE2EPages,
      pluginAutoMount,
      snapshotBlueprintJson,
      snapshotWordpressTemplateDir,
    } = playgroundWorker;

    const perTestLogsDir = buildPerTestLogsDir({
      projectName: testInfo.project.name,
      testTitle: testInfo.title,
      retry: testInfo.retry,
    });
    mkdirSync(perTestLogsDir, { recursive: true });

    // Let the console-capture fixture also persist browser-console.log next to
    // debug.log and other Playground artifacts.
    process.env.KROKEDIL_E2E_PER_TEST_LOGS_DIR = perTestLogsDir;

    const stopStdIoCapture = startStdIoCapture({ perTestLogsDir, testInfo });

    // Persist and attach blueprints.
    persistSnapshotBlueprint({
      perTestLogsDir,
      snapshotBlueprintJson,
    });
    await testInfo.attach("snapshot-blueprint.json", {
      body: snapshotBlueprintJson,
      contentType: "application/json",
    });

    const { perTestWordpressDir } = preparePerTestSnapshot({
      perTestLogsDir,
      snapshotWordpressTemplateDir,
    });

    // ---------------------------------------------------------------------
    // Start server
    // ---------------------------------------------------------------------
    const effectiveServerBlueprintVars = buildEffectiveServerBlueprintVars({
      defaultVars: DEFAULT_SERVER_BLUEPRINT_VARS,
      serverBlueprintVars,
      serverBlueprintVarsOverrides,
      projectPhpVersion:
        testInfo?.project?.metadata &&
        typeof (testInfo.project.metadata as any).phpVersion === "string"
          ? (testInfo.project.metadata as any).phpVersion
          : undefined,
    });

    const { blueprint: serverBlueprint, json: serverBlueprintJson } =
      await buildServerBlueprintJson({
        effectiveServerBlueprintVars,
      });

    persistServerBlueprintJson({
      perTestLogsDir,
      serverBlueprintJson,
    });
    await testInfo.attach("server-blueprint.json", {
      body: serverBlueprintJson,
      contentType: "application/json",
    });

    const projectPhpVersion =
      testInfo?.project?.metadata &&
      typeof (testInfo.project.metadata as any).phpVersion === "string"
        ? (testInfo.project.metadata as any).phpVersion
        : undefined;

    const cliServer = await startPlaygroundServer({
      perTestWordpressDir,
      perTestLogsDir,
      serverBlueprint,
      projectPhpVersion,
    });

    const ensureWcReport = createEnsureWcReport({
      perTestLogsDir,
      generateWcStatusReportEnabled:
        !!effectiveServerBlueprintVars.generate_wc_status_report,
    });

    try {
      await use({
        cliServer,
        pluginSlug,
        requiresPlugins,
        perTestLogsDir,
        metaE2EPages,
        blueprints: {
          snapshotJson: snapshotBlueprintJson,
          serverJson: serverBlueprintJson,
        },
        ensureWcReport,
      });
    } finally {
      try {
        if (cliServer?.server) await cliServer.server.close();
      } catch {
        // ignore
      }

      try {
        await stopStdIoCapture();
      } catch {
        // ignore
      }

      await attachEndOfTestArtifacts({
        testInfo,
        perTestLogsDir,
        pluginNameForReport,
      });
    }
  },
});
