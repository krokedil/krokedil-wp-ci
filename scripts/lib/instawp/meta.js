// meta.js
// ---------------------------------------------------------------------------
// Purpose:
//   Extract InstaWP-specific settings from PLUGIN_META_JSON and environment
//   variables in a stable, reusable shape.
//
// Inputs:
//   - meta object from scripts/lib/plugin-meta.loadMeta()
//   - env object (defaults to process.env)
//
// Behavior:
//   - Reads optional instawp.* fields from metadata
//   - Expands credential patches by resolving env var values
//
// Failure modes:
//   - None (returns safe defaults if fields are missing)
// ---------------------------------------------------------------------------

const { safeGet } = require("../plugin-meta");

/**
 * @typedef {Object} InstawpMetaConfig
 * @property {string} pluginWcBlueprintUrl
 * @property {string | undefined} paymentGatewayId
 * @property {boolean | undefined} useCheckoutBlock
 * @property {Array<{ option_name: string, key: string, value: string }>} pluginCredentialsOptionPatches
 */

/**
 * @param {Record<string, unknown>} meta
 * @param {Record<string, string | undefined>} [env]
 * @returns {InstawpMetaConfig}
 */
function buildInstawpMetaConfig(meta, env = process.env) {
  const pluginWcBlueprintUrl = safeGet(
    meta,
    "instawp.pluginWcBlueprintUrl",
    "",
  );
  const paymentGatewayId = safeGet(meta, "instawp.paymentGatewayId", undefined);
  const useCheckoutBlock = safeGet(meta, "instawp.useCheckoutBlock", undefined);
  const pluginCredentialsOptionPatches = (
    safeGet(meta, "instawp.pluginCredentialsOptionPatches", []) || []
  ).map((p) => ({
    option_name: p.optionName,
    key: p.key,
    value: env[p.envVarValue] || "",
  }));

  return {
    pluginWcBlueprintUrl,
    paymentGatewayId,
    useCheckoutBlock,
    pluginCredentialsOptionPatches,
  };
}

module.exports = {
  buildInstawpMetaConfig,
};
