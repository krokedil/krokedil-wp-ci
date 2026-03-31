#!/usr/bin/env node
// scripts/playground.js
// ---------------------------------------------------------------------------
// Purpose
//   Start a WordPress Playground server with a Krokedil plugin installed.
//   Optionally launch Playwright codegen for visual selector/assertion authoring.
//
// Usage
//   node scripts/playground.js <plugin> [--dir <path>] [--branch <name>] [--codegen] [--list]
//
//   <plugin>    Abbreviation, slug, or display name from .github/plugins.json.
//               Special value "dummy" uses the in-repo fixture plugin.
//   --dir       Use an existing local directory instead of cloning from GitHub.
//   --branch    Branch to clone/checkout (default: repo default branch).
//   --codegen   After the server starts, launch `npx playwright codegen` against it.
//   --list      Print available plugins and exit.
//
// Inputs
//   - .github/plugins.json for plugin registry (abbreviation, repository).
//   - scripts/lib/blueprint/ for BlueprintBuilder + template.
//   - Plugin's .github/plugin-meta.json for slug (optional — falls back to repo name).
//
// Behavior
//   1. Resolve the plugin identifier to a plugins.json entry.
//   2. Obtain the plugin source: --dir path, fixture path, or shallow git clone.
//   3. Build a Playground blueprint with WooCommerce + the plugin's own blueprint.
//   4. Start the Playground server with the plugin auto-mounted.
//   5. If --codegen, spawn playwright codegen pointed at /wp-admin/.
//   6. Wait for SIGINT, then clean up.
//
// Failure modes
//   - Unknown plugin identifier: exits with error and lists available plugins.
//   - git clone failure: exits with error.

const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawn } = require("node:child_process");

const {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
} = require("./lib/blueprint/index.js");
const { loadPlugins, resolvePlugin } = require("./lib/resolve-plugin.js");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGINS_JSON_PATH = path.join(REPO_ROOT, ".github", "plugins.json");
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
    console.log(
      `  ${p.abbreviation.padEnd(maxAbbr)}  ${slug}  (${p.displayName})`,
    );
  }
  console.log(`\n  ${"dummy".padEnd(maxAbbr)}  dummy-plugin-for-repo-tests  (in-repo fixture)\n`);
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
    return { pluginDir, pluginMetaJson: tryReadPluginMeta(pluginDir) };
  }

  // 2. Dummy fixture (no clone needed)
  if (plugin._isDummy) {
    return {
      pluginDir: DUMMY_PLUGIN_DIR,
      pluginMetaJson: tryReadPluginMeta(DUMMY_PLUGIN_DIR),
    };
  }

  // 3. Clone from GitHub
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
        execSync(`git checkout ${branchFlag}`, {
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

  return { pluginDir: cloneDir, pluginMetaJson: tryReadPluginMeta(cloneDir) };
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

async function startServer({ pluginDir, pluginSlug, repoSlug }) {
  const outDir = path.join(PLAYGROUND_TMP_DIR, "logs");
  fs.mkdirSync(outDir, { recursive: true });

  const blueprintVars = {
    plugin_blueprints: ["woocommerce", repoSlug],
    install_woocommerce: true,
    install_wc_beta_tester: true,
    configure_debug_logs: true,
    ...(pluginSlug ? { activate_plugin_slugs: pluginSlug } : {}),
  };

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
    `--auto-mount=${pluginDir}`,
  ];

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
  const dirIndex = args.indexOf("--dir");
  const dirFlag = dirIndex !== -1 ? args[dirIndex + 1] : null;
  const branchIndex = args.indexOf("--branch");
  const branchFlag = branchIndex !== -1 ? args[branchIndex + 1] : null;

  // Positional: first arg that doesn't start with -- and isn't a value for a flag.
  const flagValueIndices = new Set(
    [dirIndex, branchIndex].filter((i) => i !== -1).map((i) => i + 1),
  );
  const positional = args.find(
    (a, i) => !a.startsWith("--") && !flagValueIndices.has(i),
  );

  const plugins = loadPlugins(PLUGINS_JSON_PATH);

  if (listFlag) {
    printList(plugins);
    process.exit(0);
  }

  if (!positional) {
    console.error(
      "\nUsage: node scripts/playground.js <plugin> [--dir <path>] [--branch <name>] [--codegen]\n" +
        "       node scripts/playground.js --list\n",
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

  // Get plugin source
  const { pluginDir, pluginMetaJson } = resolvePluginSource({
    plugin,
    dirFlag,
    branchFlag,
  });

  const hasPluginMeta = pluginMetaJson != null;
  const pluginSlug = (hasPluginMeta && pluginMetaJson.slug) || null;

  console.log(`Source:  ${pluginDir}`);
  if (pluginSlug) {
    console.log(`Slug:    ${pluginSlug}`);
  } else {
    console.log(
      `Note:    No .github/plugin-meta.json found — the plugin will not be activated automatically.`,
    );
  }

  // Start server
  const { child: serverProcess, url } = await startServer({
    pluginDir,
    pluginSlug,
    repoSlug,
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
