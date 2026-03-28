// playwright-results.js
// ---------------------------------------------------------------------------
// Purpose
//   Parse the Playwright JSON report and build a rich markdown section for the
//   GitHub Actions job summary, including test results table, environment info,
//   and Krokedil composer dependencies.
//
// Inputs
//   - reportUrl (optional): public URL to the Playwright HTML report
//   - JSON report file: auto-resolved relative to this file's location
//
// Behavior
//   1. Attempts to load and parse the Playwright JSON report.
//   2. Walks the nested suite tree to collect per-spec, per-PHP-version results.
//   3. Extracts environment info from the "used-versions" annotation.
//   4. Extracts Krokedil composer deps from the "composer-krokedil-deps" annotation.
//   5. Assembles a markdown string with summary, results table, environment table,
//      composer deps table, and collapsible HTML report link.
//
// Failure modes
//   - Missing or corrupt JSON report: returns fallback link-only markdown (if
//     reportUrl is available) or null.
//   - Missing annotations: respective sections are omitted gracefully.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// JSON report loading

const REPORT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "tests",
  "plugin-dev-zip",
  "test-results",
  "end-to-end",
  "json-report",
  "report.json",
);

/**
 * Load and parse the Playwright JSON report.
 * @returns {object | null} Parsed report or null on any error.
 */
