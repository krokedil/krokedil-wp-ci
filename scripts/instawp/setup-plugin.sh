#!/usr/bin/env bash
set -euo pipefail

# setup-plugin.sh
# ---------------------------------------------------------------------------
# Purpose:
#   Apply plugin-specific InstaWP configuration driven by plugin-meta.json.
#   Runs on the GitHub Actions runner; uses the InstaWP CLI to execute
#   WP-CLI commands on the remote InstaWP site.
#
# Inputs (env vars):
#   - INSTAWP_SITE_ID        : InstaWP site ID (required).
#   - PLUGIN_META_FILE       : Path to plugin-meta.json
#                              (default: .github/plugin-meta.json).
#   - INSTAWP_SCRIPTS_DIR    : Directory containing apply-blueprint.sh
#                              (default: directory of this script).
#   - <env vars referenced by pluginCredentialsOptionPatches>
#     e.g. E2E_API_KEY, E2E_API_SECRET — resolved from the caller's environment.
#
# Behavior:
#   Reads instawp.* fields from plugin-meta.json and conditionally runs:
#   - Plugin-specific WC blueprint (pluginWcBlueprintPath)
#   - Payment gateway sort order  (paymentGatewayId)
#   - Classic checkout shortcode  (useCheckoutBlock: false)
#   - Credential option patches   (pluginCredentialsOptionPatches)
#   Each step is silently skipped if the corresponding field is absent or empty.
#
# Failure modes:
#   - Missing INSTAWP_SITE_ID exits with code 1.
#   - InstaWP CLI errors propagate via set -e.
#   - Missing PLUGIN_META_FILE exits with code 1.
# ---------------------------------------------------------------------------

INSTAWP_SITE_ID="${INSTAWP_SITE_ID:?INSTAWP_SITE_ID env var is required}"
PLUGIN_META_FILE="${PLUGIN_META_FILE:-.github/plugin-meta.json}"
SCRIPTS_DIR="${INSTAWP_SCRIPTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

if [ ! -f "$PLUGIN_META_FILE" ]; then
  echo "::error::$PLUGIN_META_FILE not found" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Plugin-specific WC blueprint
# ---------------------------------------------------------------------------
BLUEPRINT_PATH=$(jq -r '.instawp.pluginWcBlueprintPath // empty' "$PLUGIN_META_FILE")
if [ -n "$BLUEPRINT_PATH" ]; then
  if [ -f "$BLUEPRINT_PATH" ]; then
    echo "[INFO] Applying plugin-specific WC blueprint from $BLUEPRINT_PATH" >&2
    # Upload blueprint file to a temp location on the site, then apply it.
    instawp exec "$INSTAWP_SITE_ID" 'cat > /tmp/plugin-blueprint.json' < "$BLUEPRINT_PATH"
    instawp exec "$INSTAWP_SITE_ID" \
      'BLUEPRINT_JSON_PATH=/tmp/plugin-blueprint.json bash -s' \
      < "${SCRIPTS_DIR}/apply-blueprint.sh"
  else
    echo "::warning::pluginWcBlueprintPath is set to '$BLUEPRINT_PATH' but file not found; skipping" >&2
  fi
fi

# ---------------------------------------------------------------------------
# Payment gateway sort order
# ---------------------------------------------------------------------------
GATEWAY_ID=$(jq -r '.instawp.paymentGatewayId // empty' "$PLUGIN_META_FILE")
if [ -n "$GATEWAY_ID" ]; then
  echo "[INFO] Setting payment gateway sort order for $GATEWAY_ID" >&2
  instawp wp "$INSTAWP_SITE_ID" \
    wc payment_gateway update "$GATEWAY_ID" --order=1 --user=1 --skip-themes
fi

# ---------------------------------------------------------------------------
# Classic checkout shortcode (when block checkout is not desired)
# ---------------------------------------------------------------------------
USE_BLOCK=$(jq -r '.instawp.useCheckoutBlock // empty' "$PLUGIN_META_FILE")
if [ "$USE_BLOCK" = "false" ]; then
  echo "[INFO] Setting checkout page to use classic shortcode" >&2
  CHECKOUT_PAGE_ID=$(instawp wp "$INSTAWP_SITE_ID" \
    option get woocommerce_checkout_page_id --skip-plugins --skip-themes)
  instawp wp "$INSTAWP_SITE_ID" \
    post update "$CHECKOUT_PAGE_ID" \
    --post_content='[woocommerce_checkout]' \
    --skip-plugins --skip-themes
fi

# ---------------------------------------------------------------------------
# Credential option patches
# Each patch reads a value from an env var in the runner environment and
# writes it into a WordPress option on the remote site.
# ---------------------------------------------------------------------------
PATCHES=$(jq -r \
  '.instawp.pluginCredentialsOptionPatches // [] | .[] | "\(.optionName) \(.key) \(.envVarValue)"' \
  "$PLUGIN_META_FILE")

if [ -n "$PATCHES" ]; then
  while IFS=' ' read -r option_name key env_var_name; do
    # Resolve env var value using bash indirect expansion
    value="${!env_var_name:-}"
    if [ -n "$value" ]; then
      echo "[INFO] Patching option ${option_name}.${key}" >&2
      instawp wp "$INSTAWP_SITE_ID" \
        option patch insert "$option_name" "$key" "$value" \
        --skip-plugins --skip-themes
    else
      echo "::warning::Skipping credential patch for ${option_name}.${key} (env var ${env_var_name} is empty)" >&2
    fi
  done <<< "$PATCHES"
fi
