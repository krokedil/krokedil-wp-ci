#!/bin/bash
set -euo pipefail

# apply-blueprint.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Downloads WordPress's `blueprints.phar` and applies a WooCommerce blueprint
#   to an existing InstaWP site using the PHP toolkit (mode: apply-to-existing-site).
#
# Inputs (env vars):
#   - BLUEPRINT_JSON_PATH : Local path to a blueprint JSON file on this server.
#                           If set and file exists, the curl download is skipped.
#   - BLUEPRINT_JSON_URL  : Public URL to download blueprint JSON from.
#                           Used as fallback when BLUEPRINT_JSON_PATH is not set.
#                           One of these two must be provided.
#   - SITE_PATH           : WordPress root directory (auto-detected via WP-CLI if omitted).
#   - SITE_BASE           : Parent of the WordPress root (defaults to dirname of SITE_PATH).
#   - PRIVATE_DIR         : Directory for downloaded tool files (defaults to SITE_BASE/private).
#
# Prerequisites (must exist on the server):
#   - bash, curl, php, wp (WP-CLI), jq
#
# Usage (run on server via InstaWP CLI exec):
#   # Push blueprint file to site, then run:
#   BLUEPRINT_JSON_PATH=/tmp/blueprint.json instawp exec --site <id> 'bash -s' < apply-blueprint.sh
#
# Failure modes:
#   - Neither BLUEPRINT_JSON_PATH nor BLUEPRINT_JSON_URL set → exits 1
#   - BLUEPRINT_JSON_PATH set but file not found → exits 1
#   - WordPress root not detectable → exits 1
#   - Missing required tools (curl, php, wp, jq) → exits 1
# ---------------------------------------------------------------------------

BLUEPRINTS_PHAR_URL="https://github.com/wordpress/php-toolkit/releases/latest/download/blueprints.phar"

# ---------------------------------------------------------------------------
# Validate prerequisites
# ---------------------------------------------------------------------------
for cmd in curl php wp jq; do
  command -v "${cmd}" >/dev/null 2>&1 || { echo "Missing required command: ${cmd}" >&2; exit 1; }
done

# ---------------------------------------------------------------------------
# Resolve WordPress root
# ---------------------------------------------------------------------------
if [ -n "${SITE_PATH:-}" ] && [ -f "${SITE_PATH}/wp-load.php" ]; then
  : # Caller-supplied SITE_PATH is valid
elif wp eval 'echo "";' --skip-plugins --skip-themes >/dev/null 2>&1; then
  SITE_PATH="$(wp eval 'echo rtrim(ABSPATH, "/");' --skip-plugins --skip-themes)"
else
  echo "Cannot determine WordPress root: set SITE_PATH or ensure WP-CLI can auto-detect it." >&2
  exit 1
fi

SITE_BASE="${SITE_BASE:-$(cd "$(dirname "${SITE_PATH}")" && pwd)}"
PRIVATE_DIR="${PRIVATE_DIR:-${SITE_BASE}/private}"
mkdir -p "${PRIVATE_DIR}"

# ---------------------------------------------------------------------------
# Read DB credentials from WP-CLI
# ---------------------------------------------------------------------------
CONFIG_DATA="$(wp config list DB_NAME DB_USER DB_PASSWORD DB_HOST --format=json --path="${SITE_PATH}")"

DB_NAME="$(echo "${CONFIG_DATA}" | jq -r '.[] | select((.name // .key) == "DB_NAME") | .value')"
DB_USER="$(echo "${CONFIG_DATA}" | jq -r '.[] | select((.name // .key) == "DB_USER") | .value')"
DB_PASS="$(echo "${CONFIG_DATA}" | jq -r '.[] | select((.name // .key) == "DB_PASSWORD") | .value')"
DB_HOST="$(echo "${CONFIG_DATA}" | jq -r '.[] | select((.name // .key) == "DB_HOST") | .value')"

: "${DB_NAME:?Failed to read DB_NAME from wp config list}"
: "${DB_USER:?Failed to read DB_USER from wp config list}"
: "${DB_PASS:?Failed to read DB_PASSWORD from wp config list}"
: "${DB_HOST:?Failed to read DB_HOST from wp config list}"

# ---------------------------------------------------------------------------
# Read siteurl from WP options
# ---------------------------------------------------------------------------
SITE_URL="$(wp option get siteurl --path="${SITE_PATH}")"
: "${SITE_URL:?Failed to read siteurl from WP options}"
SITE_URL="${SITE_URL%/}/"

# ---------------------------------------------------------------------------
# Download blueprints.phar
# ---------------------------------------------------------------------------
curl -fsSL "${BLUEPRINTS_PHAR_URL}" \
  -o "${PRIVATE_DIR}/blueprints.phar"

# ---------------------------------------------------------------------------
# Resolve blueprint JSON (local path takes precedence over URL)
# ---------------------------------------------------------------------------
if [ -n "${BLUEPRINT_JSON_PATH:-}" ]; then
  [ -f "${BLUEPRINT_JSON_PATH}" ] || {
    echo "BLUEPRINT_JSON_PATH is set to '${BLUEPRINT_JSON_PATH}' but file not found." >&2
    exit 1
  }
  cp "${BLUEPRINT_JSON_PATH}" "${PRIVATE_DIR}/blueprint.json"
elif [ -n "${BLUEPRINT_JSON_URL:-}" ]; then
  curl -fsSL "${BLUEPRINT_JSON_URL}" \
    -o "${PRIVATE_DIR}/blueprint.json"
else
  echo "Neither BLUEPRINT_JSON_PATH nor BLUEPRINT_JSON_URL is set." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Apply blueprint
# ---------------------------------------------------------------------------
php "${PRIVATE_DIR}/blueprints.phar" exec \
  "${PRIVATE_DIR}/blueprint.json" \
  --mode=apply-to-existing-site \
  --site-url="${SITE_URL}" \
  --site-path="${SITE_PATH}" \
  --db-user="${DB_USER}" \
  --db-pass="${DB_PASS}" \
  --db-name="${DB_NAME}" \
  --db-host="${DB_HOST}"
