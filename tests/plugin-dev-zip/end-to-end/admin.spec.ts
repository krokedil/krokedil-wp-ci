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
 *   - ./zipfile/<slug> (path): GitHub Actions mount layout for prepared plugin
 *   - tests/scripts/fixtures/dummy-plugin-for-repo-tests (local fixture plugin)
 *
 * Why this exists:
 *   - Deterministic smoke coverage for dev zips in CI and locally.
 */

import { test, expect } from "./fixtures";
import { runCLI } from "@wp-playground/cli";
import { resolve } from "path";
import {
  mkdirSync,
  writeFileSync,
  createWriteStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { createRequire } from "module";
import { execFileSync } from "child_process";

type UsedVersionsForTest = {
  php?: string;
  wordpress?: string;
  activated_theme?: {
    name?: string;
    version?: string;
  };
  activated_plugins: Array<{
    name: string;
    version?: string;
  }>;
};

type UsedVersionsAnnotationResult = {
  annotation: {
    type: string;
    description: string;
  };
  usedVersions: UsedVersionsForTest;
};

type BuildUsedVersionsFn = (options: {
  pluginName: string;
  wcSystemReportJsonText: string;
}) => UsedVersionsAnnotationResult;

const requireForSharedLib = createRequire(import.meta.url);
const { buildUsedVersionsAnnotationFromWcSystemReport } = requireForSharedLib(
  "../../../scripts/lib/wc-system-report.js"
) as {
  buildUsedVersionsAnnotationFromWcSystemReport: BuildUsedVersionsFn;
};

const SUITE_NAME = "Plugin dev zip e2e";
const SUITE_ID = "plugin-dev-zip-e2e";

const RUN_ID = (() => {
  // Keep logs from different runs separated so reruns don't overwrite/mix files.
  // Prefer GitHub Actions run id when available; fall back to a local timestamp.
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

test.describe(SUITE_NAME, () => {
  type MetaE2EAssertion = {
    selector: string;
    text?: string;
    match?: "contains" | "equals";
  };

  type MetaE2EPage = {
    url: string;
    assertions?: MetaE2EAssertion[];
  };

  let cliServer: any;
  let pluginSlug: string;
  let blogname: string;
  let pluginNameForReport: string;
  let metaE2EPages: MetaE2EPage[];
  let perTestLogsDir: string;
  let blueprintPath: string;
  let wpVersion: string | undefined;
  let phpVersion: string | undefined;
  let landingPage: string | undefined;
  let wcSystemReportAttached = false;
  let wcSystemReportAnnotated = false;
  let wcUsedVersionsAttached = false;

  let stopStdIoCapture: (() => Promise<void>) | undefined;

  function startStdIoCapture(options: { perTestLogsDir: string; testInfo: any }) {
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
              `\n\n[truncated: reached ${MAX_LOG_BYTES} bytes]\n`
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
              `\n\n[truncated: reached ${MAX_LOG_BYTES} bytes]\n`
            );
          }
        }
      } catch {
        // Never fail the test due to logging issues.
      }
      return origStderrWrite(chunk as any, encoding as any, cb as any);
    };

    return async () => {
      (process.stdout as any).write = origStdoutWrite;
      (process.stderr as any).write = origStderrWrite;

      await Promise.all([
        new Promise<void>((r) => stdoutStream.end(() => r())),
        new Promise<void>((r) => stderrStream.end(() => r())),
      ]);
    };
  }

  function annotateFromWcSystemReport(
    testInfo: any,
    wcSystemReportJsonText: string
  ) {
    if (wcSystemReportAnnotated) return;

    try {
      const { annotation } = buildUsedVersionsAnnotationFromWcSystemReport({
        pluginName: pluginNameForReport,
        wcSystemReportJsonText,
      });
      testInfo.annotations.push(annotation);
      wcSystemReportAnnotated = true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to add wc-system-report annotations: ${message}`);
    }
  }

  async function attachUsedVersionsForTest(
    testInfo: any,
    wcSystemReportJsonText: string
  ) {
    if (wcUsedVersionsAttached) return;

    const { usedVersions } = buildUsedVersionsAnnotationFromWcSystemReport({
      pluginName: pluginNameForReport,
      wcSystemReportJsonText,
    });

    const usedVersionsJsonText = JSON.stringify(usedVersions, null, 2) + "\n";
    const usedVersionsPath = resolve(
      perTestLogsDir,
      "used-versions-for-test.json"
    );
    writeFileSync(usedVersionsPath, usedVersionsJsonText);

    await testInfo.attach("used-versions-for-test.json", {
      body: usedVersionsJsonText,
      contentType: "application/json",
    });

    wcUsedVersionsAttached = true;
  }

  test.beforeAll(async ({}, testInfo) => {
    // ---------------------------------------------------------------------
    // Load shared helpers (CommonJS) from the repo root
    // ---------------------------------------------------------------------
    const require = createRequire(import.meta.url);
    const {
      BlueprintBuilder,
      applyKrokedilBlueprintTemplate,
    } = require("../../../scripts/create-playground-blueprint.js");
    const {
      loadMeta,
      getOptionalString,
      getOptionalArrayOfObjects,
    } = require("../../../scripts/lib/plugin-meta.js");

    // ---------------------------------------------------------------------
    // Metadata parsing + optional playground overrides (mirrors job summary)
    // ---------------------------------------------------------------------
    const rawMetaProvided = !!process.env.PLUGIN_META_JSON;
    if (!rawMetaProvided) {
      throw new Error(
        "Missing PLUGIN_META_JSON. These e2e tests are designed to run with plugin meta provided (as in GitHub Actions and the local fixture runner)."
      );
    }

    let META = {};
    try {
      META = loadMeta({ requireEnv: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid PLUGIN_META_JSON: ${message}`);
    }

    const pluginName = getOptionalString(META, "name");
    pluginNameForReport = pluginName || pluginSlug || "(unknown)";
    metaE2EPages = [];

    const rawPages =
      getOptionalArrayOfObjects(META, "plugin-dev-zip-e2e.pages") || [];
    for (const page of rawPages) {
      const url = getOptionalString(page, "url");
      if (!url) continue;

      const assertions: MetaE2EAssertion[] = [];
      const rawAssertions = getOptionalArrayOfObjects(page, "assertions") || [];
      for (const assertion of rawAssertions) {
        const selector = getOptionalString(assertion, "selector");
        if (!selector) continue;

        const text = getOptionalString(assertion, "text");
        const matchRaw = getOptionalString(assertion, "match");
        const match =
          matchRaw === "equals" || matchRaw === "contains"
            ? (matchRaw as "equals" | "contains")
            : undefined;

        assertions.push({ selector, text, match });
      }

      metaE2EPages.push({ url, assertions });
    }
    wpVersion = getOptionalString(META, "playground.preferredVersions.wp");
    phpVersion = getOptionalString(META, "playground.preferredVersions.php");
    landingPage = getOptionalString(META, "playground.landingPage");

    // We require a slug so we can reliably locate the plugin row and mount path.
    pluginSlug = getOptionalString(META, "slug") || "";
    if (!pluginSlug) {
      throw new Error(
        "PLUGIN_META_JSON was provided but did not include a valid `slug`"
      );
    }

    blogname = pluginName ? `${pluginName} dev zip` : "Plugin dev zip";

    const blueprintVariables: Record<string, any> = {
      blogname,
      base_woocommerce: true,
      wc_beta_tester: true,
      activate_plugin_slugs: pluginSlug,
    };

    if (wpVersion) blueprintVariables.wp_version = wpVersion;
    if (phpVersion) blueprintVariables.php_version = phpVersion;
    if (landingPage) blueprintVariables.landing_page = landingPage;
  });

  test.beforeEach(async ({}, testInfo) => {
    wcSystemReportAttached = false;
    wcSystemReportAnnotated = false;
    wcUsedVersionsAttached = false;

    const require = createRequire(import.meta.url);
    const {
      BlueprintBuilder,
      applyKrokedilBlueprintTemplate,
    } = require("../../../scripts/create-playground-blueprint.js");

    // ---------------------------------------------------------------------
    // Per-test log folder + blueprint file output
    // ---------------------------------------------------------------------
    const testFolderNameBase = toPathSlug(testInfo.title);
    const testFolderName = testInfo.retry
      ? `${testFolderNameBase}-retry-${testInfo.retry}`
      : testFolderNameBase;

    perTestLogsDir = resolve("./playground-temp-logs", RUN_ID, testFolderName);
    mkdirSync(perTestLogsDir, { recursive: true });

    // Allow the global Playwright fixture to write per-test browser logs into
    // the same folder as debug.log and other Playground artifacts.
    process.env.KROKEDIL_E2E_PER_TEST_LOGS_DIR = perTestLogsDir;

    // Also capture Playwright worker stdout/stderr into the per-test folder.
    // This helps correlate long setup phases (Playground server + blueprint).
    stopStdIoCapture = startStdIoCapture({ perTestLogsDir, testInfo });

    blueprintPath = resolve(perTestLogsDir, "blueprint.json");

    // ---------------------------------------------------------------------
    // Generate and validate a WordPress Playground blueprint
    // ---------------------------------------------------------------------
    // Keep the blueprint stored per test so the attached logs are self-contained.
    const blueprintVariables: Record<string, any> = {
      blogname,
      base_woocommerce: true,
      wc_beta_tester: true,
      activate_plugin_slugs: pluginSlug,
    };

    if (wpVersion) blueprintVariables.wp_version = wpVersion;
    if (phpVersion) blueprintVariables.php_version = phpVersion;
    if (landingPage) blueprintVariables.landing_page = landingPage;

    const builder = new BlueprintBuilder(
      blueprintVariables,
      applyKrokedilBlueprintTemplate
    );

    await builder.assertValidWithSchema();
    const blueprintJson = JSON.stringify(builder.blueprint, null, 2) + "\n";
    writeFileSync(blueprintPath, blueprintJson);

    // Attach the blueprint early and inline so it is readable in the HTML report.
    await testInfo.attach("blueprint.json", {
      body: blueprintJson,
      contentType: "application/json",
    });

    // ---------------------------------------------------------------------
    // Start Playground server
    // ---------------------------------------------------------------------
    // Mounting contract:
    // - Local runs: E2E_AUTO_MOUNT points at a plugin folder.
    // - GitHub Actions: prepared plugin is under ./zipfile/<slug>.
    cliServer = await runCLI({
      command: "server",
      // Let the OS pick a free port so parallel workers don't collide on 9400.
      // (@wp-playground/cli forwards this to Node's server.listen(port))
      port: 0,
      // experimentalMultiWorker don't seem to improve the time to generate the blueprint
      //experimentalMultiWorker: true,
      mount: [
        {
          hostPath: perTestLogsDir,
          vfsPath: "/wordpress/wp-content/uploads/krokedil-wp-ci",
        },
      ],
      // Prefer the explicit local fixture mount, else fall back to ./zipfile.
      autoMount: process.env.E2E_AUTO_MOUNT || `./zipfile/${pluginSlug}`,
      blueprint: blueprintPath,
      quiet: false,
    });

    // The blueprint writes a WC system report to the mounted uploads folder.
    // Attach it as soon as it exists so it can be inspected directly.
    const wcSystemReportPath = resolve(perTestLogsDir, "wc-system-report.json");
    if (existsSync(wcSystemReportPath)) {
      const wcSystemReportText = readFileSync(wcSystemReportPath, "utf8");
      await testInfo.attach("wc-system-report.json", {
        body: wcSystemReportText,
        contentType: "application/json",
      });
      wcSystemReportAttached = true;

      annotateFromWcSystemReport(testInfo, wcSystemReportText);

      try {
        await attachUsedVersionsForTest(testInfo, wcSystemReportText);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`Failed to attach used versions for test: ${message}`);
      }
    }
  });

  test.afterEach(async ({}, testInfo) => {
    if (cliServer?.server) {
      await cliServer.server.close();
      cliServer = undefined;
    }

    // Stop stdio capture before archiving the per-test folder.
    if (stopStdIoCapture) {
      try {
        await stopStdIoCapture();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`Failed to stop stdio capture: ${message}`);
      } finally {
        stopStdIoCapture = undefined;
      }
    }

    // Attach end-of-test artifacts from the mounted uploads folder.
    try {
      if (perTestLogsDir && existsSync(perTestLogsDir)) {
        const wcSystemReportPath = resolve(
          perTestLogsDir,
          "wc-system-report.json"
        );
        if (!wcSystemReportAttached && existsSync(wcSystemReportPath)) {
          const wcSystemReportText = readFileSync(wcSystemReportPath, "utf8");
          await testInfo.attach("wc-system-report.json", {
            body: wcSystemReportText,
            contentType: "application/json",
          });
          wcSystemReportAttached = true;

          annotateFromWcSystemReport(testInfo, wcSystemReportText);

          try {
            await attachUsedVersionsForTest(testInfo, wcSystemReportText);
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`Failed to attach used versions for test: ${message}`);
          }
        }

        // Attach debug.log (if any).
        const debugLogPath = resolve(perTestLogsDir, "debug.log");
        if (existsSync(debugLogPath)) {
          const MAX_DEBUG_LOG_BYTES = 200_000;
          const debugLogBuf = readFileSync(debugLogPath);
          const debugLogText =
            debugLogBuf.length > MAX_DEBUG_LOG_BYTES
              ? debugLogBuf.subarray(0, MAX_DEBUG_LOG_BYTES).toString("utf8") +
                `\n\n[truncated: ${
                  debugLogBuf.length - MAX_DEBUG_LOG_BYTES
                } bytes omitted]\n`
              : debugLogBuf.toString("utf8");

          await testInfo.attach("debug.log", {
            body: debugLogText,
            contentType: "text/plain",
          });
        }

        // Attach WooCommerce logs (if any) from the mounted uploads folder.
        // These filenames vary, so we attach a bounded set of the newest logs.
        const wcLogsDir = resolve(perTestLogsDir, "wc-logs");
        if (existsSync(wcLogsDir)) {
          const MAX_WC_LOG_FILES = 10;
          const MAX_WC_LOG_BYTES = 200_000;

          const entries = readdirSync(wcLogsDir)
            .map((name) => {
              const fullPath = resolve(wcLogsDir, name);
              try {
                const st = statSync(fullPath);
                return st.isFile()
                  ? { name, fullPath, mtimeMs: st.mtimeMs }
                  : null;
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
              `Attaching ${selected.length}${
                omitted > 0 ? ` (omitting ${omitted})` : ""
              }.`,
              "",
              ...entries.map(
                (e, i) => `${String(i + 1).padStart(2, "0")}. ${e.name}`
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
                  `\n\n[truncated: ${
                    buf.length - MAX_WC_LOG_BYTES
                  } bytes omitted]\n`
                : buf.toString("utf8");

            await testInfo.attach(`wc-logs/${entry.name}`, {
              body: text,
              contentType: "text/plain",
            });
          }
        }

        // Fallback: attach the full folder as a downloadable archive.
        // This preserves everything even if we didn't attach every file inline.
        try {
          const archivePath = testInfo.outputPath("playground-temp-logs.tgz");
          execFileSync(
            "tar",
            ["-czf", archivePath, "-C", perTestLogsDir, "."],
            {
              stdio: "ignore",
            }
          );

          if (existsSync(archivePath)) {
            await testInfo.attach("playground-temp-logs.tgz", {
              path: archivePath,
              contentType: "application/gzip",
            });
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn(`Failed to attach per-test archive: ${message}`);
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to attach end-of-test artifacts: ${message}`);
    }
  });

  test("Plugin active in admin", async ({ page }, testInfo) => {
    // ---------------------------------------------------------------------
    // Core smoke: plugin is activated
    // ---------------------------------------------------------------------
    const baseUrl: string = cliServer.serverUrl;
    const wpAdminUrl = new URL(
      "/wp-admin/plugins.php?plugin_status=active",
      baseUrl
    );

    await page.goto(wpAdminUrl.toString());

    // WordPress uses data-slug on plugin rows; this is more reliable than matching
    // the human-readable plugin name.
    const pluginRow = page.locator(`tr[data-slug="${pluginSlug}"]`);
    await expect(pluginRow).toBeVisible();
    await expect(pluginRow).toHaveClass(/active/);

    const screenshotPath = testInfo.outputPath("plugins-active.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("plugins-active", {
      path: screenshotPath,
      contentType: "image/png",
    });
  });

  test("Meta-defined pages", async ({ page }, testInfo) => {
    // ---------------------------------------------------------------------
    // Optional smoke: visit pages defined in plugin meta and assert UI
    // ---------------------------------------------------------------------
    test.skip(
      !metaE2EPages || metaE2EPages.length === 0,
      "No plugin-dev-zip-e2e.pages configured in PLUGIN_META_JSON"
    );

    const baseUrl: string = cliServer.serverUrl;

    for (const [pageIndex, metaPage] of metaE2EPages.entries()) {
      const url = new URL(metaPage.url, baseUrl);
      await page.goto(url.toString());

      const assertions = metaPage.assertions || [];
      for (const assertion of assertions) {
        const locator = page.locator(assertion.selector);
        await expect(locator).toBeVisible();

        if (assertion.text) {
          const match = assertion.match || "contains";
          if (match === "equals") {
            await expect(locator).toHaveText(assertion.text);
          } else {
            await expect(locator).toContainText(assertion.text);
          }
        }
      }

      const screenshotPath = testInfo.outputPath(
        `meta-page-${pageIndex + 1}.png`
      );
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach(`meta-page-${pageIndex + 1}`, {
        path: screenshotPath,
        contentType: "image/png",
      });
    }
  });

  test.afterAll(async () => {
    // Intentionally empty: server lifecycle is per-test.
  });
});
