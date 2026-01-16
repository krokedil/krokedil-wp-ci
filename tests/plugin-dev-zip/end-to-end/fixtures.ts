/**
 * Playwright e2e fixtures
 * ---------------------------------------------------------------------------
 * What this provides:
 *   - Global browser console capture for every e2e test.
 *
 * Why this exists:
 *   - Makes it easier to debug slow/flaky end-to-end runs by attaching
 *     browser console output to the Playwright HTML/JSON reports.
 */

import { test as base, expect } from "@playwright/test";
import { writeFileSync } from "fs";
import { resolve } from "path";

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

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const logs: string[] = [];

    page.on("console", (msg) => {
      // Keep this log format stable; it becomes part of debugging evidence.
      logs.push(
        formatLogLine({
          type: msg.type(),
          text: msg.text(),
          location: msg.location(),
        })
      );
    });

    page.on("pageerror", (err) => {
      logs.push(
        formatLogLine({
          type: "pageerror",
          text: err?.stack || String(err),
        })
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
