#!/usr/bin/env node
/**
 * slack-notify-create-plugin-dev-zip.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Produce a Slack webhook JSON payload summarising the plugin dev zip build
 *   and Playwright test results. The payload is written to stdout so the
 *   calling workflow step can capture and POST it to a Slack incoming webhook.
 *
 * Inputs (env vars):
 *   - ZIP_FILE_NAME        : Base name (without .zip) of the generated dev zip.
 *   - AWS_S3_PUBLIC_URL    : Public S3 URL to the zip (optional).
 *   - PLAYWRIGHT_REPORT_URL: Public URL to the Playwright HTML report (optional).
 *   - PLUGIN_META_JSON     : Raw JSON string with plugin metadata (optional).
 *   - WORKFLOW_RUN_URL     : URL to the GitHub Actions workflow run that triggered this.
 *
 * Outputs:
 *   - Writes a JSON object `{ "text": "..." }` to stdout.
 *
 * Behavior:
 *   1. Reads the same data sources as job-summary-create-plugin-dev-zip.js.
 *   2. Formats the content for Slack mrkdwn (not GitHub markdown).
 *   3. Appends a "Triggered by workflow run" link at the end.
 *
 * Failure modes:
 *   - Malformed PLUGIN_META_JSON => log error & exit(1).
 *   - Missing optional env vars => respective sections are omitted.
 *
 * ---------------------------------------------------------------------------
 */
const { loadMeta, getOptionalString } = require("./lib/plugin-meta");
const {
  tryLoadPlaywrightReport,
  collectTestData,
  parseUsedVersionsAnnotation,
  parseComposerDepsAnnotation,
  formatDuration,
} = require("./lib/job-summary/playwright-results");
const {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
} = require("./lib/playground");

// ---------------------------------------------------------------------------
// Slack mrkdwn helpers

/**
 * Escape characters that have special meaning in Slack mrkdwn.
 * @param {string} text
 * @returns {string}
 */
