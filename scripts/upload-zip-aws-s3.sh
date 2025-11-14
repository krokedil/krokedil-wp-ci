#!/usr/bin/env bash
set -euo pipefail

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

# Expect ZIP_FILE_PATH from env (set by generate step)
ZIP_FILE_PATH="${ZIP_FILE_PATH:-}"
if [ -z "$ZIP_FILE_PATH" ]; then
  echo "::error::ZIP_FILE_PATH env not set (run generate step first)" >&2
  exit 1
fi

cd "$ZIP_FILE_PATH"
zip -r "../${ZIP_FILE_NAME}.zip" "${PLUGIN_SLUG}"
aws s3 cp "../${ZIP_FILE_NAME}.zip" "s3://krokedil-plugin-dev-zip/${ZIP_FILE_NAME}.zip"
echo "aws_s3_public_url=https://krokedil-plugin-dev-zip.s3.eu-north-1.amazonaws.com/${ZIP_FILE_NAME}.zip" >> $GITHUB_OUTPUT