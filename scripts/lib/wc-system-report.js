// wc-system-report.js
// ---------------------------------------------------------------------------
// Purpose
//   Parse and summarize the WooCommerce “system status” JSON payload written by
//   our WordPress Playground blueprint step to `wc-system-report.json`.
//
// Where this is used
//   - Playwright E2E tests attach `wc-system-report.json` as evidence.
//   - The same payload is parsed into:
//     - A human-readable Playwright annotation (“used-versions”) shown in reports
//     - A machine-readable JSON object saved as used-versions-for-test.json
//
// Inputs
//   - wcSystemReportJsonText: string
//     The full file contents of `wc-system-report.json`.
//
// Outputs
//   - extractWcSystemReportSummary(): stable, normalized summary for code
//     (includes only active/activated plugins from the WooCommerce payload)
//   - extractUsedVersionsForTest(): small evidence JSON used in CI artifacts
//   - buildUsedVersionsAnnotationFromWcSystemReport(): annotation + evidence JSON
//
// Failure modes
//   - Invalid JSON / unexpected shape:
//     - Summary/evidence returns best-effort fallbacks.
//     - extractWcSystemReportSummary() includes an `error` string.

/**
 * @typedef {Object} PluginVersion
 * @property {string} name
 * @property {string | undefined} [version]
 */

/**
 * @typedef {Object} WcSystemReportSummary
 * @property {{ php?: string, wordpress?: string, woocommerce?: string }} environment
 * @property {{ name?: string, version?: string } | undefined} [theme]
 * @property {PluginVersion[]} plugins Active/activated plugins only.
 * @property {string | undefined} [error]
 */

/**
 * @typedef {Object} UsedVersionsForTest
 * @property {string | undefined} [php]
 * @property {string | undefined} [wordpress]
 * @property {{ name?: string, version?: string }} activated_theme
 * @property {Array<{ name: string, version?: string }>} activated_plugins
 */

/**
 * @typedef {Object} PlaywrightAnnotation
 * @property {string} type
 * @property {string} description
 */

// ---------------------------------------------------------------------------
// Internal helpers (shape-guarding and normalization)

/**
 * Best-effort “record” guard for unknown JSON values.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read a string field and normalize empty/whitespace-only to undefined.
 * @param {unknown} obj
 * @param {string} key
 * @returns {string | undefined}
 */
function getOptionalString(obj, key) {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read an array field.
 * @param {unknown} obj
 * @param {string} key
 * @returns {unknown[] | undefined}
 */
function getOptionalArray(obj, key) {
  if (!isRecord(obj)) return undefined;
  const value = obj[key];
  return Array.isArray(value) ? value : undefined;
}

/**
 * Normalize a plugin-like entry from the WooCommerce payload.
 *
 * We intentionally keep this strict: only read the canonical keys that appear
 * in WooCommerce's system status payload.
 *
 * @param {unknown} entry
 * @returns {PluginVersion | undefined}
 */
function normalizePluginEntry(entry) {
  if (!isRecord(entry)) return undefined;

  const name = getOptionalString(entry, "name");

  if (!name) return undefined;

  const version = getOptionalString(entry, "version");

  return { name, version };
}

// ---------------------------------------------------------------------------
// Public API (parsing and evidence extraction)

/**
 * Parse the raw `wc-system-report.json` text and return a stable summary.
 *
 * Use this when you need a normalized shape for additional processing or
 * debugging (e.g. attaching a summary to test artifacts).
 *
 * Contract notes
 *   - Plugins are read only from the WooCommerce field `active_plugins`.
 *   - No fallback keys are attempted. If `active_plugins` is missing/empty or
 *     has an unexpected shape, `plugins` will be an empty list.
 *
 * @param {string} wcSystemReportJsonText
 * @returns {WcSystemReportSummary}
 */
function extractWcSystemReportSummary(wcSystemReportJsonText) {
  try {
    const report = JSON.parse(wcSystemReportJsonText);

    const environment = isRecord(report) ? report.environment : undefined;
    const theme = isRecord(report) ? report.theme : undefined;

    const summary = {
      environment: {
        php: getOptionalString(environment, "php_version"),
        wordpress: getOptionalString(environment, "wp_version"),
        woocommerce: getOptionalString(environment, "version"),
      },
      theme: {
        name: getOptionalString(theme, "name"),
        version: getOptionalString(theme, "version"),
      },
      plugins: [],
    };

    const active = getOptionalArray(report, "active_plugins") || [];
    for (const entry of active) {
      const normalized = normalizePluginEntry(entry);
      if (normalized) summary.plugins.push(normalized);
    }

    summary.plugins.sort((a, b) => a.name.localeCompare(b.name));

    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      environment: {},
      theme: undefined,
      plugins: [],
      error: `Failed to parse wc-system-report.json: ${message}`,
    };
  }
}

