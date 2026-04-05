#!/usr/bin/env bash
set -euo pipefail

# prepare-plugin-dev-zip.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Prepare a plugin dev zip payload and emit the computed zip file name.
#
# Inputs (env vars):
#   - PLUGIN_SLUG: Plugin slug (required).
#   - DISTRIBUTION_PLATFORM: Optional platform string (e.g. wordpress-org).
#   - ZIP_FILE_SUFFIX: Optional suffix (include leading dash yourself).
#   - GITHUB_REF_NAME/GITHUB_REF, GITHUB_SHA: Used to build the zip name.
#   - GITHUB_OUTPUT: Path to the step output file (required).
#
# Outputs (GITHUB_OUTPUT):
#   - zip_file_name: Computed dev zip base name (without .zip).
#
# External dependencies:
#   - sed
#   - rsync (non-wordpress-org packaging)
#   - npm (when package.json has build:prod)
#   - composer (when composer.json has build-prod)
#
# Behavior:
#   - Applies a dev version suffix to the main plugin file.
#   - Runs optional build steps when detected.
#   - For non-wordpress-org distributions, prepares a zipfile/ staging folder
#     honoring .distignore/.kernlignore.
#
# Failure modes:
#   - Missing PLUGIN_SLUG exits with code 1.
#   - Missing npm/composer when a build is required exits with code 1.
#
# Duplication note:
#   The build detection + version suffix logic (lines 61–83) is duplicated in
#   scripts/lib/build-plugin.js (used by playground.js for local dev).
#   Keep both in sync when changing build step detection rules.
# ---------------------------------------------------------------------------

# Expect PLUGIN_SLUG from env (set by get-plugin-meta.sh step)
PLUGIN_SLUG="${PLUGIN_SLUG:-}"
if [ -z "$PLUGIN_SLUG" ]; then
  echo "::error::PLUGIN_SLUG env not set (run get-plugin-meta.sh first)" >&2
  exit 1
fi

# Set DISTRIBUTION_PLATFORM from env (set by get-plugin-meta.sh step). Default to empty
# and continue, but log a warning if it's missing so callers can notice.
DISTRIBUTION_PLATFORM="${DISTRIBUTION_PLATFORM:-}"

# Optional ZIP suffix from env; empty if not provided.
# Only allow safe characters to prevent path traversal or shell injection.
ZIP_FILE_SUFFIX="${ZIP_FILE_SUFFIX:-}"
if [[ "$ZIP_FILE_SUFFIX" =~ [^A-Za-z0-9._-] ]]; then
  echo "::error::ZIP_FILE_SUFFIX contains invalid characters: ${ZIP_FILE_SUFFIX}" >&2
  exit 1
fi

# Generate zip file name
BRANCH_NAME="${GITHUB_REF_NAME:-${GITHUB_REF#refs/heads/}}"
BRANCH_SAFE="${BRANCH_NAME//[^A-Za-z0-9._-]/-}"
SHORT_SHA="${GITHUB_SHA:0:7}"
ZIP_FILE_NAME="${PLUGIN_SLUG}-dev-${BRANCH_SAFE}-${SHORT_SHA}${ZIP_FILE_SUFFIX}"

# Apply dev version suffix to plugin version in main plugin file
sed -i "s/^ \* Version: \(.*\)/ \* Version: \1-dev.${BRANCH_SAFE}.${SHORT_SHA}/" "${PLUGIN_SLUG}.php"

# Build step from Node or Composer
if [ -f package.json ] && grep -q '"build:prod"' package.json; then
  echo "Running npm build:prod" >&2
  if ! command -v npm >/dev/null 2>&1; then
    echo "::error::npm not found" >&2
    exit 1
  fi
  npm ci
  npm run build:prod
elif [ -f composer.json ] && grep -q '"build-prod"' composer.json; then
  echo "Running composer build-prod" >&2
  if ! command -v composer >/dev/null 2>&1; then
    echo "::error::composer not found" >&2
    exit 1
  fi
  composer install --no-dev --prefer-dist --no-progress
  composer run-script build-prod
else
  echo "No build script (npm build:prod or composer build-prod) found; skipping build step" >&2
fi

# If DISTRIBUTION_PLATFORM is not 'wordpress-org', run the following code
if [ "$DISTRIBUTION_PLATFORM" != "wordpress-org" ]; then
  echo "DISTRIBUTION_PLATFORM is set as \"${DISTRIBUTION_PLATFORM}\". Since it is not \"wordpress-org\", we will be preparing zip manually" >&2

  # Determine ignore file strategy: prefer .distignore, then .kernlignore, else no ignore file.
  IGNORE_ARG=()
  if [ -f .distignore ]; then
    echo "Found .distignore, so will be using that for rsync excludes" >&2
    IGNORE_ARG=(--exclude-from='.distignore')
  elif [ -f .kernlignore ]; then
    echo "Found .kernlignore, so will be using that for rsync excludes" >&2
    IGNORE_ARG=(--exclude-from='.kernlignore')
  else
    echo "No .distignore or .kernlignore found; rsync will not use an exclude-from file" >&2
  fi

  mkdir -p "zipfile/${PLUGIN_SLUG}"
  rsync -av "${IGNORE_ARG[@]}" --exclude='zipfile' . "zipfile/${PLUGIN_SLUG}"
fi

# Return zip file name
echo "zip_file_name=${ZIP_FILE_NAME}" >> "${GITHUB_OUTPUT}"
