// blueprint/blueprint-builder.js
// ---------------------------------------------------------------------------
// Purpose
//   Programmatic WordPress Playground Blueprint builder.
//
// Inputs
//   - variables: key-value replacements used by the template.
//   - templateFn(builder): optional function that calls builder.addSteps(...)
//
// Failure modes
//   - Schema validation throws with a detailed Ajv error string.

const fs = require("fs");
const path = require("path");

const {
  PLAYGROUND_SCHEMA_URL,
  getCompiledPlaygroundSchemaValidator,
  formatAjvErrors,
} = require("./schema.js");

/**
 * Supported variables for the blueprint template.
 *
 * Conventions:
 * - Booleans: missing/undefined behaves like false.
 * - Strings: missing/undefined falls back to defaults shown below.
 *
 * @typedef {Object} BlueprintVariables
 * @property {string}  [blueprint_name] Blueprint description/title. Default: "Krokedil WP CI generated WordPress Playground Blueprint"
 * @property {string}  [landing_page] Initial page inside WP. Default: "/wp-admin/plugins.php"
 * @property {boolean} [login] Whether to auto-login. Default: true
 *
 * @property {string}  [php_version] Preferred PHP version. Default: "8.3"
 * @property {string}  [wp_version] Preferred WP version. Default: "beta"
 *
 * @property {string}  [blogname] WordPress site title. Default: "Krokedil WP CI Site"
 *
 * @property {boolean} [configure_debug_logs] If true, enables WP debug + writes logs to /wp-content/uploads/krokedil-wp-ci.
 * @property {boolean} [reset_wordpress] If true, resets default content and removes default plugins.
 * @property {boolean} [install_storefront] If true, installs + activates the Storefront theme (and deletes inactive themes).
 * @property {boolean} [configure_storefront] If true, applies Storefront-specific settings (widgets + pagination).
 * @property {boolean} [configure_general_site_options] If true, sets general site options (title, permalinks, date/time, etc.).
 *
 * @property {boolean} [install_woocommerce] If true, installs WooCommerce.
 * @property {boolean} [configure_woocommerce_minimal] If true, applies minimal WC config (country, currency, test product, pages, COD payment, coming-soon off). Also applied implicitly when configure_woocommerce_fully is true.
 * @property {boolean} [configure_woocommerce_fully] If true, applies comprehensive Swedish test store settings on top of minimal configuration.
 * @property {string}  [woocommerce_default_country] Default: "SE"
 * @property {string}  [woocommerce_currency]        Default: "SEK"
 * @property {string}  [woocommerce_price_num_decimals] Default: "2"
 *
 * @property {boolean} [install_wc_beta_tester] If true, installs WooCommerce Beta Tester and switches to RC channel.
 *
 * @property {string[]} [plugin_blueprints] Array of plugin slugs whose blueprints should be applied.
 *
 * @property {string}  [custom_wp_cli_command] If set, runs this wp-cli command after setup.
 *
 * @property {boolean} [generate_site_health_report] If true, writes wp-site-health-info.json to /wp-content/uploads/krokedil-wp-ci.
 * @property {boolean} [generate_wc_status_report] If true, writes wc-system-report.json to /wp-content/uploads/krokedil-wp-ci.
 *
 * @property {Array<{resource: string, slug?: string, url?: string}>} [install_extra_plugins] Additional plugins to install from wordpress.org or URL. Each entry is an installPlugin resource definition.
 *
 * @property {string}  [plugin_dev_zip_aws_s3_public_url] If set, installs/activates plugin zip from URL.
 * @property {string}  [activate_plugin_slugs] Space-separated plugin slugs to activate via wp-cli.
 */

class BlueprintBuilder {
  /**
   * @param {BlueprintVariables} variables
   * @param {Function | null} templateFn
   */
  constructor(variables = {}, templateFn = null) {
    this.variables = variables;

    this.blueprint = {
      $schema: PLAYGROUND_SCHEMA_URL,
      description: this.getVar(
        "blueprint_name",
        "Krokedil WP CI generated WordPress Playground Blueprint",
      ),
      preferredVersions: {
        php: this.getVar("php_version", "8.3"),
        wp: this.getVar("wp_version", "beta"),
      },
      landingPage: this.getVar("landing_page", "/wp-admin/plugins.php"),
      login: this.getVar("login", true),
      steps: [],
    };

    if (typeof templateFn === "function") {
      templateFn(this);
    }
  }

  getVar(key, fallback = null) {
    return this.variables[key] !== undefined ? this.variables[key] : fallback;
  }

  addSteps(condition, steps) {
    const shouldAdd =
      typeof condition === "function" ? condition(this.variables) : condition;

    if (shouldAdd) {
      if (!Array.isArray(steps)) {
        throw new Error(
          "BlueprintBuilder.addSteps expects an array of steps. Wrap single steps in an array.",
        );
      }

      this.blueprint.steps.push(...steps);
    }
    return this;
  }

  async validateWithSchema() {
    const validate = await getCompiledPlaygroundSchemaValidator();
    const valid = validate(this.blueprint);
    return { valid: !!valid, errors: validate.errors || [] };
  }

  async assertValidWithSchema() {
    const result = await this.validateWithSchema();
    if (!result.valid) {
      throw new Error(
        `Blueprint schema validation failed:\n${formatAjvErrors(result.errors)}`,
      );
    }
  }

  async generatePlaygroundUrl() {
    await this.assertValidWithSchema();
    const jsonString = JSON.stringify(this.blueprint);
    const b64 = Buffer.from(jsonString, "utf8").toString("base64");
    return `https://playground.wordpress.net/#${b64}`;
  }

  async generateUrl() {
    return this.generatePlaygroundUrl();
  }

  toJSON() {
    return this.blueprint;
  }

  async saveToFile(fileName = "blueprint.json", dirPath = "./") {
    try {
      await this.assertValidWithSchema();
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const fullPath = path.join(dirPath, fileName);
      fs.writeFileSync(
        fullPath,
        JSON.stringify(this.blueprint, null, 2),
        "utf8",
      );
      console.log(`\x1b[32m✔ Blueprint saved to: ${fullPath}\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[31m✘ Save failed: ${error.message}\x1b[0m`);
    }
    return this;
  }
}

module.exports = {
  BlueprintBuilder,
};
