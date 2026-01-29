/**
 * E2E stdio capture
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Capture Playwright worker stdout/stderr into per-test files for debugging.
 *
 * Inputs:
 *   - perTestLogsDir: directory for stdout/stderr logs.
 *   - testInfo: Playwright test info (for headers).
 *
 * Behavior:
 *   1) Monkey-patches process stdout/stderr writes.
 *   2) Writes up to a fixed byte limit per stream.
 *   3) Restores original writes on cleanup.
 *
 * Failure modes:
 *   - Never throws. Logging must not fail tests.
 */

import type { TestInfo } from "@playwright/test";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";

export function startStdIoCapture(options: {
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
