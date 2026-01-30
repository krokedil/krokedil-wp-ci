#!/usr/bin/env bash
# Validate prepared plugin folder
# ---------------------------------------------------------------------------
# Purpose:
#   Verify that the prepared plugin folder exists and is mountable for tests
#   and packaging.
#
# Inputs (env vars):
#   - PLUGIN_SLUG (required): expected plugin slug used to build zipfile/<slug>.
#
# Behavior:
#   1) Check that zipfile/<slug> exists.
#   2) Check that zipfile/<slug>/<slug>.php exists.
#   3) Print helpful directory listings on failure.
#
# Failure modes:
#   - Exits non-zero if the folder or main plugin file is missing.

set -euo pipefail

if [[ -z "${PLUGIN_SLUG:-}" ]]; then
  echo "::error::PLUGIN_SLUG is required but was not provided."
  exit 1
fi

if [[ ! -d "zipfile/${PLUGIN_SLUG}" ]]; then
  echo "::error::Expected prepared plugin folder at zipfile/${PLUGIN_SLUG}, but it was not found."
  echo "Workspace root: $(pwd)"
  echo "Contents of workspace root:"
  ls -la
  echo "Contents of zipfile/:"
  ls -la zipfile || true
  exit 1
fi

if [[ ! -f "zipfile/${PLUGIN_SLUG}/${PLUGIN_SLUG}.php" ]]; then
  echo "::error::Missing expected plugin main file zipfile/${PLUGIN_SLUG}/${PLUGIN_SLUG}.php."
  echo "Top-level files under zipfile/${PLUGIN_SLUG} (first 200):"
  find "zipfile/${PLUGIN_SLUG}" -maxdepth 2 -type f | head -n 200
  exit 1
fi
