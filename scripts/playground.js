#!/usr/bin/env node
// scripts/playground.js
// ---------------------------------------------------------------------------
// Purpose
//   Start a WordPress Playground server with a Krokedil plugin installed.
//   Optionally launch Playwright codegen for visual selector/assertion authoring.
//
// Usage
//   node scripts/playground.js <plugin> [--blueprint <type>] [--dir <path>] [--clone [--branch <name>]] [--codegen] [--list]
//
//   <plugin>      Abbreviation, slug, or display name from .github/projects.json.
//                 Special value "dummy" uses the in-repo fixture plugin.
//   --blueprint   Blueprint preset: full-store (default), minimal, general-e2e.
//                 See scripts/lib/blueprint/presets.js for details.
//   --dir [path]  Use a local directory. If path is omitted, uses {ABBR}_LOCAL_DIR env var.
//   --clone       Clone from GitHub repository, build, and auto-mount. Supports --branch.
//   --branch      Branch to clone/checkout (only with --clone). Default: repo default branch.
//   --codegen     After the server starts, launch `npx playwright codegen` against it.
//   --list        Print available plugins and exit.
//
// Source resolution priority
//   1. --dir flag or {ABBREVIATION}_LOCAL_DIR env var → use local directory.
//   2. --clone flag → clone from repository, build, auto-mount.
//   3. Plugin has distributionPlatform or downloadUrl → install via blueprint (no clone).
//   4. Fallback → clone from repository, build, auto-mount (same as --clone).
//
// Environment variables
//   {ABBREVIATION}_LOCAL_DIR — per-plugin local directory override.
//   When set, acts as a default for --dir (e.g. KP_LOCAL_DIR=~/Projects/klarna-payments).
//   The --dir flag takes precedence over the env var.
//
// Inputs
//   - .github/projects.json for plugin registry (abbreviation, repository, slug,
//     distributionPlatform, downloadUrl).
//   - scripts/lib/blueprint/ for BlueprintBuilder + template.
//   - Plugin's .github/plugin-meta.json for slug (optional — falls back to repo name).
//
// Behavior
//   1. Resolve the plugin identifier to a projects.json entry.
//   2. Obtain the plugin source based on flags and projects.json config:
//      a. --dir / env var: use existing local directory.
//      b. --clone (or fallback): shallow clone from GitHub, build, auto-mount.
//      c. Remote download: install via blueprint installPlugin step (no local dir).
//   3. Build a Playground blueprint with WooCommerce + the plugin's own blueprint.
//   4. Start the Playground server (with auto-mount if local dir, without if remote).
//   5. If --codegen, spawn playwright codegen pointed at /wp-admin/.
//   6. Wait for SIGINT, then clean up.
//
// Failure modes
//   - Unknown plugin identifier: exits with error and lists available plugins.
//   - git clone failure: exits with error.

const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawn } = require("node:child_process");

// Load .env file from the project root if it exists.
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
  getPresetVariables,
  PRESET_NAMES,
} = require("./lib/blueprint/index.js");
const { loadPlugins, resolvePlugin } = require("./lib/resolve-plugin.js");
const { buildPlugin, applyDevVersionSuffix } = require("./lib/build-plugin.js");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const PROJECTS_JSON_PATH = path.join(REPO_ROOT, ".github", "projects.json");
const PLAYGROUND_TMP_DIR = path.join(REPO_ROOT, ".playground-tmp");
const DUMMY_PLUGIN_DIR = path.join(
  REPO_ROOT,
  "tests",
  "scripts",
  "fixtures",
  "dummy-plugin-for-repo-tests",
);

// ---------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------

function printList(plugins) {
  console.log("\nAvailable plugins:\n");
  const maxAbbr = Math.max(...plugins.map((p) => p.abbreviation.length));
  for (const p of plugins) {
    const slug = p.repository.split("/").pop();
    const sourceTag = getRemoteDownloadSource(p)
      ? ` [${p.distributionPlatform === "wordpress-org" ? "wp.org" : "url"}]`
      : "";
    console.log(
      `  ${p.abbreviation.padEnd(maxAbbr)}  ${slug}  (${p.displayName})${sourceTag}`,
    );
  }
  console.log(`\n  ${"dummy".padEnd(maxAbbr)}  dummy-plugin-for-repo-tests  (in-repo fixture)\n`);
}

// ---------------------------------------------------------------------------
// Remote download source detection
// ---------------------------------------------------------------------------

