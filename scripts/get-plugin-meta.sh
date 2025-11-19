#!/usr/bin/env bash
set -euo pipefail

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

distribution_platform=$(jq -r '.["distribution-platform"] // empty' "$FILE")
if [ -z "$distribution_platform" ]; then
  echo "::warning::Missing 'distribution-platform' in .github/plugin-meta.json; proceeding without distribution-specific behavior" >&2
fi

meta=$(jq -c '.' "$FILE")

echo "plugin_slug=$slug" >> "$GITHUB_OUTPUT"
echo "distribution_platform=$distribution_platform" >> "$GITHUB_OUTPUT"
echo "plugin_meta_json=$meta" >> "$GITHUB_OUTPUT"