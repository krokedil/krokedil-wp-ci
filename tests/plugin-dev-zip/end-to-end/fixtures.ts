/**
 * Playwright e2e fixtures: WordPress Playground harness
 * ---------------------------------------------------------------------------
 * What this file provides:
 *   1) A global `page` fixture that captures browser console + page errors and
 *      attaches them to the Playwright report.
 *   2) A `playground` fixture that:
 *        - Reads plugin metadata (PLUGIN_META_JSON)
 *        - Builds (and caches) a WordPress Playground snapshot once per worker
 *        - Starts a per-test Playground server mounted with:
 *            * per-test logs dir (uploads/krokedil-wp-ci)
 *            * plugin under test (E2E_AUTO_MOUNT)
 *        - Attaches useful artifacts (debug.log, WooCommerce logs, system report)
 *
 * Why this exists:
 *   - Keep spec files (e.g. admin.spec.ts) focused on assertions.
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
import type { TestInfo } from "@playwright/test";
import { runCLI } from "@wp-playground/cli";
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { resolve } from "path";
import * as unzipper from "unzipper";

function formatLogLine(parts: {
  type: string;
  text: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
}): string {
  const ts = new Date().toISOString();
  const loc = parts.location?.url
    ? ` (${parts.location.url}:${parts.location.lineNumber ?? "?"}:${
        parts.location.columnNumber ?? "?"
      })`
    : "";
  return `${ts} [${parts.type}] ${parts.text}${loc}`;
}

// ---------------------------------------------------------------------------
// Console capture (global)
// ---------------------------------------------------------------------------

const testBase = base.extend({
  page: async ({ page }, use, testInfo) => {
    const logs: string[] = [];

    page.on("console", (msg) => {
      // Keep this log format stable; it becomes part of debugging evidence.
      logs.push(
        formatLogLine({
          type: msg.type(),
          text: msg.text(),
          location: msg.location(),
        }),
      );
    });

    page.on("pageerror", (err) => {
      logs.push(
        formatLogLine({
          type: "pageerror",
          text: err?.stack || String(err),
        }),
      );
    });

    await use(page);

    if (!logs.length) return;

    // Keep attachments reasonably bounded to avoid huge reports.
    const MAX_LINES = 3000;
    const text = logs.slice(-MAX_LINES).join("\n") + "\n";

    // Also persist to the per-test Playground logs dir (same folder as debug.log)
    // when the spec provides it.
    const perTestLogsDir = process.env.KROKEDIL_E2E_PER_TEST_LOGS_DIR;
    if (perTestLogsDir) {
      try {
        writeFileSync(resolve(perTestLogsDir, "browser-console.log"), text);
      } catch {
        // Ignore failures here; attaching to the report is the primary output.
      } finally {
        // Avoid leaking the path into subsequent tests in the same worker.
        delete process.env.KROKEDIL_E2E_PER_TEST_LOGS_DIR;
      }
    }

    await testInfo.attach("browser-console.log", {
      body: text,
      contentType: "text/plain",
    });
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

type MetaE2EAssertion = {
  selector: string;
  text?: string;
  match?: "contains" | "equals";
};

export type MetaE2EPage = {
  url: string;
  assertions?: MetaE2EAssertion[];
};

type PlaygroundWorkerContext = {
  pluginSlug: string;
  pluginNameForReport: string;
  blogname: string;
  metaE2EPages: MetaE2EPage[];
  pluginAutoMount: string;
  snapshotBlueprintJson: string;
  serverBlueprintJson: string;
  snapshotBlueprint: any;
  serverBlueprint: any;
  snapshotWordpressTemplateDir: string;
};

export type PlaygroundTestContext = {
  cliServer: any;
  pluginSlug: string;
  perTestLogsDir: string;
  metaE2EPages: MetaE2EPage[];
  blueprints: {
    snapshotJson: string;
    serverJson: string;
  };
  runPhp: (code: string) => Promise<void>;
  ensureWcReport: () => Promise<string>;
};

type UsedVersionsAnnotationResult = {
  annotation: {
    type: string;
    description: string;
  };
  usedVersions: unknown;
};

const SUITE_ID = "pluginDevZipE2e";

const RUN_ID = (() => {
  if (process.env.GITHUB_RUN_ID) {
    const attempt = process.env.GITHUB_RUN_ATTEMPT
      ? `-${process.env.GITHUB_RUN_ATTEMPT}`
      : "";
    return `gh-${process.env.GITHUB_RUN_ID}${attempt}-${SUITE_ID}`;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(16).slice(2, 6);
  return `local-${SUITE_ID}-${ts}-${rand}`;
})();

function toPathSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "unnamed-test";
}

/**
 * Capture Playwright worker stdio into per-test files.
 *
 * Why:
 *   Some failures happen during fixture setup (snapshot/server). Capturing
 *   stdout/stderr into the same per-test folder makes debugging much faster.
 *
 * Failure mode:
 *   Never throws; logging must not fail the test.
 */
