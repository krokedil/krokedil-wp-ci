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
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import unzipper from "unzipper";

type ConsoleLogParts = {
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
};

function formatLogLine(parts: ConsoleLogParts): string {
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
  requiresPlugins: string[];
  metaE2EPages: MetaE2EPage[];
  pluginAutoMount: string;
  snapshotBlueprintJson: string;
  snapshotBlueprint: any;
  snapshotWordpressTemplateDir: string;
};

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

type UsedVersionsAnnotationResult = {
  annotation: {
    type: string;
    description: string;
  };
  usedVersions: unknown;
};

const SUITE_ID = "pluginDevZipE2e";

const DEFAULT_SERVER_BLUEPRINT_VARS: Record<string, any> = {
  configure_debug_logs: true,
  generate_site_health_report: true,
  generate_wc_status_report: true,
};

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
 * End-of-test artifact attachment.
 *
 * Attaches (best-effort):
 *   - wp-site-health-info.json
 *   - wc-system-report.json
 *   - used-versions-for-test.json (derived from wp-site-health-info.json)
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
  const { buildUsedVersionsAnnotationFromWpSiteHealthInfo } =
    requireForSharedLib("../../../scripts/lib/used-versions.js") as {
      buildUsedVersionsAnnotationFromWpSiteHealthInfo: (options: {
        pluginName: string;
        wpSiteHealthInfoJsonText: string;
      }) => UsedVersionsAnnotationResult;
    };

  // wp-site-health-info.json
  const siteHealthInfoPath = resolve(
    perTestLogsDir,
    "wp-site-health-info.json",
  );
  if (existsSync(siteHealthInfoPath)) {
    const MAX_SITE_HEALTH_BYTES = 2_000_000;
    const buf = readFileSync(siteHealthInfoPath);
    const rawText = buf.toString("utf8");
    const text =
      buf.length > MAX_SITE_HEALTH_BYTES
        ? buf.subarray(0, MAX_SITE_HEALTH_BYTES).toString("utf8") +
          `\n\n[truncated: ${buf.length - MAX_SITE_HEALTH_BYTES} bytes omitted]\n`
        : buf.toString("utf8");

    await testInfo.attach("wp-site-health-info.json", {
      body: text,
      contentType: "application/json",
    });

    // Prefer generating used-versions from Site Health "Info".
    try {
      const { annotation, usedVersions } =
        buildUsedVersionsAnnotationFromWpSiteHealthInfo({
          pluginName: pluginNameForReport,
          wpSiteHealthInfoJsonText: rawText,
        });

      testInfo.annotations.push(annotation as any);

      const usedVersionsJsonText = JSON.stringify(usedVersions, null, 2) + "\n";

      // Persist next to other per-test evidence for easier local debugging.
      try {
        writeFileSync(
          resolve(perTestLogsDir, "used-versions-for-test.json"),
          usedVersionsJsonText,
        );
      } catch {
        // Ignore failures here; attaching to the report is the primary output.
      }

      await testInfo.attach("used-versions-for-test.json", {
        body: usedVersionsJsonText,
        contentType: "application/json",
      });
    } catch {
      // Never fail the test due to evidence formatting.
    }
  }

  // wc-system-report.json
  const wcSystemReportPath = resolve(perTestLogsDir, "wc-system-report.json");
  if (existsSync(wcSystemReportPath)) {
    const wcSystemReportText = readFileSync(wcSystemReportPath, "utf8");
    await testInfo.attach("wc-system-report.json", {
      body: wcSystemReportText,
      contentType: "application/json",
    });
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
    // Exclude the per-test snapshot copy (wordpress/) since it's large and can
    // easily dominate artifacts; we already attach the interesting logs/files
    // individually.
    execFileSync(
      "tar",
      ["-czf", archivePath, "--exclude=./snapshot", "-C", perTestLogsDir, "."],
      {
        stdio: "ignore",
      },
    );

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
      const requireForShared = createRequire(import.meta.url);
      const {
        BlueprintBuilder,
        applyKrokedilBlueprintTemplate,
        computeSnapshotCacheKey,
        ensureSnapshotExtracted,
      } = requireForShared("../../../scripts/lib/playground/index.js") as any;
      const {
        loadMeta,
        getOptionalString,
        getOptionalArray,
        getOptionalArrayOfObjects,
      } = requireForShared("../../../scripts/lib/plugin-meta.js") as any;

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
        buildSnapshotZip: async ({ outfile, blueprint }: any) => {
          try {
            await runCLI({
              command: "build-snapshot",
              outfile,
              blueprint,
              autoMount: pluginAutoMount,
              quiet: true,
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
        requiresPlugins,
        metaE2EPages,
        pluginAutoMount,
        snapshotBlueprintJson,
        snapshotBlueprint: snapshotBuilder.blueprint,
        snapshotWordpressTemplateDir: extracted.wordpressDir,
      });
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

    const testFolderNameBase = toPathSlug(testInfo.title);
    const testFolderName = testInfo.retry
      ? `${testFolderNameBase}-retry-${testInfo.retry}`
      : testFolderNameBase;

    const projectFolderName = toPathSlug(testInfo.project.name);

    const perTestLogsDir = resolve(
      "./playground-temp-logs",
      RUN_ID,
      projectFolderName,
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
    await testInfo.attach("snapshot-blueprint.json", {
      body: snapshotBlueprintJson,
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
    const requireForShared = createRequire(import.meta.url);
    const { BlueprintBuilder, applyKrokedilBlueprintTemplate } =
      requireForShared("../../../scripts/lib/playground/index.js") as any;

    const effectiveServerBlueprintVars: Record<string, any> = {
      ...DEFAULT_SERVER_BLUEPRINT_VARS,
      ...(serverBlueprintVars || {}),
      ...(serverBlueprintVarsOverrides || {}),
    };

    const projectPhpVersion =
      testInfo?.project?.metadata &&
      typeof (testInfo.project.metadata as any).phpVersion === "string"
        ? (testInfo.project.metadata as any).phpVersion
        : undefined;

    if (
      projectPhpVersion &&
      effectiveServerBlueprintVars.php_version === undefined
    ) {
      effectiveServerBlueprintVars.php_version = projectPhpVersion;
    }

    const serverBuilder = new BlueprintBuilder(
      effectiveServerBlueprintVars,
      applyKrokedilBlueprintTemplate,
    );
    await serverBuilder.assertValidWithSchema();
    const serverBlueprintJson =
      JSON.stringify(serverBuilder.blueprint, null, 2) + "\n";

    writeFileSync(
      resolve(perTestLogsDir, "server-blueprint.json"),
      serverBlueprintJson,
    );
    await testInfo.attach("server-blueprint.json", {
      body: serverBlueprintJson,
      contentType: "application/json",
    });

    const cliServer = await runCLI({
      command: "server",
      port: 0,
      "mount-before-install": [
        {
          hostPath: perTestWordpressDir,
          vfsPath: "/wordpress",
        },
      ],
      mount: [
        {
          hostPath: perTestLogsDir,
          vfsPath: "/wordpress/wp-content/uploads/krokedil-wp-ci",
        },
      ],
      skipWordPressSetup: true,
      blueprint: serverBuilder.blueprint,
      quiet: true,
      ...(testInfo?.project?.metadata &&
      typeof (testInfo.project.metadata as any).phpVersion === "string"
        ? { php: (testInfo.project.metadata as any).phpVersion }
        : undefined),
    });

    const ensureWcReport = async () => {
      if (!effectiveServerBlueprintVars.generate_wc_status_report) {
        throw new Error(
          "ensureWcReport() called but generate_wc_status_report is disabled in the server blueprint.",
        );
      }
      const wcSystemReportPath = resolve(
        perTestLogsDir,
        "wc-system-report.json",
      );
      // The report is expected to be created by the server blueprint when
      // `generate_wc_status_report` is enabled.
      const startedAt = Date.now();
      const timeoutMs = 10_000;
      while (!existsSync(wcSystemReportPath)) {
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(
            `Expected wc-system-report.json at ${wcSystemReportPath} but it was missing. ` +
              `Ensure the server blueprint enables generate_wc_status_report and that the uploads mount is writable.`,
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return readFileSync(wcSystemReportPath, "utf8");
    };

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
