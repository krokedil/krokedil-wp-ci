#!/usr/bin/env node
/**
 * resolve-plugin-cli.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   CLI wrapper around lib/resolve-plugin.js. Resolves a plugin identifier
 *   (abbreviation, slug, or display name) to its repository (owner/repo).
 *
 * Usage:
 *   node scripts/resolve-plugin-cli.js <identifier> [--plugins-json <path>]
 *
 * Inputs:
 *   <identifier>      Plugin abbreviation, slug, display name, owner/repo, or
 *                      "dummy-plugin-for-repo-tests".
 *   --plugins-json    Path to plugins.json. Defaults to
 *                      <repo-root>/.github/plugins.json.
 *
 * Behaviour:
 *   - Owner/repo values and "dummy-plugin-for-repo-tests" pass through as-is.
 *   - Other identifiers are resolved against plugins.json.
 *   - Prints the resolved repository to stdout.
 *
 * Failure modes:
 *   - No identifier provided: exits 1.
 *   - Unknown identifier: exits 1 with error message on stderr.
 *   - Missing plugins.json: exits 1 with error on stderr.
 *
 * Dependencies:
 *   None beyond Node.js built-ins — safe to run before `npm ci`.
 */

const path = require("node:path");
const { loadPlugins, resolvePlugin, isPassthrough } = require("./lib/resolve-plugin.js");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let identifier = null;
let pluginsJsonPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--plugins-json" && i + 1 < args.length) {
    pluginsJsonPath = args[++i];
  } else if (!identifier) {
    identifier = args[i];
  }
}

if (!identifier) {
  console.error("Usage: resolve-plugin-cli.js <identifier> [--plugins-json <path>]");
  process.exit(1);
}

// Default plugins.json path: <script-dir>/../.github/plugins.json
if (!pluginsJsonPath) {
  pluginsJsonPath = path.resolve(__dirname, "..", ".github", "plugins.json");
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

if (isPassthrough(identifier)) {
  process.stdout.write(identifier);
  process.exit(0);
}

const plugins = loadPlugins(pluginsJsonPath);
const match = resolvePlugin(identifier, plugins);

if (!match) {
  console.error(`Unknown plugin identifier: ${identifier}`);
  process.exit(1);
}

process.stdout.write(match.repository);
