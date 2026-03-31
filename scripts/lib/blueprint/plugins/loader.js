// blueprint/plugins/loader.js
// ---------------------------------------------------------------------------
// Purpose
//   Load plugin blueprint functions from the registry by slug.
//
// Inputs
//   - slug: plugin slug (e.g. "klarna-checkout-for-woocommerce")
//
// Behavior
//   - Looks for plugins/{slug}.js in this directory.
//   - Returns the exported apply function, or null if not found.
//   - Each plugin blueprint module must export a function that takes a builder.
//
// Failure modes
//   - Missing file returns null (plugin has no custom blueprint).
//   - Module without a function export throws.

const fs = require("node:fs");
const path = require("node:path");

const PLUGINS_DIR = __dirname;

/**
 * Load a plugin blueprint function by slug.
 *
 * @param {string} slug - Plugin slug (e.g. "klarna-checkout-for-woocommerce").
 * @returns {Function | null} The plugin blueprint function, or null if not found.
 */
function loadPluginBlueprint(slug) {
  const filePath = path.join(PLUGINS_DIR, `${slug}.js`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const mod = require(filePath);

  // Find the exported apply function (first function export).
  const fn =
    typeof mod === "function"
      ? mod
      : Object.values(mod).find((v) => typeof v === "function");

  if (typeof fn !== "function") {
    throw new Error(
      `Plugin blueprint at ${filePath} must export a function. Got: ${typeof fn}`,
    );
  }

  return fn;
}

module.exports = {
  loadPluginBlueprint,
  PLUGINS_DIR,
};
