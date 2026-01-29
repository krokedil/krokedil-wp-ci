/**
 * E2E console capture
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Capture browser console + page errors and attach them to Playwright report.
 *
 * Inputs:
 *   - page: Playwright Page instance.
 *   - testInfo: Playwright test info.
 *
 * Behavior:
 *   1) Collects console + pageerror events during the test.
 *   2) Attaches a bounded log to the test report.
 *   3) Optionally writes browser-console.log next to per-test logs.
 *
 * Failure modes:
 *   - Never throws. Logging must not fail tests.
 */

import type { Page, TestInfo } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

export async function runConsoleCapture(options: {
  page: Page;
  testInfo: TestInfo;
  use: (page: Page) => Promise<void>;
}) {
  const { page, testInfo, use } = options;
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
}
