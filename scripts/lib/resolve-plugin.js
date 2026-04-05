/**
 * resolve-plugin.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Standalone module for resolving plugin identifiers against the plugin
 *   registry (.github/projects.json). Zero npm dependencies — uses only
 *   Node.js built-ins so it can run before `npm ci` in CI.
 *
 * Exports:
 *   - loadPlugins(pluginsJsonPath) — read and parse the registry file.
 *   - resolvePlugin(identifier, plugins) — match an identifier (abbreviation,
 *     repo slug, or display name) to a registry entry.
 *   - isPassthrough(identifier) — true when the value is already in owner/repo
 *     format or is the dummy test fixture name.
 *
 * Used by:
 *   - scripts/resolve-plugin-cli.js   (CI / composite action)
 *   - scripts/playground.js           (local dev)
 */

const fs = require("node:fs");

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Read .github/projects.json and return the `plugins` array.
 * @param {string} pluginsJsonPath Absolute path to projects.json.
 * @returns {{ displayName: string, repository: string, abbreviation?: string, slug?: string, distributionPlatform?: string, downloadUrl?: string }[]}
 */
function loadPlugins(pluginsJsonPath) {
  const raw = fs.readFileSync(pluginsJsonPath, "utf8");
  return JSON.parse(raw).plugins;
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Resolve a user-provided identifier to a projects.json entry.
 * Matches (case-insensitive) against abbreviation, repo slug (part after /),
 * plugin slug, then display name — in that order.
 *
 * @param {string} identifier  Abbreviation, slug, or display name.
 * @param {{ displayName: string, repository: string, abbreviation?: string, slug?: string }[]} plugins
 * @returns {{ displayName: string, repository: string, abbreviation?: string, slug?: string } | null}
 */
function resolvePlugin(identifier, plugins) {
  const lower = identifier.toLowerCase();
  return (
    plugins.find(
      (p) => p.abbreviation && p.abbreviation.toLowerCase() === lower,
    ) ||
    plugins.find(
      (p) => p.repository.split("/").pop().toLowerCase() === lower,
    ) ||
    plugins.find(
      (p) => p.slug && p.slug.toLowerCase() === lower,
    ) ||
    plugins.find((p) => p.displayName.toLowerCase() === lower) ||
    null
  );
}

// ---------------------------------------------------------------------------
// Passthrough check
// ---------------------------------------------------------------------------

/**
 * Returns true when the identifier should bypass resolution — either because
 * it is already in owner/repo format or it is the dummy test fixture.
 *
 * @param {string} identifier
 * @returns {boolean}
 */
function isPassthrough(identifier) {
  return identifier.includes("/") || identifier === "dummy-plugin-for-repo-tests";
}

module.exports = { loadPlugins, resolvePlugin, isPassthrough };
