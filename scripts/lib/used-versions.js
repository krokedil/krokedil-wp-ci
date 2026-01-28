// used-versions.js
// ---------------------------------------------------------------------------
// Purpose
//   Extract a stable, machine-readable "used versions" evidence object for E2E
//   tests, and optionally format it into a Playwright report annotation.
//
// Primary input source
//   - wp-site-health-info.json
//     The JSON written by our Playground blueprint via WP_Debug_Data::debug_data()
//     (Site Health → Info tab source).
//
// Outputs
//   - extractUsedVersionsForTestFromWpSiteHealthInfo(): UsedVersionsForTest
//   - buildUsedVersionsAnnotationFromWpSiteHealthInfo(): { annotation, usedVersions }
//
// Failure modes
//   - Invalid JSON / unexpected shape: returns safe fallbacks and never throws.

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
// Internal helpers

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
 * @param {unknown} obj
 * @param {string} key
 * @returns {unknown | undefined}
 */
function getOptionalField(obj, key) {
  if (!isRecord(obj)) return undefined;
  return obj[key];
}

/**
 * Site Health fields typically contain `{ value, debug }`. We prefer `debug`
 * when present since it often contains a cleaner version string.
 *
 * @param {unknown} field
 * @returns {string | undefined}
 */
function getOptionalFieldDebugOrValue(field) {
  if (!isRecord(field)) return undefined;

  const debug = getOptionalString(field, "debug");
  if (debug) return debug;

  const value = field.value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number") return String(value);

  return undefined;
}

/**
 * Extract a semver-ish prefix from a string.
 *
 * Examples:
 *   - "8.3.27-dev 64bit" -> "8.3.27-dev"
 *   - "6.9" -> "6.9"
 *
 * @param {string | undefined} input
 * @returns {string | undefined}
 */
