/**
 * E2E per-test snapshot helpers
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Persist snapshot blueprints and prepare a per-test snapshot copy.
 *
 * Inputs:
 *   - perTestLogsDir: directory for artifacts.
 *   - snapshotBlueprintJson: snapshot blueprint JSON string.
 *   - snapshotWordpressTemplateDir: cached snapshot wordpress dir.
 *
 * Behavior:
 *   1) Writes snapshot-blueprint.json into the per-test logs folder.
 *   2) Copies the cached wordpress snapshot into a per-test snapshot dir.
 *
 * Failure modes:
 *   - File system errors bubble up (setup should fail loudly).
 */

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function persistSnapshotBlueprint(options: {
  perTestLogsDir: string;
  snapshotBlueprintJson: string;
}) {
  writeFileSync(
    resolve(options.perTestLogsDir, "snapshot-blueprint.json"),
    options.snapshotBlueprintJson,
  );
}

export function preparePerTestSnapshot(options: {
  perTestLogsDir: string;
  snapshotWordpressTemplateDir: string;
}) {
  // Each test gets its own copy of the snapshot to avoid cross-test mutation.
  // This is critical when tests run in parallel.
  const perTestSnapshotDir = resolve(options.perTestLogsDir, "snapshot");
  const perTestWordpressDir = resolve(perTestSnapshotDir, "wordpress");

  rmSync(perTestSnapshotDir, { recursive: true, force: true });
  mkdirSync(perTestSnapshotDir, { recursive: true });
  cpSync(options.snapshotWordpressTemplateDir, perTestWordpressDir, {
    recursive: true,
  });

  return { perTestSnapshotDir, perTestWordpressDir };
}
