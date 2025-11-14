#!/usr/bin/env bash
set -euo pipefail

PLUGIN_META_JSON="${1:?plugin_meta_json required}"
ZIP_FILE_NAME="${2:?zip_file_name required}"
AWS_S3_PUBLIC_URL="${3:-}"  # optional
INSTAWP_API_TOKEN="${4:?instawp_api_token required}"
E2E_API_KEY="${5:-}"
E2E_API_SECRET="${6:-}"

# Export env vars for node script compatibility
export PLUGIN_META_JSON
export ZIP_FILE_NAME
export AWS_S3_PUBLIC_URL
export INSTAWP_API_TOKEN
export E2E_API_KEY
export E2E_API_SECRET

node scripts/deploy-instawp.js
# deploy-instawp.js appends outputs (site_id, site_url, site_created) to $GITHUB_OUTPUT.