/**
 * Convert the WooCommerce payload into a minimal “used versions” object.
 *
 * This is intended to be stored alongside per-test logs and attached to the
 * Playwright report as JSON.
 *
 * @param {string} wcSystemReportJsonText
 * @returns {UsedVersionsForTest}
 */
function extractUsedVersionsForTest(wcSystemReportJsonText) {
  const summary = extractWcSystemReportSummary(wcSystemReportJsonText);

  const activatedPlugins = summary.plugins
    .map((p) => ({ name: p.name, version: p.version }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    php: summary.environment.php,
    wordpress: summary.environment.wordpress,
    activated_theme: summary.theme
      ? { name: summary.theme.name, version: summary.theme.version }
      : { name: undefined, version: undefined },
    activated_plugins: activatedPlugins,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers (used for Playwright report annotations)

/**
 * @param {{ name?: string, version?: string } | undefined} theme
 * @returns {string}
 */
function formatThemeNameAndVersion(theme) {
  const name = theme?.name?.trim() ? theme.name.trim() : "(unknown)";
  const version = theme?.version?.trim() ? theme.version.trim() : undefined;
  return version ? `${name} (${version})` : name;
}

/**
 * @param {{ name: string, version?: string }} plugin
 * @returns {string}
 */
function formatPluginNameAndVersion(plugin) {
  const name = plugin.name;
  const version = plugin.version?.trim() ? plugin.version.trim() : "(unknown)";
  return `${name}: ${version}`;
}

/**
 * Create the multi-line annotation text shown in Playwright reports.
 *
 * Keep this format stable: it’s optimized for human readability in CI.
 *
 * @param {{ pluginName: string, usedVersions: UsedVersionsForTest }} options
 * @returns {string}
 */
function formatUsedVersionsAnnotationText({ pluginName, usedVersions }) {
  const php = usedVersions.php ?? "(unknown)";
  const wordpress = usedVersions.wordpress ?? "(unknown)";
  const activatedTheme = formatThemeNameAndVersion(
    usedVersions.activated_theme
  );

  const lines = [];
  lines.push(
    `This plugin dev zip e2e test for the plugin "${pluginName}" used the following versions:`
  );
  lines.push(`- PHP: ${php}`);
  lines.push(`- WordPress: ${wordpress}`);
  lines.push(`- Activated theme: ${activatedTheme}`);
  lines.push("");
  lines.push("Activated plugins:");

  const plugins = usedVersions.activated_plugins;
  if (!plugins || plugins.length === 0) {
    lines.push("- (none found in wc-system-report.json)");
  } else {
    for (const p of plugins) {
      lines.push(`- ${formatPluginNameAndVersion(p)}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Convenience wrapper for the common E2E case:
 *   - parse wc-system-report.json
 *   - compute evidence JSON
 *   - build a Playwright annotation object
 *
 * @param {{ pluginName: string, wcSystemReportJsonText: string }} options
 * @returns {{ annotation: PlaywrightAnnotation, usedVersions: UsedVersionsForTest }}
 */
function buildUsedVersionsAnnotationFromWcSystemReport({
  pluginName,
  wcSystemReportJsonText,
}) {
  const usedVersions = extractUsedVersionsForTest(wcSystemReportJsonText);
  const description = formatUsedVersionsAnnotationText({
    pluginName,
    usedVersions,
  });

  return {
    annotation: {
      type: "used-versions",
      description,
    },
    usedVersions,
  };
}

module.exports = {
  extractWcSystemReportSummary,
  extractUsedVersionsForTest,
  formatUsedVersionsAnnotationText,
  buildUsedVersionsAnnotationFromWcSystemReport,
};
