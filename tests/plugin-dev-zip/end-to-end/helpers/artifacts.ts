/**
 * E2E artifact attachment
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Collect and attach per-test artifacts to the Playwright report.
 *
 * Inputs:
 *   - testInfo: Playwright test info (for attachments + output paths).
 *   - perTestLogsDir: directory containing generated files.
 *   - pluginNameForReport: name used when deriving used-versions annotation.
 *
 * Behavior:
 *   1) Attach site health info, WC system report, debug log, and WC logs.
 *   2) Derive and attach used-versions-for-test.json when possible.
 *   3) Create a fallback tgz archive of the logs folder.
 *
 * Failure modes:
 *   - Best-effort only; never throws.
 */

import type { TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

type UsedVersionsAnnotationResult = {
  annotation: {
    type: string;
    description: string;
  };
  usedVersions: unknown;
};

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
export async function attachEndOfTestArtifacts(options: {
  testInfo: TestInfo;
  perTestLogsDir: string;
  pluginNameForReport: string;
}) {
  const { testInfo, perTestLogsDir, pluginNameForReport } = options;

  if (!perTestLogsDir || !existsSync(perTestLogsDir)) return;

  const requireForSharedLib = createRequire(import.meta.url);
  const { buildUsedVersionsAnnotationFromWpSiteHealthInfo } =
    requireForSharedLib("../../../../scripts/lib/used-versions.js") as {
      buildUsedVersionsAnnotationFromWpSiteHealthInfo: (options: {
        pluginName: string;
        wpSiteHealthInfoJsonText: string;
      }) => UsedVersionsAnnotationResult;
    };
  const { buildComposerDepsAnnotation } = requireForSharedLib(
    "../../../../scripts/lib/composer-deps.js",
  ) as {
    buildComposerDepsAnnotation: (
      allPluginsJsonText: string,
    ) => { annotation: { type: string; description: string }; deps: unknown } | null;
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

  // composer-dependencies-all-plugins.json
  const composerDepsPath = resolve(
    perTestLogsDir,
    "composer-dependencies-all-plugins.json",
  );
  if (existsSync(composerDepsPath)) {
    const composerDepsText = readFileSync(composerDepsPath, "utf8");

    await testInfo.attach("composer-dependencies-all-plugins.json", {
      body: composerDepsText,
      contentType: "application/json",
    });

    try {
      const result = buildComposerDepsAnnotation(composerDepsText);
      if (result) {
        testInfo.annotations.push(result.annotation as any);
      }
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