/**
 * Check if a plugin has a remote download source configured.
 * Returns "wordpress-org" if distributionPlatform is "wordpress-org" and slug is set,
 * "url" if downloadUrl is set, or null if neither applies.
 *
 * @param {object} plugin Plugin entry from projects.json.
 * @returns {"wordpress-org" | "url" | null}
 */
function getRemoteDownloadSource(plugin) {
  if (plugin.distributionPlatform === "wordpress-org" && plugin.slug) {
    return "wordpress-org";
  }
  if (plugin.downloadUrl) {
    return "url";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin source resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the plugin source directory.
 * Returns { pluginDir, pluginMetaJson } where pluginMetaJson may be null
 * if the plugin has no .github/plugin-meta.json.
 */
function resolvePluginSource({ plugin, dirFlag, branchFlag }) {
  // 1. Explicit --dir
  if (dirFlag) {
    const pluginDir = path.resolve(dirFlag);
    if (!fs.existsSync(pluginDir)) {
      console.error(`\nError: Directory does not exist: ${pluginDir}\n`);
      process.exit(1);
    }
    return { pluginDir, pluginMetaJson: tryReadPluginMeta(pluginDir), cloned: false };
  }

  // 2. Dummy fixture (no clone needed)
  if (plugin._isDummy) {
    return {
      pluginDir: DUMMY_PLUGIN_DIR,
      pluginMetaJson: tryReadPluginMeta(DUMMY_PLUGIN_DIR),
      cloned: false,
    };
  }

  // 3. Clone from GitHub
  if (!/^[a-zA-Z0-9\-_.]+\/[a-zA-Z0-9\-_.]+$/.test(plugin.repository)) {
    throw new Error(`Invalid repository format: ${plugin.repository}`);
  }
  if (branchFlag && !/^[a-zA-Z0-9._/\-]+$/.test(branchFlag)) {
    throw new Error(`Invalid branch name: ${branchFlag}`);
  }

  const slug = plugin.repository.split("/").pop();
  const cloneDir = path.join(PLAYGROUND_TMP_DIR, slug);

  if (fs.existsSync(cloneDir)) {
    console.log(`Reusing existing clone at ${cloneDir}`);

    // Switch branch if requested
    if (branchFlag) {
      try {
        execSync(`git fetch origin ${branchFlag} --depth 1`, {
          cwd: cloneDir,
          stdio: "inherit",
        });

        // Detach HEAD and discard local changes so we can safely
        // delete and recreate the branch from the fetched ref
        execSync("git checkout --detach", { cwd: cloneDir, stdio: "ignore" });
        execSync("git checkout -- .", { cwd: cloneDir, stdio: "ignore" });

        try {
          execSync(`git branch -D ${branchFlag}`, { cwd: cloneDir, stdio: "ignore" });
        } catch {
          // Branch didn't exist locally — that's fine
        }
        execSync(`git checkout -b ${branchFlag} FETCH_HEAD`, {
          cwd: cloneDir,
          stdio: "inherit",
        });
      } catch {
        console.log(`  (branch switch to ${branchFlag} failed — using current checkout)`);
      }
    } else {
      try {
        execSync("git pull --ff-only", { cwd: cloneDir, stdio: "inherit" });
      } catch {
        console.log("  (pull failed — using existing checkout)");
      }
    }
  } else {
    const branchArgs = branchFlag ? `--branch ${branchFlag} ` : "";
    console.log(
      `Cloning ${plugin.repository}${branchFlag ? ` (branch: ${branchFlag})` : ""} into ${cloneDir} ...`,
    );
    fs.mkdirSync(PLAYGROUND_TMP_DIR, { recursive: true });
    execSync(
      `git clone --depth 1 ${branchArgs}https://github.com/${plugin.repository}.git ${cloneDir}`,
      { stdio: "inherit" },
    );
  }

  return { pluginDir: cloneDir, pluginMetaJson: tryReadPluginMeta(cloneDir), cloned: true };
}

/**
 * Try to read .github/plugin-meta.json from a plugin directory.
 * Returns the parsed JSON or null if the file doesn't exist.
 */
function tryReadPluginMeta(pluginDir) {
  const metaPath = path.join(pluginDir, ".github", "plugin-meta.json");
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

// ---------------------------------------------------------------------------
// Blueprint + server
// ---------------------------------------------------------------------------

async function startServer({ pluginDir, pluginSlug, blueprintVars }) {
  const outDir = path.join(PLAYGROUND_TMP_DIR, "logs");
  fs.mkdirSync(outDir, { recursive: true });

  const builder = new BlueprintBuilder(
    blueprintVars,
    applyKrokedilBlueprintTemplate,
  );
  await builder.assertValidWithSchema();

  const blueprintPath = path.join(outDir, "server-blueprint.json");
  fs.writeFileSync(
    blueprintPath,
    JSON.stringify(builder.blueprint, null, 2) + "\n",
  );
  console.log(`Blueprint written to ${blueprintPath}`);

  // Start the Playground server via npx @wp-playground/cli.
  // We use the version pinned in tests/plugin-dev-zip/package.json.
  const cliArgs = [
    "@wp-playground/cli@3.1.13",
    "server",
    `--mount=${outDir}:/wordpress/wp-content/uploads/krokedil-wp-ci`,
    `--blueprint=${blueprintPath}`,
  ];

  // Only mount a local plugin directory when one is provided (not for remote downloads).
  if (pluginDir) {
    cliArgs.push(`--mount=${pluginDir}:/wordpress/wp-content/plugins/${pluginSlug}`);
  }

  console.log("\nStarting WordPress Playground server ...\n");

  return new Promise((resolve, reject) => {
    const child = spawn("npx", cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
    });

    let url = null;

    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);

      // Playground CLI prints the URL when ready.
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch && !url) {
        url = urlMatch[0];
        resolve({ child, url });
      }
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(data.toString());
    });

    child.on("close", (code) => {
      if (!url) {
        reject(new Error(`Playground server exited with code ${code} before printing a URL`));
      }
    });

    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Codegen
// ---------------------------------------------------------------------------

function launchCodegen(serverUrl) {
  const codegenUrl = serverUrl.replace(/\/$/, "") + "/wp-admin/";
  console.log(`\nLaunching Playwright codegen at ${codegenUrl} ...\n`);

  const child = spawn("npx", ["playwright", "codegen", codegenUrl], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });

  return child;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const listFlag = args.includes("--list");
  const codegenFlag = args.includes("--codegen");
  const cloneFlag = args.includes("--clone");
  const dirIndex = args.indexOf("--dir");
  // --dir can be bare (no path) to use the env var, or --dir <path> for explicit path.
  const dirNextArg = dirIndex !== -1 ? args[dirIndex + 1] : undefined;
  const dirFlag = dirIndex === -1
    ? null
    : (dirNextArg && !dirNextArg.startsWith("--") ? dirNextArg : true);
  const branchIndex = args.indexOf("--branch");
  const branchFlag = branchIndex !== -1 ? args[branchIndex + 1] : null;
  const blueprintIndex = args.indexOf("--blueprint");
  const blueprintFlag = blueprintIndex !== -1 ? args[blueprintIndex + 1] : null;

  // Validate --blueprint value if provided.
  if (blueprintFlag && !PRESET_NAMES.includes(blueprintFlag)) {
    console.error(
      `\nUnknown blueprint preset: "${blueprintFlag}"\n` +
        `Valid presets: ${PRESET_NAMES.join(", ")}\n`,
    );
    process.exit(1);
  }

  const blueprintPreset = blueprintFlag || "full-store";

  // Positional: first arg that doesn't start with -- and isn't a value for a flag.
  // Only count --dir's next arg as a flag value when it's an actual path (not bare).
  const dirValueIndex = dirFlag !== null && dirFlag !== true ? dirIndex : -1;
  const flagValueIndices = new Set(
    [dirValueIndex, branchIndex, blueprintIndex].filter((i) => i !== -1).map((i) => i + 1),
  );
  const positional = args.find(
    (a, i) => !a.startsWith("--") && !flagValueIndices.has(i),
  );

  const plugins = loadPlugins(PROJECTS_JSON_PATH);

  if (listFlag) {
    printList(plugins);
    process.exit(0);
  }

  if (!positional) {
    console.error(
      "\nUsage: node scripts/playground.js <plugin> [--blueprint <type>] [--dir [path]] [--clone [--branch <name>]] [--codegen]\n" +
        "       node scripts/playground.js --list\n" +
        `\nBlueprint presets: ${PRESET_NAMES.join(", ")} (default: full-store)\n`,
    );
    process.exit(1);
  }

  // Resolve plugin
  const isDummy = positional.toLowerCase() === "dummy";
  const plugin = isDummy
    ? {
        _isDummy: true,
        abbreviation: "dummy",
        repository: "krokedil/dummy-plugin-for-repo-tests",
        displayName: "Dummy Plugin for Repo Tests",
      }
    : resolvePlugin(positional, plugins);

  if (!plugin) {
    console.error(`\nUnknown plugin: "${positional}"\n`);
    printList(plugins);
    process.exit(1);
  }

  const repoSlug = plugin.repository.split("/").pop();
  console.log(`\nPlugin: ${plugin.displayName} (${repoSlug})`);

  // ---------------------------------------------------------------------------
  // Source resolution: --dir > --clone > remote download > env var > fallback clone
  //
  // The env var acts as a fallback for local dev convenience but does NOT
  // override remote download. If the plugin has a remote source and the user
  // didn't pass --dir or --clone, remote download wins over the env var.
  // To use a local dir, pass --dir explicitly.
  // ---------------------------------------------------------------------------
  const remoteSource = getRemoteDownloadSource(plugin);
  const envVarName = `${plugin.abbreviation.toUpperCase()}_LOCAL_DIR`;
  const envVarDir = process.env[envVarName] || null;

  // --dir flag: if passed with a path, use that path. If passed without a path
  // (bare --dir), look up the env var as a convenience shortcut.
  let effectiveDirFlag = dirFlag;
  if (dirFlag === true && envVarDir) {
    effectiveDirFlag = envVarDir;
    console.log(`Using ${envVarName}=${effectiveDirFlag}`);
  } else if (!effectiveDirFlag && !cloneFlag && !remoteSource && envVarDir) {
    // Env var fallback: only when no flags and no remote source configured.
    effectiveDirFlag = envVarDir;
    console.log(`Using ${envVarName}=${effectiveDirFlag}`);
  }

  const useRemoteDownload = !effectiveDirFlag && !cloneFlag && !plugin._isDummy && remoteSource;

  let pluginDir = null;
  let pluginSlug;

  if (useRemoteDownload) {
    // Remote download: install via blueprint installPlugin step (no local dir).
    pluginSlug = plugin.slug || repoSlug;

    console.log(`Source:  ${remoteSource === "wordpress-org" ? "wordpress.org" : plugin.downloadUrl}`);
    console.log(`Slug:    ${pluginSlug}`);
  } else {
    // Local dir or clone from GitHub.
    const { pluginDir: resolvedDir, pluginMetaJson, cloned } = resolvePluginSource({
      plugin,
      dirFlag: effectiveDirFlag,
      branchFlag,
    });

    pluginDir = resolvedDir;
    const hasPluginMeta = pluginMetaJson != null;
    pluginSlug = (hasPluginMeta && pluginMetaJson.slug) || repoSlug;

    console.log(`Source:  ${pluginDir}`);
    if (hasPluginMeta) {
      console.log(`Slug:    ${pluginSlug}`);
    } else {
      console.log(
        `Note:    No .github/plugin-meta.json found — using repo slug "${pluginSlug}" for activation.`,
      );
    }

    // For cloned repos: apply dev version suffix and run build step.
    // Local dirs are assumed ready as-is.
    if (cloned) {
      if (pluginSlug) {
        applyDevVersionSuffix(pluginDir, pluginSlug);
      }
      buildPlugin(pluginDir);
    }
  }

  console.log(`Blueprint: ${blueprintPreset}`);

  // Build blueprint variables from the selected preset.
  const blueprintVars = getPresetVariables(blueprintPreset, {
    pluginSlug,
    repoSlug,
    pluginName: plugin.displayName,
  });

  // For remote downloads, add installPlugin steps to blueprint variables.
  if (useRemoteDownload) {
    if (remoteSource === "wordpress-org") {
      blueprintVars.install_extra_plugins = [
        { resource: "wordpress.org/plugins", slug: plugin.slug },
      ];
    } else if (remoteSource === "url") {
      blueprintVars.install_extra_plugins = [
        { resource: "url", url: plugin.downloadUrl },
      ];
    }
  }

  // Start server
  const { child: serverProcess, url } = await startServer({
    pluginDir,
    pluginSlug,
    blueprintVars,
  });

  console.log(`\n  Playground running at: ${url}\n`);

  let codegenProcess = null;
  if (codegenFlag) {
    codegenProcess = launchCodegen(url);
  }

  // Graceful shutdown
  const cleanup = () => {
    console.log("\nShutting down ...");
    if (codegenProcess) {
      try {
        codegenProcess.kill();
      } catch {
        // ignore
      }
    }
    try {
      serverProcess.kill();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // If codegen was launched, also shut down when it exits.
  if (codegenProcess) {
    codegenProcess.on("close", () => {
      console.log("Codegen closed.");
      cleanup();
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
