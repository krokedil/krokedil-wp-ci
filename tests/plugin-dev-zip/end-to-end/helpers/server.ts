/**
 * E2E Playground server helpers
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Build server blueprints, start Playground server, and manage report helpers.
 *
 * Inputs:
 *   - perTestLogsDir / perTestWordpressDir: filesystem paths for mounts.
 *   - server blueprint vars + optional overrides.
 *   - project PHP version (optional).
 *
 * Behavior:
 *   1) Merge server blueprint variables with defaults.
 *   2) Inject php_version into blueprint vars when not explicitly set.
 *   3) Build and validate the server blueprint JSON.
 *   4) Start the Playground server via @wp-playground/cli.
 *
 * Failure modes:
 *   - Blueprint validation errors bubble up.
 *   - Server startup errors bubble up.
 */

import { runCLI } from "@wp-playground/cli";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function buildEffectiveServerBlueprintVars(options: {
  defaultVars: Record<string, any>;
  serverBlueprintVars?: Record<string, any>;
  serverBlueprintVarsOverrides?: Record<string, any>;
  projectPhpVersion?: string;
}) {
  const effectiveServerBlueprintVars: Record<string, any> = {
    ...options.defaultVars,
    ...(options.serverBlueprintVars || {}),
    ...(options.serverBlueprintVarsOverrides || {}),
  };

  if (
    options.projectPhpVersion &&
    effectiveServerBlueprintVars.php_version === undefined
  ) {
    effectiveServerBlueprintVars.php_version = options.projectPhpVersion;
  }

  return effectiveServerBlueprintVars;
}

export async function buildServerBlueprintJson(options: {
  effectiveServerBlueprintVars: Record<string, any>;
}) {
  const requireForShared = createRequire(import.meta.url);
  const { BlueprintBuilder, applyKrokedilBlueprintTemplate } = requireForShared(
    "../../../../scripts/lib/playground/index.js",
  ) as any;

  const serverBuilder = new BlueprintBuilder(
    options.effectiveServerBlueprintVars,
    applyKrokedilBlueprintTemplate,
  );
  await serverBuilder.assertValidWithSchema();
  const serverBlueprintJson =
    JSON.stringify(serverBuilder.blueprint, null, 2) + "\n";

  return { blueprint: serverBuilder.blueprint, json: serverBlueprintJson };
}

export async function startPlaygroundServer(options: {
  perTestWordpressDir: string;
  perTestLogsDir: string;
  serverBlueprint: any;
  projectPhpVersion?: string;
}) {
  return runCLI({
    command: "server",
    port: 0,
    "mount-before-install": [
      {
        hostPath: options.perTestWordpressDir,
        vfsPath: "/wordpress",
      },
    ],
    mount: [
      {
        hostPath: options.perTestLogsDir,
        vfsPath: "/wordpress/wp-content/uploads/krokedil-wp-ci",
      },
    ],
    wordpressInstallMode: "do-not-attempt-installing",
    blueprint: options.serverBlueprint,
    quiet: true,
    ...(options.projectPhpVersion ? { php: options.projectPhpVersion } : {}),
  });
}

export function createEnsureWcReport(options: {
  perTestLogsDir: string;
  generateWcStatusReportEnabled: boolean;
}) {
  return async () => {
    if (!options.generateWcStatusReportEnabled) {
      throw new Error(
        "ensureWcReport() called but generate_wc_status_report is disabled in the server blueprint.",
      );
    }
    const wcSystemReportPath = resolve(
      options.perTestLogsDir,
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
}

export function persistServerBlueprintJson(options: {
  perTestLogsDir: string;
  serverBlueprintJson: string;
}) {
  writeFileSync(
    resolve(options.perTestLogsDir, "server-blueprint.json"),
    options.serverBlueprintJson,
  );
}
