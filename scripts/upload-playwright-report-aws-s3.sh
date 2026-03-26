#!/usr/bin/env bash
set -euo pipefail

# upload-playwright-report-aws-s3.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Upload the Playwright HTML report directory to the shared S3 bucket,
#   served via a CloudFront distribution with htaccess auth.
#
# Inputs (env vars):
#   - GITHUB_REPOSITORY: GitHub repository (owner/repo), repo name extracted as folder prefix (required).
#   - GITHUB_RUN_ID: Unique GitHub Actions run ID for the folder path (required).
#   - PLAYWRIGHT_REPORT_DIR: Path to Playwright HTML report folder (optional).
#   - GITHUB_OUTPUT: Path to the step output file (required).
#
# Outputs (GITHUB_OUTPUT):
#   - playwright_report_url: CloudFront URL to the report index.html (empty if skipped).
#
# External dependencies:
#   - aws (AWS CLI)
#
# Behavior:
#   - Uploads the HTML report folder contents directly (not zipped) to the
#     krokedil-plugin-test-reports S3 bucket under a unique path using
#     the GitHub Actions run ID.
#   - Writes the CloudFront index.html URL to GITHUB_OUTPUT.
#   - If the report folder is missing, emits a notice and skips upload.
#
# Failure modes:
#   - Missing required env vars exits with code 1.
#   - Upload failures exit with code 1.
# ---------------------------------------------------------------------------

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
if [ -z "$GITHUB_REPOSITORY" ]; then
  echo "::error::GITHUB_REPOSITORY env not set" >&2
  exit 1
fi

GITHUB_RUN_ID="${GITHUB_RUN_ID:-}"
if [ -z "$GITHUB_RUN_ID" ]; then
  echo "::error::GITHUB_RUN_ID env not set" >&2
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

S3_BUCKET="krokedil-plugin-test-reports"
REPO_NAME="${GITHUB_REPOSITORY#*/}"
S3_PREFIX="${REPO_NAME}/${GITHUB_RUN_ID}"
aws s3 sync "$PLAYWRIGHT_REPORT_DIR" "s3://${S3_BUCKET}/${S3_PREFIX}" --delete

echo "playwright_report_url=https://d3o3efwqkax368.cloudfront.net/${S3_PREFIX}/index.html" >> "$GITHUB_OUTPUT"