function tryLoadPlaywrightReport() {
  try {
    if (!fs.existsSync(REPORT_PATH)) return null;
    const text = fs.readFileSync(REPORT_PATH, "utf8");
    return JSON.parse(text);
  } catch (e) {
    console.warn("Could not load Playwright JSON report:", e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Suite walking

/**
 * @typedef {Object} TestResult
 * @property {string} status - "expected", "unexpected", or "flaky"
 * @property {number} durationMs - duration of the final result in ms
 */

/**
 * Recursively walk suites to collect test results and annotations.
 *
 * @param {object} report - Parsed Playwright JSON report
 * @returns {{
 *   phpVersions: string[],
 *   testRows: Map<string, Map<string, TestResult>>,
 *   firstUsedVersionsAnnotation: string | null,
 *   firstComposerDepsAnnotation: string | null,
 * }}
 */
function collectTestData(report) {
  // Determine PHP version order from config.projects
  const phpVersions = (report.config?.projects || [])
    .map((p) => p.name)
    .filter(Boolean);

  /** @type {Map<string, Map<string, TestResult>>} specTitle -> phpVersion -> result */
  const testRows = new Map();

  /** @type {string | null} */
  let firstUsedVersionsAnnotation = null;
  /** @type {string | null} */
  let firstComposerDepsAnnotation = null;

  /**
   * @param {object} suite
   * @param {string} parentTitle
   */
  function walkSuite(suite, parentTitle) {
    const suiteTitle = parentTitle
      ? suite.title
        ? `${parentTitle} > ${suite.title}`
        : parentTitle
      : suite.title || "";

    for (const spec of suite.specs || []) {
      const specTitle = spec.title || "(unnamed)";

      for (const test of spec.tests || []) {
        const phpVersion = test.projectName || "default";

        // Pick duration from the last result (final attempt after retries).
        const results = test.results || [];
        const lastResult = results[results.length - 1];
        const durationMs = lastResult?.duration ?? 0;

        if (!testRows.has(specTitle)) {
          testRows.set(specTitle, new Map());
        }
        testRows.get(specTitle).set(phpVersion, {
          status: test.status || "unknown",
          durationMs,
        });

        // Capture first annotations we find.
        for (const ann of test.annotations || []) {
          if (
            ann.type === "used-versions" &&
            !firstUsedVersionsAnnotation &&
            ann.description
          ) {
            firstUsedVersionsAnnotation = ann.description;
          }
          if (
            ann.type === "composer-krokedil-deps" &&
            !firstComposerDepsAnnotation &&
            ann.description
          ) {
            firstComposerDepsAnnotation = ann.description;
          }
        }
      }
    }

    for (const child of suite.suites || []) {
      walkSuite(child, suiteTitle);
    }
  }

  for (const suite of report.suites || []) {
    walkSuite(suite, "");
  }

  return {
    phpVersions,
    testRows,
    firstUsedVersionsAnnotation,
    firstComposerDepsAnnotation,
  };
}

// ---------------------------------------------------------------------------
// Annotation parsing

/**
 * Parse the "used-versions" annotation text into structured data.
 *
 * Expected format:
 *   This plugin dev zip e2e test for the plugin "Name" used the following versions:
 *   - PHP: 8.3.30
 *   - WordPress: 6.9.4
 *   - Activated theme: Storefront (storefront) (4.6.2)
 *
 *   Activated plugins:
 *   - Plugin Name: 1.2.3
 *
 * @param {string} text
 * @returns {{ wordpress?: string, theme?: string, plugins: Array<{ name: string, version: string }> } | null}
 */
function parseUsedVersionsAnnotation(text) {
  if (!text) return null;

  const lines = text.split("\n");

  let wordpress;
  let theme;
  /** @type {Array<{ name: string, version: string }>} */
  const plugins = [];
  let inPlugins = false;

  for (const line of lines) {
    const trimmed = line.trim();

    const wpMatch = trimmed.match(/^- WordPress:\s*(.+)/);
    if (wpMatch) {
      wordpress = wpMatch[1].trim();
      continue;
    }

    const themeMatch = trimmed.match(/^- Activated theme:\s*(.+)/);
    if (themeMatch) {
      theme = themeMatch[1].trim();
      continue;
    }

    if (trimmed === "Activated plugins:") {
      inPlugins = true;
      continue;
    }

    if (inPlugins && trimmed.startsWith("- ")) {
      const pluginText = trimmed.slice(2);
      const colonIdx = pluginText.lastIndexOf(":");
      if (colonIdx > 0) {
        plugins.push({
          name: pluginText.slice(0, colonIdx).trim(),
          version: pluginText.slice(colonIdx + 1).trim(),
        });
      }
    }
  }

  return { wordpress, theme, plugins };
}

/**
 * Parse the "composer-krokedil-deps" annotation text.
 *
 * Expected format:
 *   Krokedil composer dependencies:
 *
 *   plugin-slug:
 *   - krokedil/package: 1.2.3
 *
 * @param {string} text
 * @returns {Array<{ pluginSlug: string, packages: Array<{ name: string, version: string }> }>}
 */
function parseComposerDepsAnnotation(text) {
  if (!text) return [];

  const lines = text.split("\n");
  /** @type {Array<{ pluginSlug: string, packages: Array<{ name: string, version: string }> }>} */
  const results = [];
  /** @type {{ pluginSlug: string, packages: Array<{ name: string, version: string }> } | null} */
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header line
    if (trimmed === "Krokedil composer dependencies:") continue;
    if (!trimmed) continue;

    // Plugin slug line: "plugin-slug:"
    if (trimmed.endsWith(":") && !trimmed.startsWith("- ")) {
      if (current && current.packages.length) {
        results.push(current);
      }
      current = { pluginSlug: trimmed.slice(0, -1), packages: [] };
      continue;
    }

    // Package line: "- krokedil/package: 1.2.3"
    if (trimmed.startsWith("- ") && current) {
      const pkgText = trimmed.slice(2);
      const colonIdx = pkgText.lastIndexOf(":");
      if (colonIdx > 0) {
        current.packages.push({
          name: pkgText.slice(0, colonIdx).trim(),
          version: pkgText.slice(colonIdx + 1).trim(),
        });
      }
    }
  }

  if (current && current.packages.length) {
    results.push(current);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatting helpers

/**
 * Format milliseconds into a human-readable duration string.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) return "< 1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Format a test cell value for the markdown table.
 * @param {TestResult | undefined} result
 * @returns {string}
 */
function formatTestCell(result) {
  if (!result) return "-";
  if (result.status === "expected")
    return `:white_check_mark: ${formatDuration(result.durationMs)}`;
  if (result.status === "flaky")
    return `:warning: ${formatDuration(result.durationMs)}`;
  return ":x:";
}

// ---------------------------------------------------------------------------
// Markdown assembly

/**
 * Build the complete Playwright summary markdown section.
 *
 * @param {{ reportUrl?: string }} options
 * @returns {string | null} Markdown string or null if nothing to show.
 */
function buildPlaywrightSummaryMarkdown({ reportUrl } = {}) {
  const report = tryLoadPlaywrightReport();

  // No JSON report available — fall back to link-only or nothing.
  if (!report) {
    if (reportUrl) {
      return [
        "## Playwright HTML report",
        "View the Playwright test report through the link below, which is available for 8 days:",
        `* [View Playwright report](${reportUrl})`,
      ].join("\n");
    }
    return null;
  }

  const stats = report.stats || {};
  const {
    phpVersions,
    testRows,
    firstUsedVersionsAnnotation,
    firstComposerDepsAnnotation,
  } = collectTestData(report);

  // If no tests were found at all, show a note.
  if (testRows.size === 0) {
    const lines = [
      "## Basic dev zip e2e test results",
      "",
      "No test results found in the report.",
    ];
    if (reportUrl) {
      lines.push("");
      lines.push(`[View Playwright report](${reportUrl})`);
    }
    return lines.join("\n");
  }

  const lines = [];

  // -------------------------------------------------------------------------
  // Summary line
  // -------------------------------------------------------------------------
  lines.push("## Basic dev zip e2e test results");
  lines.push("");

  const totalExpected = stats.expected || 0;
  const totalUnexpected = stats.unexpected || 0;
  const totalFlaky = stats.flaky || 0;
  const totalDuration = formatDuration(stats.duration || 0);
  const versionCount = phpVersions.length || 1;
  const versionWord = versionCount === 1 ? "version" : "versions";

  if (totalUnexpected > 0) {
    const parts = [];
    parts.push(`${totalExpected} passed`);
    if (totalFlaky > 0) parts.push(`${totalFlaky} flaky`);
    parts.push(`${totalUnexpected} failed`);
    lines.push("> [!CAUTION]");
    lines.push(
      `> ${totalUnexpected} test${totalUnexpected === 1 ? "" : "s"} failed. ${parts.join(", ")} across ${versionCount} PHP ${versionWord} in ${totalDuration}.`,
    );
  } else {
    const parts = [
      `${totalExpected} test${totalExpected === 1 ? "" : "s"} passed`,
    ];
    if (totalFlaky > 0) parts.push(`${totalFlaky} flaky`);
    lines.push(
      `${parts.join(", ")} across ${versionCount} PHP ${versionWord} in ${totalDuration}.`,
    );
  }

  // -------------------------------------------------------------------------
  // Results table
  // -------------------------------------------------------------------------
  lines.push("");

  const phpHeaders = phpVersions.length
    ? phpVersions.map((v) => `PHP ${v}`)
    : ["Result"];
  lines.push(`| Test | ${phpHeaders.join(" | ")} |`);
  lines.push(`| :--- | ${phpHeaders.map(() => ":---:").join(" | ")} |`);

  for (const [specTitle, phpResults] of testRows) {
    const cells = (phpVersions.length ? phpVersions : ["default"]).map((v) =>
      formatTestCell(phpResults.get(v)),
    );
    lines.push(`| ${specTitle} | ${cells.join(" | ")} |`);
  }

  // -------------------------------------------------------------------------
  // Test environment table
  // -------------------------------------------------------------------------
  const env = parseUsedVersionsAnnotation(firstUsedVersionsAnnotation);
  if (env && (env.wordpress || env.theme || env.plugins.length)) {
    lines.push("");
    lines.push("### Test environment");
    lines.push("");
    lines.push("| | Version |");
    lines.push("| :--- | :--- |");

    if (env.wordpress) {
      lines.push(`| WordPress | ${env.wordpress} |`);
    }
    if (env.theme) {
      lines.push(`| Theme | ${env.theme} |`);
    }
    for (const plugin of env.plugins) {
      lines.push(`| ${plugin.name} | ${plugin.version} |`);
    }
  }

  // -------------------------------------------------------------------------
  // Krokedil composer dependencies
  // -------------------------------------------------------------------------
  const composerDeps = parseComposerDepsAnnotation(firstComposerDepsAnnotation);
  if (composerDeps.length) {
    lines.push("");
    lines.push("### Krokedil composer dependencies");

    for (const { pluginSlug, packages } of composerDeps) {
      lines.push("");
      lines.push(`**${pluginSlug}:**`);
      lines.push("");
      lines.push("| Package | Version |");
      lines.push("| :--- | :--- |");
      for (const pkg of packages) {
        lines.push(`| ${pkg.name} | ${pkg.version} |`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // HTML report link
  // -------------------------------------------------------------------------
  if (reportUrl) {
    lines.push("");
    lines.push(
      `For full testing details, [view Playwright report here](${reportUrl}) and/or download full e2e-test-reports artifact from this workflow run. Both are available for 7 days.`,
    );
  }

  return lines.join("\n");
}

module.exports = {
  buildPlaywrightSummaryMarkdown,
  // Exported for testing.
  tryLoadPlaywrightReport,
  collectTestData,
  parseUsedVersionsAnnotation,
  parseComposerDepsAnnotation,
  formatDuration,
};