function startStdIoCapture(options: {
  perTestLogsDir: string;
  testInfo: TestInfo;
}) {
  const { perTestLogsDir, testInfo } = options;

  const MAX_LOG_BYTES = 5_000_000;
  const stdoutPath = resolve(perTestLogsDir, "stdout.log");
  const stderrPath = resolve(perTestLogsDir, "stderr.log");

  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  const header =
    `\n[${new Date().toISOString()}] Capturing Playwright worker stdio` +
    `\n- title: ${testInfo.title}` +
    `\n- retry: ${testInfo.retry}` +
    `\n\n`;

  stdoutStream.write(header);
  stderrStream.write(header);

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  let stdoutBytes = 0;
  let stderrBytes = 0;

  (process.stdout as any).write = (chunk: any, encoding?: any, cb?: any) => {
    try {
      if (stdoutBytes < MAX_LOG_BYTES) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk), encoding || "utf8");
        stdoutBytes += buf.length;
        stdoutStream.write(buf);
        if (stdoutBytes >= MAX_LOG_BYTES) {
          stdoutStream.write(
            `\n\n[truncated: reached ${MAX_LOG_BYTES} bytes]\n`,
          );
        }
      }
    } catch {
      // Never fail the test due to logging issues.
    }
    return origStdoutWrite(chunk as any, encoding as any, cb as any);
  };

  (process.stderr as any).write = (chunk: any, encoding?: any, cb?: any) => {
    try {
      if (stderrBytes < MAX_LOG_BYTES) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk), encoding || "utf8");
        stderrBytes += buf.length;
        stderrStream.write(buf);
        if (stderrBytes >= MAX_LOG_BYTES) {
          stderrStream.write(
            `\n\n[truncated: reached ${MAX_LOG_BYTES} bytes]\n`,
          );
        }
      }
    } catch {
      // Never fail the test due to logging issues.
    }
    return origStderrWrite(chunk as any, encoding as any, cb as any);
  };

  return async () => {
    try {
      (process.stdout as any).write = origStdoutWrite;
      (process.stderr as any).write = origStderrWrite;
    } finally {
      try {
        stdoutStream.end();
        stderrStream.end();
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Writes WooCommerce's system status report (via PHP) into the mounted uploads
 * directory so it is persisted and can be attached to the report.
 */
async function writeWcSystemReportForTest(options: {
  cliServer: any;
  perTestLogsDir: string;
}) {
  const { cliServer, perTestLogsDir } = options;

  await cliServer.playground.run({
    code: `<?php require_once '/wordpress/wp-load.php'; $class = 'Automattic\\\\WooCommerce\\\\Utilities\\\\RestApiUtil'; // Ensure we run as admin so REST has caps\nwp_set_current_user( 1 ); if ( class_exists( $class ) ) { $system_report = wc_get_container()->get( $class )->get_endpoint_data( '/wc/v3/system_status' ); } else { $system_report = array( 'error' => 'RestApiUtil not available', 'version' => defined( 'WC_VERSION' ) ? WC_VERSION : null ); } $dir = '/wordpress/wp-content/uploads/krokedil-wp-ci/'; $path = $dir . 'wc-system-report.json'; file_put_contents( $path, wp_json_encode( $system_report, JSON_PRETTY_PRINT ) );`,
  });

  const reportPath = resolve(perTestLogsDir, "wc-system-report.json");
  if (!existsSync(reportPath)) {
    throw new Error(
      `Expected wc-system-report.json to be written at ${reportPath} but it was missing`,
    );
  }
}

/**
 * End-of-test artifact attachment.
 *
 * Attaches (best-effort):
 *   - wc-system-report.json
 *   - used-versions-for-test.json (derived from the WC system report)
 *   - debug.log (truncated)
 *   - newest wc-logs files (truncated) + wc-logs/index.txt
 *   - playground-temp-logs.tgz archive (fallback)
 */
async function attachEndOfTestArtifacts(options: {
  testInfo: TestInfo;
  perTestLogsDir: string;
  pluginNameForReport: string;
}) {
  const { testInfo, perTestLogsDir, pluginNameForReport } = options;

  if (!perTestLogsDir || !existsSync(perTestLogsDir)) return;

  const requireForSharedLib = createRequire(import.meta.url);
  const { buildUsedVersionsAnnotationFromWcSystemReport } = requireForSharedLib(
    "../../../scripts/lib/wc-system-report.js",
  ) as {
    buildUsedVersionsAnnotationFromWcSystemReport: (options: {
      pluginName: string;
      wcSystemReportJsonText: string;
    }) => UsedVersionsAnnotationResult;
  };

  // wc-system-report.json
  const wcSystemReportPath = resolve(perTestLogsDir, "wc-system-report.json");
  if (existsSync(wcSystemReportPath)) {
    const wcSystemReportText = readFileSync(wcSystemReportPath, "utf8");
    await testInfo.attach("wc-system-report.json", {
      body: wcSystemReportText,
      contentType: "application/json",
    });

    try {
      const { annotation, usedVersions } =
        buildUsedVersionsAnnotationFromWcSystemReport({
          pluginName: pluginNameForReport,
          wcSystemReportJsonText: wcSystemReportText,
        });

      testInfo.annotations.push(annotation as any);

      const usedVersionsJsonText = JSON.stringify(usedVersions, null, 2) + "\n";
      await testInfo.attach("used-versions-for-test.json", {
        body: usedVersionsJsonText,
        contentType: "application/json",
      });
    } catch {
      // Never fail the test due to evidence formatting.
    }
  }

  // debug.log
  const debugLogPath = resolve(perTestLogsDir, "debug.log");
  if (existsSync(debugLogPath)) {
    const MAX_DEBUG_LOG_BYTES = 200_000;
    const debugLogBuf = readFileSync(debugLogPath);
    const debugLogText =
      debugLogBuf.length > MAX_DEBUG_LOG_BYTES
        ? debugLogBuf.subarray(0, MAX_DEBUG_LOG_BYTES).toString("utf8") +
          `\n\n[truncated: ${debugLogBuf.length - MAX_DEBUG_LOG_BYTES} bytes omitted]\n`
        : debugLogBuf.toString("utf8");

    await testInfo.attach("debug.log", {
      body: debugLogText,
      contentType: "text/plain",
    });
  }

  // wc-logs
  const wcLogsDir = resolve(perTestLogsDir, "wc-logs");
  if (existsSync(wcLogsDir)) {
    const MAX_WC_LOG_FILES = 10;
    const MAX_WC_LOG_BYTES = 200_000;

    const entries = readdirSync(wcLogsDir)
      .map((name) => {
        const fullPath = resolve(wcLogsDir, name);
        try {
          const st = statSync(fullPath);
          return st.isFile() ? { name, fullPath, mtimeMs: st.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{
      name: string;
      fullPath: string;
      mtimeMs: number;
    }>;

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const selected = entries.slice(0, MAX_WC_LOG_FILES);
    const omitted = entries.length - selected.length;

    if (entries.length > 0) {
      const indexLines = [
        `Found ${entries.length} wc log file(s) in wc-logs/.`,
        `Attaching ${selected.length}${omitted > 0 ? ` (omitting ${omitted})` : ""}.`,
        "",
        ...entries.map(
          (e, i) => `${String(i + 1).padStart(2, "0")}. ${e.name}`,
        ),
        "",
        `Note: each attached log is truncated to ${MAX_WC_LOG_BYTES} bytes if larger.`,
      ];
      await testInfo.attach("wc-logs/index.txt", {
        body: indexLines.join("\n") + "\n",
        contentType: "text/plain",
      });
    }

    for (const entry of selected) {
      const buf = readFileSync(entry.fullPath);
      const text =
        buf.length > MAX_WC_LOG_BYTES
          ? buf.subarray(0, MAX_WC_LOG_BYTES).toString("utf8") +
            `\n\n[truncated: ${buf.length - MAX_WC_LOG_BYTES} bytes omitted]\n`
          : buf.toString("utf8");

      await testInfo.attach(`wc-logs/${entry.name}`, {
        body: text,
        contentType: "text/plain",
      });
    }
  }

  // Folder archive (best-effort)
  try {
    const archivePath = testInfo.outputPath("playground-temp-logs.tgz");
    execFileSync("tar", ["-czf", archivePath, "-C", perTestLogsDir, "."], {
      stdio: "ignore",
    });

    if (existsSync(archivePath)) {
      await testInfo.attach("playground-temp-logs.tgz", {
        path: archivePath,
        contentType: "application/gzip",
      });
    }
  } catch {
    // ignore
  }
}

export const test = testBase.extend<
  {
    playground: PlaygroundTestContext;
  },
  {
    playgroundWorker: PlaygroundWorkerContext;
  }
>({
  playgroundWorker: [
    async ({}, use) => {
      const requireForShared = createRequire(import.meta.url);
      const {
        BlueprintBuilder,
        applyKrokedilBlueprintTemplate,
        computeSnapshotCacheKey,
        ensureSnapshotExtracted,
      } = requireForShared("../../../scripts/lib/playground/index.js") as any;
      const { loadMeta, getOptionalString, getOptionalArrayOfObjects } =
        requireForShared("../../../scripts/lib/plugin-meta.js") as any;

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

      const metaE2EPages: MetaE2EPage[] = [];
      const rawPages =
        getOptionalArrayOfObjects(META, "pluginDevZipE2e.pages") || [];
      for (const raw of rawPages) {
        const url = typeof raw.url === "string" ? raw.url : undefined;
        if (!url) continue;

        const assertions: MetaE2EAssertion[] = [];
        const rawAssertions = Array.isArray(raw.assertions)
          ? raw.assertions
          : [];
        for (const a of rawAssertions) {
          if (!a || typeof a !== "object") continue;
          const selector =
            typeof a.selector === "string" ? a.selector : undefined;
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
        install_woocommerce: true,
        install_wc_beta_tester: true,
        reset_wordpress: true,
        install_storefront: true,
        configure_title_permalinks: true,
        // IMPORTANT: build-snapshot hangs if a mount is provided (Playground bug).
        // We therefore avoid activating the plugin during snapshot creation.
        // The plugin is mounted + activated in the per-test server blueprint.
        activate_plugin_slugs: "",
        configure_debug_logs: false,
        generate_wc_status_report: false,
        // In the server blueprint we do the configurable WooCommerce setup.
        configure_woocommerce: false,
      };

      const serverBlueprintVariables: Record<string, any> = {
        blogname,
        install_woocommerce: false,
        install_wc_beta_tester: false,
        reset_wordpress: false,
        install_storefront: false,
        configure_title_permalinks: false,
        activate_plugin_slugs: pluginSlug,
        configure_debug_logs: true,
        generate_wc_status_report: true,
        configure_woocommerce: true,
      };

      const snapshotBuilder = new BlueprintBuilder(
        snapshotBlueprintVariables,
        applyKrokedilBlueprintTemplate,
      );
      await snapshotBuilder.assertValidWithSchema();
      const snapshotBlueprintJson =
        JSON.stringify(snapshotBuilder.blueprint, null, 2) + "\n";

      const serverBuilder = new BlueprintBuilder(
        serverBlueprintVariables,
        applyKrokedilBlueprintTemplate,
      );
      await serverBuilder.assertValidWithSchema();
      const serverBlueprintJson =
        JSON.stringify(serverBuilder.blueprint, null, 2) + "\n";

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
      writeFileSync(
        resolve(cacheDir, "server-blueprint.json"),
        serverBlueprintJson,
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

      const extracted = await ensureSnapshotExtracted({
        cacheDir,
        pluginAutoMount,
        snapshotBlueprint: snapshotBuilder.blueprint,
        buildSnapshotZip: async ({ outfile, blueprint, quiet }: any) => {
          try {
            await runCLI({
              command: "build-snapshot",
              outfile,
              blueprint,
              quiet,
            });
          } catch {
            // runCLI sometimes throws due to a Playground issue (process.exit(0)).
            // The snapshot-cache layer will validate that the zip exists.
          }
        },
        unzip,
      });

      await use({
        pluginSlug,
        pluginNameForReport,
        blogname,
        metaE2EPages,
        pluginAutoMount,
        snapshotBlueprintJson,
        serverBlueprintJson,
        snapshotBlueprint: snapshotBuilder.blueprint,
        serverBlueprint: serverBuilder.blueprint,
        snapshotWordpressTemplateDir: extracted.wordpressDir,
      });
    },
    { scope: "worker" },
  ],

  playground: async ({ playgroundWorker }, use, testInfo) => {
    const {
      pluginSlug,
      pluginNameForReport,
      metaE2EPages,
      pluginAutoMount,
      snapshotBlueprintJson,
      serverBlueprintJson,
      serverBlueprint,
      snapshotWordpressTemplateDir,
    } = playgroundWorker;

    const testFolderNameBase = toPathSlug(testInfo.title);
    const testFolderName = testInfo.retry
      ? `${testFolderNameBase}-retry-${testInfo.retry}`
      : testFolderNameBase;

    const perTestLogsDir = resolve(
      "./playground-temp-logs",
      RUN_ID,
      testFolderName,
    );
    mkdirSync(perTestLogsDir, { recursive: true });

    // Let the console-capture fixture also persist browser-console.log next to
    // debug.log and other Playground artifacts.
    process.env.KROKEDIL_E2E_PER_TEST_LOGS_DIR = perTestLogsDir;

    const stopStdIoCapture = startStdIoCapture({ perTestLogsDir, testInfo });

    // Persist and attach blueprints.
    writeFileSync(
      resolve(perTestLogsDir, "snapshot-blueprint.json"),
      snapshotBlueprintJson,
    );
    writeFileSync(
      resolve(perTestLogsDir, "server-blueprint.json"),
      serverBlueprintJson,
    );
    await testInfo.attach("snapshot-blueprint.json", {
      body: snapshotBlueprintJson,
      contentType: "application/json",
    });
    await testInfo.attach("server-blueprint.json", {
      body: serverBlueprintJson,
      contentType: "application/json",
    });

    // Each test gets its own copy of the snapshot to avoid cross-test mutation.
    // This is critical when tests run in parallel.
    const perTestSnapshotDir = resolve(perTestLogsDir, "snapshot");
    const perTestWordpressDir = resolve(perTestSnapshotDir, "wordpress");
    rmSync(perTestSnapshotDir, { recursive: true, force: true });
    mkdirSync(perTestSnapshotDir, { recursive: true });
    cpSync(snapshotWordpressTemplateDir, perTestWordpressDir, {
      recursive: true,
    });

    // ---------------------------------------------------------------------
    // Start server
    // ---------------------------------------------------------------------
    const cliServer = await runCLI({
      command: "server",
      port: 0,
      mount: [
        {
          hostPath: perTestLogsDir,
          vfsPath: "/wordpress/wp-content/uploads/krokedil-wp-ci",
        },
      ],
      autoMount: pluginAutoMount,
      "mount-before-install": [
        {
          hostPath: perTestWordpressDir,
          vfsPath: "/wordpress",
        },
      ],
      blueprint: serverBlueprint,
      mode: "mount-only",
      ...(testInfo?.project?.metadata &&
      typeof (testInfo.project.metadata as any).phpVersion === "string"
        ? { php: (testInfo.project.metadata as any).phpVersion }
        : undefined),
      quiet: true,
    });

    const runPhp = async (code: string) => {
      await cliServer.playground.run({ code });
    };

    const ensureWcReport = async () => {
      const wcSystemReportPath = resolve(
        perTestLogsDir,
        "wc-system-report.json",
      );
      if (!existsSync(wcSystemReportPath)) {
        await writeWcSystemReportForTest({ cliServer, perTestLogsDir });
      }
      return readFileSync(wcSystemReportPath, "utf8");
    };

    // Attach WC report evidence early when available.
    try {
      const wcText = await ensureWcReport();
      await testInfo.attach("wc-system-report.json", {
        body: wcText,
        contentType: "application/json",
      });
    } catch {
      // ignore
    }

    try {
      await use({
        cliServer,
        pluginSlug,
        perTestLogsDir,
        metaE2EPages,
        blueprints: {
          snapshotJson: snapshotBlueprintJson,
          serverJson: serverBlueprintJson,
        },
        runPhp,
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
