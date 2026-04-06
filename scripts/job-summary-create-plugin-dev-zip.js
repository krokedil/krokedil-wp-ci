#!/usr/bin/env node
/**
 * job-summary-create-plugin-dev-zip.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Produce a rich GitHub Actions Job Summary (and optional output variable)
 *   after building a development plugin zip.
 *
 * Inputs (env vars):
 *   - ZIP_FILE_NAME        : Base name (without .zip) of the generated dev zip.
 *   - AWS_S3_PUBLIC_URL    : Public S3 URL to the zip (optional; enables playground install).
 *   - PLAYWRIGHT_REPORT_URL: Public URL to the Playwright HTML report (optional).
 *                            When a Playwright JSON report exists at the expected path,
 *                            inline test results, environment info, and Krokedil composer
 *                            dependencies are rendered from it.
 *   - PLUGIN_META_JSON     : Raw JSON string with plugin metadata (optional). If present,
 *                            it may include overrides for:
 *                               playground.preferredVersions.wp (string)
 *                               playground.preferredVersions.php (string)
 *                               playground.landingPage (string)
 *   - GITHUB_STEP_SUMMARY  : Path to summary file (GitHub provides automatically).
 *
 * Outputs:
 *   - None (summary-only)
 *
 * Behavior:
 *   1. Reads metadata only if PLUGIN_META_JSON is set.
 *   2. Uses optional playground overrides from metadata when present.
 *   3. Builds a blueprint object, base64 encodes it, forms final URL (if AWS_S3_PUBLIC_URL is set).
 *   4. Writes a markdown summary with download link and (if available) playground link.
 *
 * Failure modes:
 *   - Malformed PLUGIN_META_JSON => log error & exit(1).
 *   - Missing AWS_S3_PUBLIC_URL => no Playground URL emitted.
 *   - Missing summary file path => prints to stdout instead (non-fatal).
 *
 * Safety/size:
 *   Blueprint JSON is base64 encoded directly. Keep steps minimal to avoid very large
 *   blueprint strings (WordPress Playground handles moderately sized blueprints well).
 *
 * ---------------------------------------------------------------------------
 */
const { loadMeta, getOptionalString } = require("./lib/plugin-meta");
const { writeJobSummary, buildPlaywrightSummaryMarkdown } = require("./lib/job-summary");
const {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
  getPresetVariables,
} = require("./lib/blueprint");

async function main() {
  // ---------------------------------------------------------------------------
  // Environment extraction & basic presence checks
  // ---------------------------------------------------------------------------
  const summaryFile = process.env.GITHUB_STEP_SUMMARY; // Where markdown summary is appended
  const ZIP_FILE_NAME = process.env.ZIP_FILE_NAME || ""; // Name of built zip (without .zip)
  const AWS_S3_PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL || ""; // Public URL to zip (optional)
  const PLAYWRIGHT_REPORT_URL = process.env.PLAYWRIGHT_REPORT_URL || ""; // Public URL to HTML report
  const rawMetaProvided = !!process.env.PLUGIN_META_JSON; // Whether plugin meta was supplied

  // ---------------------------------------------------------------------------
  // Parse metadata (only if provided). loadMeta throws if invalid JSON.
  // ---------------------------------------------------------------------------
  let META = {};
  if (rawMetaProvided) {
    try {
      META = loadMeta({ requireEnv: true });
    } catch (e) {
      console.error("Invalid PLUGIN_META_JSON:", e.message);
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Extract optional playground overrides from metadata.
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Construct minimal playground blueprint & URL if preconditions satisfied.
  // ---------------------------------------------------------------------------
  let PLAYGROUND_MINIMAL_URL = "";
  if (AWS_S3_PUBLIC_URL) {
    const pluginSlug = getOptionalString(META, "slug");

    // Start from the "minimal" preset, then layer on job-summary-specific vars.
    const blueprintVariables = {
      ...getPresetVariables(
        "minimal",
        { repoSlug: pluginSlug, pluginName },
        { configure_debug_logs: false },
      ),
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

  // ---------------------------------------------------------------------------
  // Compose summary markdown.
  // ---------------------------------------------------------------------------
  const lines = [];
  lines.push("# :package: Created dev zip");
  if (ZIP_FILE_NAME) {
    if (AWS_S3_PUBLIC_URL) {
      lines.push(
        "Download or share URL for created dev zip through the link below, which is available for 30 days:",
      );
      lines.push(`* [${ZIP_FILE_NAME}.zip](${AWS_S3_PUBLIC_URL})`);
    } else {
      lines.push("Dev zip created locally (no S3 upload requested). ");
      lines.push(`* ${ZIP_FILE_NAME}.zip`);
    }
  }
  lines.push(
    "\nDocumentation about how to install the dev zip can be found [here](https://docs.krokedil.com/krokedil-general-support-info/installing-a-development-version/).",
  );
  const playwrightSection = buildPlaywrightSummaryMarkdown({
    reportUrl: PLAYWRIGHT_REPORT_URL,
  });
  if (playwrightSection) {
    lines.push("\n" + playwrightSection);
  }
  const wpVersionDisplay = wpVersion || "beta";
  const phpVersionDisplay = phpVersion || "latest";

  if (PLAYGROUND_MINIMAL_URL) {
    lines.push("\n## Test dev zip manually");
    lines.push(
      "You can test the created dev zip directly in [WordPress Playground](https://wordpress.org/playground/), which is an experimental project and functionality can be limited, through the link below:",
    );
    lines.push(
      `* [Test dev zip using WordPress Playground](${PLAYGROUND_MINIMAL_URL}) (WP ${wpVersionDisplay}, PHP ${phpVersionDisplay}, WooCommerce and created dev zip)`,
    );
    lines.push(
      "\nAlso remember that the dev zip easily can be deployed to a new or existing InstaWP site through seperate workflows.",
    );
  } else if (rawMetaProvided && !AWS_S3_PUBLIC_URL) {
    lines.push("\n_Playground link skipped: missing AWS_S3_PUBLIC_URL._");
  }

  const markdownContent = lines.join("\n") + "\n";

  // ---------------------------------------------------------------------------
  // Write summary (or fallback to stdout if GITHUB_STEP_SUMMARY missing).
  // ---------------------------------------------------------------------------
  writeJobSummary({ summaryFile, markdownContent });
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