function extractVersionPrefix(input) {
  if (!input) return undefined;
  const m = input.trim().match(/^(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : undefined;
}

/**
 * @param {unknown} pluginField
 * @returns {string | undefined}
 */
function extractPluginVersionFromSiteHealthField(pluginField) {
  const debugOrValue = getOptionalFieldDebugOrValue(pluginField);
  if (!debugOrValue) return undefined;

  // Common debug format: "version: 10.4.3, author: ..."
  const fromDebug = debugOrValue.match(/version:\s*([^,\s]+)/i);
  if (fromDebug) return fromDebug[1].trim();

  // Common value format: "Version 10.4.3 by ..."
  const fromValue = debugOrValue.match(/\bVersion\s+([^\s]+)\b/i);
  if (fromValue) return fromValue[1].trim();

  // Fall back to extracting any version prefix.
  return extractVersionPrefix(debugOrValue);
}

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
 * @param {{ pluginName: string, usedVersions: UsedVersionsForTest, sourceLabel: string }} options
 * @returns {string}
 */
function formatUsedVersionsAnnotationTextWithSource({
  pluginName,
  usedVersions,
  sourceLabel,
}) {
  const php = usedVersions.php ?? "(unknown)";
  const wordpress = usedVersions.wordpress ?? "(unknown)";
  const activatedTheme = formatThemeNameAndVersion(
    usedVersions.activated_theme,
  );

  const lines = [];
  lines.push(
    `This plugin dev zip e2e test for the plugin "${pluginName}" used the following versions:`,
  );
  lines.push(`- PHP: ${php}`);
  lines.push(`- WordPress: ${wordpress}`);
  lines.push(`- Activated theme: ${activatedTheme}`);
  lines.push("");
  lines.push("Activated plugins:");

  const plugins = usedVersions.activated_plugins;
  if (!plugins || plugins.length === 0) {
    lines.push(`- (none found in ${sourceLabel})`);
  } else {
    for (const p of plugins) {
      lines.push(`- ${formatPluginNameAndVersion(p)}`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Convert the WP Site Health "Info" JSON (WP_Debug_Data::debug_data()) into the
 * UsedVersionsForTest shape.
 *
 * @param {string} wpSiteHealthInfoJsonText
 * @returns {UsedVersionsForTest}
 */
function extractUsedVersionsForTestFromWpSiteHealthInfo(
  wpSiteHealthInfoJsonText,
) {
  try {
    const report = JSON.parse(wpSiteHealthInfoJsonText);

    // WordPress version
    const wpCore = getOptionalField(report, "wp-core");
    const wpCoreFields = isRecord(wpCore) ? wpCore.fields : undefined;
    const wpVersionField = isRecord(wpCoreFields)
      ? getOptionalField(wpCoreFields, "version")
      : undefined;
    const wordpress = extractVersionPrefix(
      getOptionalFieldDebugOrValue(wpVersionField),
    );

    // PHP version
    const wpServer = getOptionalField(report, "wp-server");
    const wpServerFields = isRecord(wpServer) ? wpServer.fields : undefined;
    const phpField = isRecord(wpServerFields)
      ? getOptionalField(wpServerFields, "php_version")
      : undefined;
    const php = extractVersionPrefix(getOptionalFieldDebugOrValue(phpField));

    // Theme
    const wpActiveTheme = getOptionalField(report, "wp-active-theme");
    const wpActiveThemeFields = isRecord(wpActiveTheme)
      ? wpActiveTheme.fields
      : undefined;
    const themeNameField = isRecord(wpActiveThemeFields)
      ? getOptionalField(wpActiveThemeFields, "name")
      : undefined;
    const themeVersionField = isRecord(wpActiveThemeFields)
      ? getOptionalField(wpActiveThemeFields, "version")
      : undefined;

    const activated_theme = {
      name: getOptionalFieldDebugOrValue(themeNameField),
      version: extractVersionPrefix(
        getOptionalFieldDebugOrValue(themeVersionField),
      ),
    };

    // Plugins
    const wpPluginsActive = getOptionalField(report, "wp-plugins-active");
    const wpPluginsActiveFields = isRecord(wpPluginsActive)
      ? wpPluginsActive.fields
      : undefined;

    /** @type {Array<{ name: string, version?: string }>} */
    const activated_plugins = [];

    if (isRecord(wpPluginsActiveFields)) {
      for (const [name, field] of Object.entries(wpPluginsActiveFields)) {
        const trimmedName = typeof name === "string" ? name.trim() : "";
        if (!trimmedName) continue;
        const version = extractPluginVersionFromSiteHealthField(field);
        activated_plugins.push({ name: trimmedName, version });
      }
    }

    activated_plugins.sort((a, b) => a.name.localeCompare(b.name));

    return {
      php,
      wordpress,
      activated_theme,
      activated_plugins,
    };
  } catch {
    return {
      php: undefined,
      wordpress: undefined,
      activated_theme: { name: undefined, version: undefined },
      activated_plugins: [],
    };
  }
}

/**
 * Convenience wrapper for the E2E case where we want versions from the Site
 * Health "Info" report (WP_Debug_Data::debug_data()).
 *
 * @param {{ pluginName: string, wpSiteHealthInfoJsonText: string }} options
 * @returns {{ annotation: PlaywrightAnnotation, usedVersions: UsedVersionsForTest }}
 */
function buildUsedVersionsAnnotationFromWpSiteHealthInfo({
  pluginName,
  wpSiteHealthInfoJsonText,
}) {
  const usedVersions = extractUsedVersionsForTestFromWpSiteHealthInfo(
    wpSiteHealthInfoJsonText,
  );
  const description = formatUsedVersionsAnnotationTextWithSource({
    pluginName,
    usedVersions,
    sourceLabel: "wp-site-health-info.json",
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
  extractUsedVersionsForTestFromWpSiteHealthInfo,
  buildUsedVersionsAnnotationFromWpSiteHealthInfo,
  // Exported for reuse/tests.
  extractVersionPrefix,
};