function escapeSlack(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Format a test result cell for Slack (emoji + duration).
 * @param {{ status: string, durationMs: number } | undefined} result
 * @returns {string}
 */
function formatSlackTestResult(result) {
  if (!result) return "-";
  if (result.status === "expected")
    return `:white_check_mark: ${formatDuration(result.durationMs)}`;
  if (result.status === "flaky")
    return `:warning: ${formatDuration(result.durationMs)}`;
  return ":x:";
}

// ---------------------------------------------------------------------------
// Playwright section for Slack

/**
 * Build the Playwright test results section formatted for Slack mrkdwn.
 * @param {{ reportUrl?: string }} options
 * @returns {string | null}
 */
function buildPlaywrightSlackSection({ reportUrl } = {}) {
  const report = tryLoadPlaywrightReport();

  if (!report) {
    if (reportUrl) {
      return [
        "*Playwright HTML report*",
        `<${reportUrl}|View Playwright report> (available 8 days)`,
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

  if (testRows.size === 0) {
    const parts = ["*Playwright test results*", "", "No test results found in the report."];
    if (reportUrl) {
      parts.push(`<${reportUrl}|View Playwright report>`);
    }
    return parts.join("\n");
  }

  const lines = [];

  // Summary line
  lines.push("*Playwright test results*");

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
    lines.push(
      `:rotating_light: ${totalUnexpected} test${totalUnexpected === 1 ? "" : "s"} failed. ${parts.join(", ")} across ${versionCount} PHP ${versionWord} in ${totalDuration}.`,
    );
  } else {
    const parts = [
      `${totalExpected} test${totalExpected === 1 ? "" : "s"} passed`,
    ];
    if (totalFlaky > 0) parts.push(`${totalFlaky} flaky`);
    lines.push(
      `:white_check_mark: ${parts.join(", ")} across ${versionCount} PHP ${versionWord} in ${totalDuration}.`,
    );
  }

  // Per-test results as bulleted list
  lines.push("");
  const versions = phpVersions.length ? phpVersions : ["default"];
  for (const [specTitle, phpResults] of testRows) {
    const cells = versions.map((v) => {
      const label = phpVersions.length ? `PHP ${v}` : "";
      const result = formatSlackTestResult(phpResults.get(v));
      return label ? `${label} ${result}` : result;
    });
    lines.push(`• ${escapeSlack(specTitle)}: ${cells.join(", ")}`);
  }

  // Test environment
  const env = parseUsedVersionsAnnotation(firstUsedVersionsAnnotation);
  if (env && (env.wordpress || env.theme || env.plugins.length)) {
    lines.push("");
    lines.push("*Test environment*");
    if (env.wordpress) lines.push(`• WordPress: ${escapeSlack(env.wordpress)}`);
    if (env.theme) lines.push(`• Theme: ${escapeSlack(env.theme)}`);
    for (const plugin of env.plugins) {
      lines.push(
        `• ${escapeSlack(plugin.name)}: ${escapeSlack(plugin.version)}`,
      );
    }
  }

  // Composer deps
  const composerDeps = parseComposerDepsAnnotation(
    firstComposerDepsAnnotation,
  );
  if (composerDeps.length) {
    lines.push("");
    lines.push("*Krokedil composer dependencies*");
    for (const { pluginSlug, packages } of composerDeps) {
      lines.push(`_${escapeSlack(pluginSlug)}:_`);
      for (const pkg of packages) {
        lines.push(
          `• ${escapeSlack(pkg.name)}: ${escapeSlack(pkg.version)}`,
        );
      }
    }
  }

  // HTML report link
  if (reportUrl) {
    lines.push("");
    lines.push(`<${reportUrl}|View Playwright HTML report> (available 8 days)`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main

async function main() {
  const ZIP_FILE_NAME = process.env.ZIP_FILE_NAME || "";
  const AWS_S3_PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL || "";
  const PLAYWRIGHT_REPORT_URL = process.env.PLAYWRIGHT_REPORT_URL || "";
  const WORKFLOW_RUN_URL = process.env.WORKFLOW_RUN_URL || "";
  const rawMetaProvided = !!process.env.PLUGIN_META_JSON;

  // Parse metadata
  let META = {};
  if (rawMetaProvided) {
    try {
      META = loadMeta({ requireEnv: true });
    } catch (e) {
      console.error("Invalid PLUGIN_META_JSON:", e.message);
      process.exit(1);
    }
  }

  // Extract optional playground overrides
  let pluginName;
  let wpVersion;
  let phpVersion;
  let landingPage;
  if (rawMetaProvided) {
    pluginName = getOptionalString(META, "name");
    wpVersion = getOptionalString(META, "playground.preferredVersions.wp");
    phpVersion = getOptionalString(META, "playground.preferredVersions.php");
    landingPage = getOptionalString(META, "playground.landingPage");
  }

  // Construct playground URL if preconditions met
  let PLAYGROUND_MINIMAL_URL = "";
  if (AWS_S3_PUBLIC_URL) {
    const blueprintVariables = {
      blogname: pluginName ? `${pluginName} dev zip` : "Plugin dev zip",
      install_woocommerce: true,
      install_wc_beta_tester: true,
      plugin_dev_zip_aws_s3_public_url: AWS_S3_PUBLIC_URL,
    };

    if (phpVersion) blueprintVariables.php_version = phpVersion;
    if (wpVersion) blueprintVariables.wp_version = wpVersion;
    if (landingPage) blueprintVariables.landing_page = landingPage;

    const builder = new BlueprintBuilder(
      blueprintVariables,
      applyKrokedilBlueprintTemplate,
    );

    PLAYGROUND_MINIMAL_URL = await builder.generateUrl();
  }

  // Compose Slack mrkdwn message
  const lines = [];
  lines.push("*Created dev zip*");
  if (ZIP_FILE_NAME) {
    if (AWS_S3_PUBLIC_URL) {
      lines.push(
        "Download or share URL (available 30 days):",
      );
      lines.push(`• <${AWS_S3_PUBLIC_URL}|${escapeSlack(ZIP_FILE_NAME)}.zip>`);
    } else {
      lines.push("Dev zip created locally (no S3 upload requested).");
      lines.push(`• ${escapeSlack(ZIP_FILE_NAME)}.zip`);
    }
  }
  lines.push(
    `\n<https://docs.krokedil.com/krokedil-general-support-info/installing-a-development-version/|How to install the dev zip>`,
  );

  // Playwright section
  const playwrightSection = buildPlaywrightSlackSection({
    reportUrl: PLAYWRIGHT_REPORT_URL,
  });
  if (playwrightSection) {
    lines.push("\n" + playwrightSection);
  }

  // Playground link
  const wpVersionDisplay = wpVersion || "beta";
  const phpVersionDisplay = phpVersion || "latest";
  if (PLAYGROUND_MINIMAL_URL) {
    lines.push("\n*Test dev zip using WordPress Playground*");
    lines.push(
      `• <${PLAYGROUND_MINIMAL_URL}|Test in Playground> (WP ${wpVersionDisplay}, PHP ${phpVersionDisplay}, WooCommerce and created dev zip)`,
    );
  }

  // Triggered by workflow run (always last)
  if (WORKFLOW_RUN_URL) {
    lines.push(`\n_Triggered by workflow run:_ ${WORKFLOW_RUN_URL}`);
  }

  const text = lines.join("\n");
  const payload = JSON.stringify({ text });
  process.stdout.write(payload);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
