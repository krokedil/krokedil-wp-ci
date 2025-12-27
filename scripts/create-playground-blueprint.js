#!/usr/bin/env node

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");

const {
  createPlaygroundE2EBlueprint,
  createPlaygroundMinimalBlueprint,
} = require("./lib/playground-blueprint");

function parseArgs(argv) {
  const args = {
    mode: "e2e",
    out: "",
    uploadsDirVfs: "",
    landingPage: "",
    preferredWp: "",
    preferredPhp: "",
    pluginUrl: "",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" || a === "-m") args.mode = argv[++i] || args.mode;
    else if (a === "--out" || a === "-o") args.out = argv[++i] || args.out;
    else if (a === "--uploads-dir-vfs") args.uploadsDirVfs = argv[++i] || "";
    else if (a === "--landing-page") args.landingPage = argv[++i] || "";
    else if (a === "--preferred-wp") args.preferredWp = argv[++i] || "";
    else if (a === "--preferred-php") args.preferredPhp = argv[++i] || "";
    else if (a === "--plugin-url") args.pluginUrl = argv[++i] || "";
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      // allow `node script.js some/path.json` as output
      if (!args.out) args.out = a;
    }
  }

  return args;
}

function printHelp() {
  const text = `Create a WordPress Playground blueprint file.

Usage:
  node scripts/create-playground-blueprint.js --out <path> [options]
  node scripts/create-playground-blueprint.js <path>

Options:
  --mode, -m            e2e | minimal (default: e2e)
  --out, -o             Output file path (required)
  --uploads-dir-vfs     VFS uploads dir, e.g. /wordpress/wp-content/uploads/krokedil-wp-ci
  --landing-page        Landing page URL path, e.g. /wp-admin/plugins.php
  --preferred-wp        Preferred WP version (minimal mode only)
  --preferred-php       Preferred PHP version (minimal mode only)
  --plugin-url          Plugin zip URL (minimal mode only)
`;
  process.stdout.write(text);
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.out) {
    console.error("Missing --out <path> (or pass a path as first arg)");
    printHelp();
    process.exit(1);
  }

  let blueprint;

  if (args.mode === "e2e") {
    blueprint = createPlaygroundE2EBlueprint({
      uploadsDirVfs: args.uploadsDirVfs || undefined,
    });
  } else if (args.mode === "minimal") {
    const preferredVersions =
      args.preferredWp && args.preferredPhp
        ? { wp: args.preferredWp, php: args.preferredPhp }
        : undefined;

    blueprint = createPlaygroundMinimalBlueprint({
      landingPage: args.landingPage || "/wp-admin/plugins.php",
      preferredVersions,
      pluginUrl: args.pluginUrl || undefined,
    });
  } else {
    console.error(`Unknown --mode: ${args.mode}`);
    process.exit(1);
  }

  if (args.landingPage && args.mode === "e2e") {
    blueprint.landingPage = args.landingPage;
  }

  const outPath = path.resolve(process.cwd(), args.out);
  ensureDirForFile(outPath);
  fs.writeFileSync(outPath, JSON.stringify(blueprint, null, 2) + "\n", "utf8");
  process.stdout.write(`Wrote blueprint: ${outPath}\n`);
}

main();
