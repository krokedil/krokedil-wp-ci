/**
 * E2E paths + naming helpers
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Build stable per-test log paths and safe folder names.
 *
 * Inputs:
 *   - GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT (optional): used to group CI logs.
 *
 * Behavior:
 *   1) Compute a run id (CI-aware or local).
 *   2) Slugify test titles and project names for file-system safety.
 *   3) Build the per-test logs folder under playground-temp-logs/.
 *
 * Failure modes:
 *   - None. Falls back to a local run id if CI vars are missing.
 */

import { resolve } from "node:path";

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

export function toPathSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "unnamed-test";
}

export function buildPerTestLogsDir(options: {
  projectName: string;
  testTitle: string;
  retry?: number;
}): string {
  const testFolderNameBase = toPathSlug(options.testTitle);
  const testFolderName = options.retry
    ? `${testFolderNameBase}-retry-${options.retry}`
    : testFolderNameBase;

  const projectFolderName = toPathSlug(options.projectName);

  return resolve(
    "./playground-temp-logs",
    RUN_ID,
    projectFolderName,
    testFolderName,
  );
}
