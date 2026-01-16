/**
 * create-playground-blueprint.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Contract tests for the blueprint generator (`scripts/create-playground-blueprint.js`).
 *
 * What we validate:
 *   - Default blueprint values (e.g. landingPage)
 *   - Conditional steps that workflows and e2e runs depend on
 *   - API contracts (e.g. addSteps expects arrays)
 *
 * Notes:
 *   These tests intentionally do not start WordPress Playground. They only assert
 *   on the generated blueprint object for speed and determinism.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
} = require("../../scripts/create-playground-blueprint.js");

function findWpCliCommand(steps, includes) {
  // ---------------------------------------------------------------------------
  // Helper: locate a wp-cli step by a substring in its command.
  // ---------------------------------------------------------------------------
  const step = steps.find(
    (s) => s?.step === "wp-cli" && String(s.command || "").includes(includes)
  );
  return step?.command;
}

function findInstallPluginStep(steps, predicate) {
  // ---------------------------------------------------------------------------
  // Helper: locate an installPlugin step by a predicate.
  // ---------------------------------------------------------------------------
  return steps.find((s) => s?.step === "installPlugin" && predicate(s));
}

test("BlueprintBuilder: sets default landingPage", () => {
  // Default landingPage is part of the public contract.
  const builder = new BlueprintBuilder({}, applyKrokedilBlueprintTemplate);
  assert.equal(builder.blueprint.landingPage, "/wp-admin/plugins.php");
});

test("Template: base_woocommerce installs WooCommerce", () => {
  // When base_woocommerce is enabled, WooCommerce must be installed+activated.
  const builder = new BlueprintBuilder(
    { base_woocommerce: true },
    applyKrokedilBlueprintTemplate
  );
  const step = findInstallPluginStep(
    builder.blueprint.steps,
    (s) => s?.pluginData?.slug === "woocommerce"
  );
  assert.ok(step, "Expected an installPlugin step for WooCommerce");
  assert.equal(step.options?.activate, true);
});

test("Template: wc_beta_tester config uses option update (no patch)", () => {
  // We use `wp option update ... --format=json` to avoid patch failures when the
  // option/key does not exist yet.
  const builder = new BlueprintBuilder(
    { wc_beta_tester: true },
    applyKrokedilBlueprintTemplate
  );
  const command = findWpCliCommand(
    builder.blueprint.steps,
    "wc_beta_tester_options"
  );
  assert.ok(
    command,
    "Expected a wp-cli step configuring wc_beta_tester_options"
  );
  assert.match(command, /wp option update wc_beta_tester_options/);
  assert.match(command, /\"channel\":\"rc\"/);
  assert.match(command, /--format=json/);
});

test("Template: plugin_dev_zip_aws_s3_public_url installs plugin from URL", () => {
  // Mirrors the workflow behavior (installing a dev zip from a public URL).
  const url = "https://example.com/plugin.zip";
  const builder = new BlueprintBuilder(
    { plugin_dev_zip_aws_s3_public_url: url },
    applyKrokedilBlueprintTemplate
  );

  const step = findInstallPluginStep(
    builder.blueprint.steps,
    (s) => s?.pluginData?.resource === "url" && s?.pluginData?.url === url
  );

  assert.ok(step, "Expected an installPlugin step for plugin dev zip URL");
  assert.equal(step.options?.activate, true);
});

test("Template: activate_plugin_slugs creates a wp plugin activate command", () => {
  // e2e runs rely on activating the mounted plugin by its slug.
  const builder = new BlueprintBuilder(
    { activate_plugin_slugs: "my-plugin" },
    applyKrokedilBlueprintTemplate
  );
  const command = findWpCliCommand(
    builder.blueprint.steps,
    "wp plugin activate"
  );
  assert.ok(command, "Expected a wp-cli activation step");
  assert.match(command, /wp plugin activate my-plugin/);
  assert.match(command, /--skip-plugins/);
  assert.match(command, /--skip-themes/);
});

test("BlueprintBuilder.addSteps: throws if steps is not an array", () => {
  // API contract: addSteps(condition, stepsArray)
  const builder = new BlueprintBuilder({});
  assert.throws(
    () => builder.addSteps(true, { step: "resetData" }),
    /expects an array of steps/
  );
});
