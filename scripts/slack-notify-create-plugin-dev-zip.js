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
 *   - Writes a Slack Block Kit JSON payload to stdout (`blocks` array + `text` fallback).
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

// ---------------------------------------------------------------------------
// Slack Block Kit helpers

/** @param {string} text */
function headerBlock(text) {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

/** @param {string} mrkdwn */
function sectionBlock(mrkdwn) {
  return { type: "section", text: { type: "mrkdwn", text: mrkdwn } };
}

/**
 * Section block with two-column fields layout.
 * @param {Array<{ left: string, right: string }>} rows
 */
function fieldsBlock(rows) {
  const fields = [];
  for (const { left, right } of rows) {
    fields.push({ type: "mrkdwn", text: left });
    fields.push({ type: "mrkdwn", text: right });
  }
  return { type: "section", fields };
}

/** @param {string[]} mrkdwnElements */
function contextBlock(mrkdwnElements) {
  return {
    type: "context",
    elements: mrkdwnElements.map((t) => ({ type: "mrkdwn", text: t })),
  };
}

function dividerBlock() {
  return { type: "divider" };
}

// ---------------------------------------------------------------------------
// Playwright blocks for Slack

/**
 * Build Block Kit blocks for the Playwright test results section.
 * @param {{ reportUrl?: string }} options
 * @returns {object[]} Array of Slack blocks (may be empty).
 */
function buildPlaywrightBlocks({ reportUrl } = {}) {
  const report = tryLoadPlaywrightReport();

  if (!report) {
    if (reportUrl) {
      return [
        sectionBlock("*Playwright test results*"),
        sectionBlock(
          `For full testing details, view Playwright report <${reportUrl}|here> and/or download full e2e-test-reports artifact from this workflow run. Both are available for 7 days.`,
        ),
      ];
    }
    return [];
  }

  const stats = report.stats || {};
  const {
    phpVersions,
    testRows,
    firstUsedVersionsAnnotation,
    firstComposerDepsAnnotation,
  } = collectTestData(report);

  if (testRows.size === 0) {
    const blocks = [
      sectionBlock("*Playwright test results*\n\nNo test results found in the report."),
    ];
    if (reportUrl) {
      blocks.push(sectionBlock(`<${reportUrl}|View Playwright report>`));
    }
    return blocks;
  }

  const blocks = [];

  // Summary line
  const totalExpected = stats.expected || 0;
  const totalUnexpected = stats.unexpected || 0;
  const totalFlaky = stats.flaky || 0;
  const totalDuration = formatDuration(stats.duration || 0);
  const versionCount = phpVersions.length || 1;
  const versionWord = versionCount === 1 ? "version" : "versions";
  const phpListDisplay = phpVersions.length
    ? ` (${phpVersions.join(", ")})`
    : "";

  if (totalUnexpected > 0) {
    const parts = [];
    parts.push(`${totalExpected} passed`);
    if (totalFlaky > 0) parts.push(`${totalFlaky} flaky`);
    parts.push(`${totalUnexpected} failed`);
    blocks.push(
      sectionBlock(
        `*Playwright test results*\n${totalUnexpected} test${totalUnexpected === 1 ? "" : "s"} failed. ${parts.join(", ")} across ${versionCount} PHP ${versionWord}${phpListDisplay} in ${totalDuration}.`,
      ),
    );
  } else {
    const parts = [
      `${totalExpected} test${totalExpected === 1 ? "" : "s"} passed`,
    ];
    if (totalFlaky > 0) parts.push(`${totalFlaky} flaky`);
    blocks.push(
      sectionBlock(
        `*Playwright test results*\n${parts.join(", ")} across ${versionCount} PHP ${versionWord}${phpListDisplay} in ${totalDuration}.`,
      ),
    );
  }

  // Per-test results as two-column fields (test name left, status right).
  // Section fields blocks support max 10 fields (5 rows), so chunk if needed.
  const testFieldRows = [];
  const versions = phpVersions.length ? phpVersions : ["default"];
  for (const [specTitle, phpResults] of testRows) {
    const failedOn = [];
    const flakyOn = [];
    for (const v of versions) {
      const result = phpResults.get(v);
      if (!result) continue;
      if (result.status === "unexpected") failedOn.push(v);
      else if (result.status === "flaky") flakyOn.push(v);
    }

    let right;
    if (failedOn.length) {
      const detail = phpVersions.length
        ? `Failed on PHP ${failedOn.join(", ")}`
        : "Failed";
      right = `:x: ${detail}`;
    } else if (flakyOn.length) {
      const detail = phpVersions.length
        ? `Flaky on PHP ${flakyOn.join(", ")}`
        : "Flaky";
      right = `:warning: ${detail}`;
    } else {
      right = ":white_check_mark:";
    }
    testFieldRows.push({ left: escapeSlack(specTitle), right });
  }

  // Slack allows max 10 fields per block (= 5 rows of 2 columns).
  const ROWS_PER_BLOCK = 5;
  for (let i = 0; i < testFieldRows.length; i += ROWS_PER_BLOCK) {
    blocks.push(fieldsBlock(testFieldRows.slice(i, i + ROWS_PER_BLOCK)));
  }

  // Test environment
  const env = parseUsedVersionsAnnotation(firstUsedVersionsAnnotation);
  if (env && (env.wordpress || env.theme || env.plugins.length)) {
    const envLines = [];
    if (env.wordpress) envLines.push(`WordPress: ${escapeSlack(env.wordpress)}`);
    if (env.theme) envLines.push(`Theme: ${escapeSlack(env.theme)}`);
    for (const plugin of env.plugins) {
      envLines.push(
        `${escapeSlack(plugin.name)}: ${escapeSlack(plugin.version)}`,
      );
    }
    blocks.push(contextBlock(envLines));
  }

  // Composer deps
  const composerDeps = parseComposerDepsAnnotation(
    firstComposerDepsAnnotation,
  );
  if (composerDeps.length) {
    const depLines = [];
    for (const { pluginSlug, packages } of composerDeps) {
      depLines.push(`*${escapeSlack(pluginSlug)}:*`);
      for (const pkg of packages) {
        depLines.push(
          `${escapeSlack(pkg.name)}: ${escapeSlack(pkg.version)}`,
        );
      }
    }
    blocks.push(contextBlock(depLines));
  }

  // HTML report link and artifact note
  if (reportUrl) {
    blocks.push(
      sectionBlock(
        `For full testing details, view Playwright report <${reportUrl}|here> and/or download full e2e-test-reports artifact from this workflow run. Both are available for 7 days.`,
      ),
    );
  }

  return blocks;
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

  // Compose Slack Block Kit payload
  const blocks = [];

  // Created dev zip — only real header + divider in the message
  blocks.push(headerBlock(":package: Created dev zip"));
  blocks.push(dividerBlock());
  if (ZIP_FILE_NAME) {
    if (AWS_S3_PUBLIC_URL) {
      blocks.push(
        sectionBlock(
          `Download or share URL for created dev zip through the link below, which is available for 30 days:\n• <${AWS_S3_PUBLIC_URL}|${escapeSlack(ZIP_FILE_NAME)}.zip>`,
        ),
      );
    } else {
      blocks.push(
        sectionBlock(
          `Dev zip created locally (no S3 upload requested).\n• ${escapeSlack(ZIP_FILE_NAME)}.zip`,
        ),
      );
    }
  }
  blocks.push(
    sectionBlock(
      `Documentation about how to install the dev zip can be found <https://docs.krokedil.com/krokedil-general-support-info/installing-a-development-version/|here>.`,
    ),
  );

  // Playwright section
  const playwrightBlocks = buildPlaywrightBlocks({
    reportUrl: PLAYWRIGHT_REPORT_URL,
  });
  blocks.push(...playwrightBlocks);

  // Playground link
  const wpVersionDisplay = wpVersion || "beta";
  const phpVersionDisplay = phpVersion || "latest";
  if (PLAYGROUND_MINIMAL_URL) {
    blocks.push(
      sectionBlock(
        `*Test dev zip using WordPress Playground (experimental)*\nYou can test the created dev zip directly in <https://wordpress.org/playground/|WordPress Playground>, which is an experimental project and functionality can be limited, through the links below:\n• <${PLAYGROUND_MINIMAL_URL}|Test dev zip using WordPress Playground> (WP ${wpVersionDisplay}, PHP ${phpVersionDisplay}, WooCommerce and created dev zip)`,
      ),
    );
  }

  // Triggered by workflow run (always last)
  if (WORKFLOW_RUN_URL) {
    blocks.push(
      contextBlock([`_Triggered by workflow run:_ ${WORKFLOW_RUN_URL}`]),
    );
  }

  // Build payload with text fallback for notifications/previews
  const fallbackText = ZIP_FILE_NAME
    ? `Created dev zip: ${ZIP_FILE_NAME}.zip`
    : "Created dev zip";
  const payload = JSON.stringify({ text: fallbackText, blocks });
  process.stdout.write(payload);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
