// blueprint/presets.js
// ---------------------------------------------------------------------------
// Purpose
//   Shared blueprint preset definitions. Each preset maps to a specific
//   blueprint configuration used in CI or local development. This is the
//   single source of truth — consumers import from here rather than
//   hardcoding variables.
//
// Presets
//   - full-store:   Full Swedish WooCommerce store. Used for InstaWP deploys.
//   - minimal:      Minimal WooCommerce config + beta tester. Matches the
//                   job summary playground link.
//   - general-e2e:  Storefront + reset WP + general site options. Used for
//                   the shared e2e test suite.
//
// Usage
//   const { getPresetVariables, PRESET_NAMES } = require("./presets");
//   const vars = getPresetVariables("full-store", { pluginSlug, repoSlug });

/**
 * @typedef {Object} PresetOptions
 * @property {string} [pluginSlug]  Plugin directory slug (e.g. "klarna-payments").
 * @property {string} [repoSlug]   Repository name (e.g. "klarna-payments-for-woocommerce").
 * @property {string} [pluginName] Human-readable plugin name (e.g. "Klarna Payments").
 */

/** All valid preset names. */
const PRESET_NAMES = ["full-store", "minimal", "general-e2e"];

/**
 * Return blueprint variables for a named preset.
 *
 * Every preset includes `configure_debug_logs` and `activate_plugin_slugs`
 * (when a slug is available) because those are universally useful for local
 * development and troubleshooting.
 *
 * @param {string} presetName  One of PRESET_NAMES.
 * @param {PresetOptions} opts
 * @returns {Record<string, any>} Blueprint variables ready for BlueprintBuilder.
 */
function getPresetVariables(
  presetName,
  { pluginSlug, repoSlug, pluginName } = {},
) {
  const blogname = pluginName ? `${pluginName} dev zip` : "Plugin dev zip";

  /** Fields added to every preset. */
  const common = {
    configure_debug_logs: true,
    ...(pluginSlug ? { activate_plugin_slugs: pluginSlug } : {}),
  };

  switch (presetName) {
    case "full-store":
      return {
        ...common,
        plugin_blueprints: ["woocommerce", repoSlug].filter(Boolean),
        install_woocommerce: true,
        configure_general_site_options: true,
        configure_woocommerce_fully: true,
        blogname: "WooCommerce demoshop",
      };

    case "minimal":
      return {
        ...common,
        plugin_blueprints: ["woocommerce", repoSlug].filter(Boolean),
        install_woocommerce: true,
        configure_woocommerce_minimal: true,
        blogname,
      };

    case "general-e2e":
      return {
        ...common,
        plugin_blueprints: ["woocommerce"],
        reset_wordpress: true,
        install_storefront: true,
        configure_general_site_options: true,
        install_woocommerce: true,
        install_wc_beta_tester: true,
        blogname,
      };

    default:
      throw new Error(
        `Unknown blueprint preset "${presetName}". ` +
          `Valid presets: ${PRESET_NAMES.join(", ")}`,
      );
  }
}

module.exports = { getPresetVariables, PRESET_NAMES };
