#!/usr/bin/env node
/**
 * job-summary-deploy-plugin-dev-zip-instawp.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Produce a concise GitHub Actions Job Summary after deploying a dev zip
 *   to an InstaWP site (either existing or newly created).
 *
 * Inputs (environment variables):
 *   - INSTAWP_SITE_URL     : URL of the InstaWP site that received the dev zip.
 *   - INSTAWP_SITE_ID      : InstaWP internal site id (for dashboard link).
 *   - INSTAWP_SITE_CREATED : 'true' if a new site was created, otherwise 'false'
 *                            or empty (interpreted as existing site).
 *   - GITHUB_STEP_SUMMARY  : Path to summary file (GitHub provides automatically).
 *
 * Behavior:
 *   1. Reads site information from environment.
 *   2. Determines whether the site is new or existing.
 *   3. Writes a short markdown summary with a link to the InstaWP site and its
 *      dashboard.
 *
 * Failure Modes:
 *   - Missing GITHUB_STEP_SUMMARY => prints summary to stdout instead (non-fatal).
 *   - Missing siteUrl or siteId   => logs a warning but still exits 0.
 *
 * ---------------------------------------------------------------------------
 */

const fs = require("fs");

// ---------------------------------------------------------------------------
// Environment extraction & basic presence checks
// ---------------------------------------------------------------------------
const summaryFile = process.env.GITHUB_STEP_SUMMARY || "";
const siteUrl = process.env.INSTAWP_SITE_URL || "";
const siteId = process.env.INSTAWP_SITE_ID || "";
const siteCreated = process.env.INSTAWP_SITE_CREATED || "";
const siteNewOrExisting = siteCreated === "true" ? "new" : "existing";

if (!siteUrl || !siteId) {
  console.warn(
    "[summary] Missing INSTAWP_SITE_URL or INSTAWP_SITE_ID; summary will be minimal."
  );
}

// ---------------------------------------------------------------------------
// Compose summary markdown.
// ---------------------------------------------------------------------------
const lines = [];
lines.push("# Deploy to InstaWP");

if (siteUrl && siteId) {
  lines.push(
    `Dev zip has been deployed to a ${siteNewOrExisting} InstaWP site ` +
      `[${siteUrl}](${siteUrl}) ` +
      `([InstaWP dashboard link](https://app.instawp.io/sites/${siteId}/dashboard?tab=all)).`
  );
} else {
  lines.push(
    "Dev zip deployment to InstaWP completed, but site details were not fully available."
  );
}

const markdownContent = lines.join("\n") + "\n";

// ---------------------------------------------------------------------------
// Write summary (or fallback to stdout if GITHUB_STEP_SUMMARY missing).
// ---------------------------------------------------------------------------
if (summaryFile) {
  try {
    fs.appendFileSync(summaryFile, markdownContent);
    console.log("Summary written.");
  } catch (e) {
    console.error("Failed writing summary:", e.message);
  }
} else {
  console.warn("GITHUB_STEP_SUMMARY not set; printing summary to stdout");
  console.log(markdownContent);
}
