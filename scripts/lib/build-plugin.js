// build-plugin.js
// ---------------------------------------------------------------------------
// Purpose
//   Detect and run the production build step for a plugin directory, and
//   optionally apply a dev version suffix to the main plugin file header.
//   Mirrors the build + version suffix logic in scripts/prepare-plugin-dev-zip.sh
//   (lines 61–83). The bash script is used in CI; this module is used for local
//   dev tooling. Keep both in sync when changing build step detection rules.
//
// Inputs
//   - pluginDir: absolute path to the plugin root.
//   - pluginSlug: plugin slug (used to find the main .php file for version suffix).
//   - options.stdio: stdio option forwarded to execSync (default: "inherit").
//
// Behavior
//   1. Check for package.json with a "build:prod" script → npm ci + npm run build:prod.
//   2. Else check for composer.json with a "build-prod" script → composer install + build-prod.
//   3. Else skip with a log message.
//   4. applyDevVersionSuffix: rewrites " * Version: X.Y.Z" → " * Version: X.Y.Z-dev.branch.sha"
//      in the main plugin file, using git branch + short SHA from the plugin directory.
//
// Failure modes
//   - npm/composer not found: throws.
//   - Build command fails: throws (inherits from execSync).
//   - applyDevVersionSuffix: returns false if the main plugin file or version header is missing.

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

/**
 * @typedef {"npm" | "composer" | null} BuildSystem
 */

/**
 * Detect which build system a plugin uses (if any).
 *
 * @param {string} pluginDir Absolute path to the plugin directory.
 * @returns {BuildSystem}
 */
function detectBuildSystem(pluginDir) {
  const pkgPath = path.join(pluginDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const content = fs.readFileSync(pkgPath, "utf8");
    if (content.includes('"build:prod"')) {
      return "npm";
    }
  }

  const composerPath = path.join(pluginDir, "composer.json");
  if (fs.existsSync(composerPath)) {
    const content = fs.readFileSync(composerPath, "utf8");
    if (content.includes('"build-prod"')) {
      return "composer";
    }
  }

  return null;
}

/**
 * Run the production build for a plugin directory.
 *
 * @param {string} pluginDir Absolute path to the plugin directory.
 * @param {{ stdio?: import("child_process").StdioOptions }} [options]
 * @returns {{ buildSystem: BuildSystem }} What ran (or null if skipped).
 */
function buildPlugin(pluginDir, options = {}) {
  const stdio = options.stdio ?? "inherit";
  const buildSystem = detectBuildSystem(pluginDir);

  if (buildSystem === "npm") {
    console.log("Running npm ci + npm run build:prod ...");
    execSync("npm ci", { cwd: pluginDir, stdio });
    execSync("npm run build:prod", { cwd: pluginDir, stdio });
  } else if (buildSystem === "composer") {
    console.log("Running composer install + composer run-script build-prod ...");
    execSync("composer install --no-dev --prefer-dist --no-progress", {
      cwd: pluginDir,
      stdio,
    });
    execSync("composer run-script build-prod", { cwd: pluginDir, stdio });
  } else {
    console.log(
      "No build script (npm build:prod or composer build-prod) found; skipping build step",
    );
  }

  return { buildSystem };
}

/**
 * Apply a dev version suffix to the main plugin file header.
 * Rewrites " * Version: X.Y.Z" → " * Version: X.Y.Z-dev.branch.shortsha"
 * using git state from the plugin directory.
 *
 * @param {string} pluginDir Absolute path to the plugin directory.
 * @param {string} pluginSlug Plugin slug (matches the main .php filename).
 * @returns {{ applied: boolean, version?: string }} Whether the suffix was applied.
 */
function applyDevVersionSuffix(pluginDir, pluginSlug) {
  const mainFile = path.join(pluginDir, `${pluginSlug}.php`);
  if (!fs.existsSync(mainFile)) {
    console.log(
      `No main plugin file found at ${pluginSlug}.php; skipping version suffix`,
    );
    return { applied: false };
  }

  // Get branch name and short SHA from the plugin's git repo.
  let branch;
  let shortSha;
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: pluginDir,
      encoding: "utf8",
    }).trim();
    shortSha = execSync("git rev-parse --short=7 HEAD", {
      cwd: pluginDir,
      encoding: "utf8",
    }).trim();
  } catch {
    console.log("Could not read git info; skipping version suffix");
    return { applied: false };
  }

  // Sanitize branch name (same rule as bash: keep only A-Za-z0-9._- )
  const branchSafe = branch.replace(/[^A-Za-z0-9._-]/g, "-");
  const suffix = `-dev.${branchSafe}.${shortSha}`;

  let content = fs.readFileSync(mainFile, "utf8");
  const versionPattern = /^( \* Version:\s*.+)$/m;
  const match = content.match(versionPattern);
  if (!match) {
    console.log(
      `No " * Version:" header found in ${pluginSlug}.php; skipping version suffix`,
    );
    return { applied: false };
  }

  // Avoid double-suffixing if already applied.
  if (match[1].includes("-dev.")) {
    console.log("Dev version suffix already present; skipping");
    return { applied: false };
  }

  content = content.replace(versionPattern, `$1${suffix}`);
  fs.writeFileSync(mainFile, content, "utf8");

  const newVersion = match[1].replace(/^ \* Version:\s*/, "") + suffix;
  console.log(`Version suffix applied: ${newVersion}`);
  return { applied: true, version: newVersion };
}

module.exports = { detectBuildSystem, buildPlugin, applyDevVersionSuffix };
