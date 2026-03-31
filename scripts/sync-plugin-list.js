/**
 * sync-plugin-list.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Reads .github/plugins.json and propagates the plugin list to the
 *   `options:` block in each centrally-* workflow file (display names).
 *
 * Usage:
 *   node scripts/sync-plugin-list.js          # update files in place
 *   node scripts/sync-plugin-list.js --check  # dry-run, exit 1 if files differ
 *
 * Inputs:
 *   - .github/plugins.json — array of { displayName, repository } objects.
 *
 * Behaviour:
 *   - Validates that plugins are sorted A-Z by displayName.
 *   - Validates no duplicate displayName or repository values.
 *   - Injects "dummy-plugin-for-repo-tests" as the last workflow option.
 *   - Uses marker comments to find replacement regions in target files.
 *
 * Failure modes:
 *   - Exits 1 if plugins.json is missing, malformed, unsorted, or has dupes.
 *   - Exits 1 in --check mode if any target file would change.
 *   - Exits 1 if a target file is missing a marker comment pair.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLUGINS_JSON_PATH = path.join(ROOT, ".github", "plugins.json");

// ---------------------------------------------------------------------------
// Marker comments
// ---------------------------------------------------------------------------
const OPTIONS_BEGIN = "# --- BEGIN GENERATED PLUGIN OPTIONS ---";
const OPTIONS_END = "# --- END GENERATED PLUGIN OPTIONS ---";
// ---------------------------------------------------------------------------
// Target files
// ---------------------------------------------------------------------------
const WORKFLOW_FILES = [
  ".github/workflows/centrally-create-plugin-dev-zip.yml",
  ".github/workflows/centrally-deploy-plugin-dev-zip-instawp-existing.yml",
  ".github/workflows/centrally-deploy-plugin-dev-zip-instawp-new.yml",
].map((f) => path.join(ROOT, f));

// ---------------------------------------------------------------------------
// Read and validate plugins.json
// ---------------------------------------------------------------------------

function loadPlugins() {
  if (!fs.existsSync(PLUGINS_JSON_PATH)) {
    console.error(`Error: ${PLUGINS_JSON_PATH} not found.`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(PLUGINS_JSON_PATH, "utf8"));
  const plugins = data.plugins;

  if (!Array.isArray(plugins) || plugins.length === 0) {
    console.error('Error: plugins.json must have a non-empty "plugins" array.');
    process.exit(1);
  }

  for (const p of plugins) {
    if (!p.displayName || !p.repository) {
      console.error(
        `Error: each plugin must have "displayName" and "repository". Got: ${JSON.stringify(p)}`,
      );
      process.exit(1);
    }
  }

  // Check sorted A-Z by displayName.
  const names = plugins.map((p) => p.displayName);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== sorted[i]) {
      console.error(
        `Error: plugins.json is not sorted A-Z by displayName. "${names[i]}" should come after "${sorted[i]}".`,
      );
      process.exit(1);
    }
  }

  // Check for duplicates.
  const nameSet = new Set();
  const repoSet = new Set();
  for (const p of plugins) {
    if (nameSet.has(p.displayName)) {
      console.error(`Error: duplicate displayName "${p.displayName}".`);
      process.exit(1);
    }
    if (repoSet.has(p.repository)) {
      console.error(`Error: duplicate repository "${p.repository}".`);
      process.exit(1);
    }
    nameSet.add(p.displayName);
    repoSet.add(p.repository);
  }

  return plugins;
}

// ---------------------------------------------------------------------------
// Generate content between markers
// ---------------------------------------------------------------------------

/**
 * Build the YAML options lines (10-space indent, matching existing format).
 * Display names sorted A-Z, then dummy-plugin-for-repo-tests last.
 */
function buildOptionsBlock(plugins) {
  const indent = "          ";
  const lines = plugins.map((p) => `${indent}- ${p.displayName}`);
  lines.push(`${indent}- dummy-plugin-for-repo-tests`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Replace content between marker comments
// ---------------------------------------------------------------------------

function replaceBetweenMarkers(content, beginMarker, endMarker, replacement) {
  // Find the begin and end markers, allowing any leading whitespace.
  const beginRegex = new RegExp(`^([ \t]*${escapeRegex(beginMarker)})$`, "m");
  const endRegex = new RegExp(`^([ \t]*${escapeRegex(endMarker)})$`, "m");

  const beginMatch = content.match(beginRegex);
  const endMatch = content.match(endRegex);

  if (!beginMatch || !endMatch) {
    return null; // markers not found
  }

  const beginIdx = beginMatch.index + beginMatch[0].length;
  const endIdx = endMatch.index;

  if (endIdx <= beginIdx) {
    return null; // malformed
  }

  return (
    content.substring(0, beginIdx) +
    "\n" +
    replacement +
    "\n" +
    content.substring(endIdx)
  );
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const checkOnly = process.argv.includes("--check");
  const plugins = loadPlugins();

  const optionsBlock = buildOptionsBlock(plugins);

  let changed = false;

  // Update workflow files (options block).
  for (const filePath of WORKFLOW_FILES) {
    const original = fs.readFileSync(filePath, "utf8");
    const updated = replaceBetweenMarkers(
      original,
      OPTIONS_BEGIN,
      OPTIONS_END,
      optionsBlock,
    );

    if (updated === null) {
      console.error(
        `Error: marker comments not found in ${path.relative(ROOT, filePath)}`,
      );
      process.exit(1);
    }

    if (original !== updated) {
      changed = true;
      if (checkOnly) {
        console.log(
          `Would update: ${path.relative(ROOT, filePath)}`,
        );
      } else {
        fs.writeFileSync(filePath, updated);
        console.log(`Updated: ${path.relative(ROOT, filePath)}`);
      }
    } else {
      console.log(`No changes: ${path.relative(ROOT, filePath)}`);
    }
  }

  if (checkOnly && changed) {
    console.error(
      "\nPlugin list is out of sync. Run: npm run sync:plugins",
    );
    process.exit(1);
  }

  if (!checkOnly && !changed) {
    console.log("\nAll files already up to date.");
  }
}

main();
