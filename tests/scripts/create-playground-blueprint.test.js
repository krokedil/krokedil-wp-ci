/**
 * create-playground-blueprint.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Contract tests for the blueprint builder (`scripts/lib/blueprint/index.js`).
 *
 * What we validate:
 *   - Default blueprint values (e.g. landingPage)
 *   - Conditional steps that workflows and e2e runs depend on
 *   - API contracts (e.g. addSteps expects arrays)
 *   - Plugin blueprint loading and template integration
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
  loadPluginBlueprint,
} = require("../../scripts/lib/blueprint/index.js");

function findWpCliCommand(steps, includes) {
  // ---------------------------------------------------------------------------
  // Helper: locate a wp-cli step by a substring in its command.
  // ---------------------------------------------------------------------------
  const step = steps.find(
    (s) => s?.step === "wp-cli" && String(s.command || "").includes(includes),
  );
  return step?.command;
}

function findInstallPluginStep(steps, predicate) {
  // ---------------------------------------------------------------------------
  // Helper: locate an installPlugin step by a predicate.
  // ---------------------------------------------------------------------------
  return steps.find((s) => s?.step === "installPlugin" && predicate(s));
}

function findSetSiteOptionsStep(steps, optionKey) {
  return steps.find(
    (s) => s?.step === "setSiteOptions" && s?.options?.[optionKey] !== undefined,
  );
}

test("BlueprintBuilder: sets default landingPage", () => {
  // Default landingPage is part of the public contract.
  const builder = new BlueprintBuilder({}, applyKrokedilBlueprintTemplate);
  assert.equal(builder.blueprint.landingPage, "/wp-admin/plugins.php");
});

test("Template: install_woocommerce installs WooCommerce", () => {
  // When install_woocommerce is enabled via plugin_blueprints, WooCommerce must be installed.
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["woocommerce"], install_woocommerce: true },
    applyKrokedilBlueprintTemplate,
  );
  const step = findInstallPluginStep(
    builder.blueprint.steps,
    (s) => s?.pluginData?.slug === "woocommerce",
  );
  assert.ok(step, "Expected an installPlugin step for WooCommerce");
  assert.equal(step.options?.activate, true);
});

test("Template: install_wc_beta_tester config uses option update (no patch)", () => {
  // We use `wp option update ... --format=json` to avoid patch failures when the
  // option/key does not exist yet.
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["woocommerce"], install_wc_beta_tester: true },
    applyKrokedilBlueprintTemplate,
  );
  const command = findWpCliCommand(
    builder.blueprint.steps,
    "wc_beta_tester_options",
  );
  assert.ok(
    command,
    "Expected a wp-cli step configuring wc_beta_tester_options",
  );
  assert.match(command, /wp option update wc_beta_tester_options/);
  assert.match(command, /\"channel\":\"rc\"/);
  assert.match(command, /--format=json/);
});

test("Template: plugin_dev_zip_aws_s3_public_url installs plugin from URL", () => {
  // Mirrors the workflow behavior (installing a dev zip from a public URL).
  const url = "https://example.com/plugin.zip";
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["woocommerce"], plugin_dev_zip_aws_s3_public_url: url },
    applyKrokedilBlueprintTemplate,
  );

  const step = findInstallPluginStep(
    builder.blueprint.steps,
    (s) => s?.pluginData?.resource === "url" && s?.pluginData?.url === url,
  );

  assert.ok(step, "Expected an installPlugin step for plugin dev zip URL");
  assert.equal(step.options?.activate, true);
});

test("Template: activate_plugin_slugs creates a wp plugin activate command", () => {
  // e2e runs rely on activating the mounted plugin by its slug.
  const builder = new BlueprintBuilder(
    { activate_plugin_slugs: "my-plugin" },
    applyKrokedilBlueprintTemplate,
  );
  const command = findWpCliCommand(
    builder.blueprint.steps,
    "wp plugin activate",
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
    /expects an array of steps/,
  );
});

// ---------------------------------------------------------------------------
// Plugin blueprint loader tests
// ---------------------------------------------------------------------------

test("loadPluginBlueprint: returns null for unknown slug", () => {
  const fn = loadPluginBlueprint("nonexistent-plugin-slug-12345");
  assert.equal(fn, null);
});

test("loadPluginBlueprint: loads woocommerce blueprint as a function", () => {
  const fn = loadPluginBlueprint("woocommerce");
  assert.equal(typeof fn, "function");
});

test("loadPluginBlueprint: loads klarna-checkout-for-woocommerce blueprint as a function", () => {
  const fn = loadPluginBlueprint("klarna-checkout-for-woocommerce");
  assert.equal(typeof fn, "function");
});

// ---------------------------------------------------------------------------
// Template plugin_blueprints integration tests
// ---------------------------------------------------------------------------

test("Template: plugin_blueprints applies woocommerce blueprint", () => {
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["woocommerce"], install_woocommerce: true },
    applyKrokedilBlueprintTemplate,
  );
  const step = findInstallPluginStep(
    builder.blueprint.steps,
    (s) => s?.pluginData?.slug === "woocommerce",
  );
  assert.ok(step, "WooCommerce should be installed via plugin blueprint");
});

test("Template: plugin_blueprints applies KCO blueprint with gateway ordering", () => {
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["klarna-checkout-for-woocommerce"] },
    applyKrokedilBlueprintTemplate,
  );
  const command = findWpCliCommand(
    builder.blueprint.steps,
    "payment_gateway update kco",
  );
  assert.ok(command, "Expected KCO payment gateway ordering step");
});

test("Template: plugin_blueprints skips unknown slugs silently", () => {
  // Should not throw for unknown plugin slugs.
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["nonexistent-plugin"] },
    applyKrokedilBlueprintTemplate,
  );
  assert.ok(builder.blueprint.steps.length === 0 || true, "Should not throw");
});

test("Template: configure_woocommerce_store adds comprehensive store settings", () => {
  const builder = new BlueprintBuilder(
    { plugin_blueprints: ["woocommerce"], configure_woocommerce_store: true },
    applyKrokedilBlueprintTemplate,
  );
  const step = findSetSiteOptionsStep(builder.blueprint.steps, "woocommerce_store_address");
  assert.ok(step, "Expected comprehensive WC store config step");
  assert.equal(step.options.woocommerce_store_address, "Test Road 1");
});
