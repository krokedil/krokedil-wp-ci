#!/usr/bin/env node
/**
 * instawp/generate-blueprint.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Generate a unified WordPress blueprint JSON file for InstaWP site setup.
 *   Uses the Krokedil blueprint template with full WooCommerce store
 *   configuration and plugin-specific blueprints.
 *
 * Inputs (env vars):
 *   - PLUGIN_META_FILE     : Path to plugin-meta.json (default: .github/plugin-meta.json).
 *   - BLUEPRINT_OUTPUT_PATH: Path to write the generated blueprint JSON
 *                            (default: /tmp/generated-blueprint.json).
 *   - Plus any env vars consumed by plugin blueprints (e.g. KCO_TEST_MERCHANT_ID_EU).
 *
 * Behavior:
 *   1. Reads plugin slug from plugin-meta.json.
 *   2. Builds a blueprint with full WC store config + plugin blueprint.
 *   3. Writes the blueprint JSON to the output path.
 *
 * Failure modes:
 *   - Missing plugin-meta.json exits with code 1.
 *   - JSON parse errors exit with code 1.
 */
const fs = require("node:fs");
const path = require("node:path");

const {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
  getPresetVariables,
} = require("../lib/blueprint");

function main() {
  const metaFile = process.env.PLUGIN_META_FILE || ".github/plugin-meta.json";
  const outputPath =
    process.env.BLUEPRINT_OUTPUT_PATH || "/tmp/generated-blueprint.json";

  if (!fs.existsSync(metaFile)) {
    console.error(`Error: ${metaFile} not found`);
    process.exit(1);
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  } catch (error) {
    console.error(`Error parsing ${metaFile}: ${error.message}`);
    process.exit(1);
  }

  const slug = meta.slug;
  if (!slug) {
    console.error("Error: plugin-meta.json must have a slug field");
    process.exit(1);
  }

  const blueprintVars = getPresetVariables(
    "full-store",
    { pluginSlug: slug, repoSlug: slug },
    { configure_debug_logs: false },
  );

  const builder = new BlueprintBuilder(
    blueprintVars,
    applyKrokedilBlueprintTemplate,
  );

  const blueprint = builder.toJSON();
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(blueprint, null, 2), "utf8");
  console.log(`Blueprint written to ${outputPath}`);
}

main();
