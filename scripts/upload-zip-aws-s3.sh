#!/usr/bin/env bash
set -euo pipefail

# upload-zip-aws-s3.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Zip the prepared plugin payload and upload it to the shared S3 bucket.
#
# Inputs (env vars):
#   - PLUGIN_SLUG: Plugin slug (required).
#   - ZIP_FILE_NAME: Base name (without .zip) for the archive (required).
#   - GITHUB_OUTPUT: Path to the step output file (required).
#
# Outputs (GITHUB_OUTPUT):
#   - aws_s3_public_url: Public URL to the uploaded zip.
#
# External dependencies:
#   - zip
#   - aws (AWS CLI)
#
# Behavior:
#   - Zips zipfile/<PLUGIN_SLUG> into <ZIP_FILE_NAME>.zip
#   - Uploads the archive to the krokedil-plugin-dev-zip S3 bucket.
#
# Failure modes:
#   - Missing required env vars exits with code 1.
#   - Missing zip/aws CLI or upload failures exit with code 1.
# ---------------------------------------------------------------------------

# Expect PLUGIN_SLUG from env (set by meta step)
PLUGIN_SLUG="${PLUGIN_SLUG:-}"
if [ -z "$PLUGIN_SLUG" ]; then
  echo "::error::PLUGIN_SLUG env not set (run meta step first)" >&2
  exit 1
fi

# Expect ZIP_FILE_NAME from env (set by prepare step)
ZIP_FILE_NAME="${ZIP_FILE_NAME:-}"
if [ -z "$ZIP_FILE_NAME" ]; then
  echo "::error::ZIP_FILE_NAME env not set (run prepare step first)" >&2
  exit 1
fi

cd "zipfile"
zip -r "../${ZIP_FILE_NAME}.zip" "${PLUGIN_SLUG}"
aws s3 cp "../${ZIP_FILE_NAME}.zip" "s3://krokedil-plugin-dev-zip/${ZIP_FILE_NAME}.zip"
echo "aws_s3_public_url=https://krokedil-plugin-dev-zip.s3.eu-north-1.amazonaws.com/${ZIP_FILE_NAME}.zip" >> "$GITHUB_OUTPUT"
