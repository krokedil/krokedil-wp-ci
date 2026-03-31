#!/usr/bin/env bash
set -euo pipefail

# get-plugin-meta.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Read .github/plugin-meta.json and expose key fields as GitHub Actions
#   outputs for downstream workflow steps.
#
# Inputs (env vars):
#   - GITHUB_OUTPUT: Path to the step output file (required).
#
# Outputs (GITHUB_OUTPUT):
#   - plugin_slug: Plugin slug from .github/plugin-meta.json (required field).
#   - distribution_platform: Optional distribution platform string.
#   - plugin_meta_json: Minified JSON contents of the metadata file.
#
# External dependencies:
#   - jq
#
# Behavior:
#   - Validates the metadata file exists and contains a slug.
#   - Emits outputs for downstream steps.
#
# Failure modes:
#   - Missing file, missing jq, or missing slug exits with code 1.
# ---------------------------------------------------------------------------

FILE=".github/plugin-meta.json"
if [ ! -f "$FILE" ]; then
  echo "::error::Missing $FILE" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "::error::'jq' not found on PATH" >&2
  exit 1
fi

slug=$(jq -r '.slug // empty' "$FILE")
if [ -z "$slug" ]; then
  echo "::error::Missing 'slug' in .github/plugin-meta.json" >&2
  exit 1
fi

distribution_platform=$(jq -r '.distributionPlatform // empty' "$FILE")
if [ -z "$distribution_platform" ]; then
  echo "::warning::Missing 'distributionPlatform' in .github/plugin-meta.json" >&2
fi

meta=$(jq -c '.' "$FILE")

{
  echo "plugin_slug=$slug"
  echo "distribution_platform=$distribution_platform"
  echo "plugin_meta_json=$meta"
} >> "$GITHUB_OUTPUT"