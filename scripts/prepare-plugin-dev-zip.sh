#!/usr/bin/env bash
set -euo pipefail

# Expect PLUGIN_SLUG from env (set by get-plugin-meta.sh step)
PLUGIN_SLUG="${PLUGIN_SLUG:-}"
if [ -z "$PLUGIN_SLUG" ]; then
  echo "::error::PLUGIN_SLUG env not set (run get-plugin-meta.sh first)" >&2
  exit 1
fi

# Set DISTRIBUTION_PLATFORM from env (set by get-plugin-meta.sh step). Default to empty
# and continue, but log a warning if it's missing so callers can notice.
DISTRIBUTION_PLATFORM="${DISTRIBUTION_PLATFORM:-}"
if [ -z "$DISTRIBUTION_PLATFORM" ]; then
  echo "::warning::DISTRIBUTION_PLATFORM env not set; proceeding without distribution-specific behavior" >&2
fi

# Optional ZIP suffix from env; empty if not provided.
ZIP_FILE_SUFFIX="${ZIP_FILE_SUFFIX:-}"

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
  echo DISTRIBUTION_PLATFORM is "$DISTRIBUTION_PLATFORM", preparing zip manually >&2

  # Determine ignore file strategy: prefer .distignore, then .kernlignore, else no ignore file.
  IGNORE_ARG=()
  if [ -f .distignore ]; then
    echo "Using .distignore for rsync excludes" >&2
    IGNORE_ARG=(--exclude-from='.distignore')
  elif [ -f .kernlignore ]; then
    echo "Using .kernlignore for rsync excludes" >&2
    IGNORE_ARG=(--exclude-from='.kernlignore')
  else
    echo "No .distignore or .kernlignore found; rsync will not use an exclude-from file" >&2
  fi

  mkdir -p "zipfile/${PLUGIN_SLUG}"
  rsync -av "${IGNORE_ARG[@]}" --exclude='zipfile' . "zipfile/${PLUGIN_SLUG}"
fi

# Return zip file name
echo "zip_file_name=${ZIP_FILE_NAME}" >> "${GITHUB_OUTPUT}"
