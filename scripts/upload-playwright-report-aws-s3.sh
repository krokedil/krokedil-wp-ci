#!/usr/bin/env bash
set -euo pipefail

# upload-playwright-report-aws-s3.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Upload the Playwright HTML report directory to the shared S3 bucket.
#
# Inputs (env vars):
#   - ZIP_FILE_NAME: Base name (without .zip) for the dev zip (required).
#   - PLAYWRIGHT_REPORT_DIR: Path to Playwright HTML report folder (optional).
#   - GITHUB_OUTPUT: Path to the step output file (required).
#
# Outputs (GITHUB_OUTPUT):
#   - playwright_report_url: Public URL to the report index.html (empty if skipped).
#
# External dependencies:
#   - aws (AWS CLI)
#
# Behavior:
#   - Uploads the HTML report folder to the krokedil-plugin-dev-zip S3 bucket.
#   - Writes the public index.html URL to GITHUB_OUTPUT.
#   - If the report folder is missing, emits a notice and skips upload.
#
# Failure modes:
#   - Missing required env vars exits with code 1.
#   - Upload failures exit with code 1.
# ---------------------------------------------------------------------------

ZIP_FILE_NAME="${ZIP_FILE_NAME:-}"
if [ -z "$ZIP_FILE_NAME" ]; then
  echo "::error::ZIP_FILE_NAME env not set (run prepare step first)" >&2
  exit 1
fi

if [ -z "${GITHUB_OUTPUT:-}" ]; then
  echo "::error::GITHUB_OUTPUT env not set" >&2
  exit 1
fi

PLAYWRIGHT_REPORT_DIR="${PLAYWRIGHT_REPORT_DIR:-.github/krokedil-wp-ci/tests/plugin-dev-zip/test-results/end-to-end/html-report}"

if [ ! -d "$PLAYWRIGHT_REPORT_DIR" ]; then
  echo "::notice::Playwright HTML report not found at $PLAYWRIGHT_REPORT_DIR; skipping upload."
  echo "playwright_report_url=" >> "$GITHUB_OUTPUT"
  exit 0
fi

if [ ! -f "$PLAYWRIGHT_REPORT_DIR/index.html" ]; then
  echo "::notice::Playwright HTML report index.html missing at $PLAYWRIGHT_REPORT_DIR; skipping upload."
  echo "playwright_report_url=" >> "$GITHUB_OUTPUT"
  exit 0
fi

S3_PREFIX="reports/${ZIP_FILE_NAME}/playwright-html"
aws s3 sync "$PLAYWRIGHT_REPORT_DIR" "s3://krokedil-plugin-dev-zip/${S3_PREFIX}" --delete

echo "playwright_report_url=https://krokedil-plugin-dev-zip.s3.eu-north-1.amazonaws.com/${S3_PREFIX}/index.html" >> "$GITHUB_OUTPUT"
