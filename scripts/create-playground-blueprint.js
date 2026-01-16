const fs = require("fs");
const path = require("path");

const PLAYGROUND_SCHEMA_URL =
  "https://playground.wordpress.net/blueprint-schema.json";

let compiledSchemaValidatorPromise;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

async function getCompiledPlaygroundSchemaValidator() {
  if (compiledSchemaValidatorPromise) return compiledSchemaValidatorPromise;

  compiledSchemaValidatorPromise = (async () => {
    const Ajv = require("ajv");
    const addFormats = require("ajv-formats");

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    const schema = await fetchJson(PLAYGROUND_SCHEMA_URL);

    return ajv.compile(schema);
  })();

  return compiledSchemaValidatorPromise;
}

function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) return "Unknown schema validation error.";
  return errors
    .map((error) => {
      const instancePath = error.instancePath || "(root)";
      const message = error.message || "invalid";
      return `${instancePath}: ${message}`;
    })
    .join("\n");
}

/**
 * Supported variables for the blueprint template.
 *
 * Conventions:
 * - Booleans: missing/undefined behaves like false.
 * - Strings: missing/undefined falls back to defaults shown below.
 *
 * @typedef {Object} BlueprintVariables
 * @property {string}  [blueprint_name] Blueprint description/title. Default: "Generated WordPress Playground Blueprint"
 * @property {string}  [landing_page]  Initial page inside WP. Default: "/wp-admin/plugins.php"
 * @property {boolean} [login]         Whether to auto-login. Default: true
 *
 * @property {string}  [php_version]   Preferred PHP version. Default: "latest"
 * @property {string}  [wp_version]    Preferred WP version. Default: "beta"
 *
 * @property {string}  [blogname]      WordPress site title. Default: "Krokedil WP CI Site"
 *
 * @property {boolean} [base_woocommerce] If true, installs/configures WooCommerce.
 * @property {string}  [woocommerce_default_country] Default: "SE"
 * @property {string}  [woocommerce_currency]        Default: "SEK"
 * @property {string}  [woocommerce_price_num_decimals] Default: "2"
 *
 * @property {boolean} [wc_beta_tester] If true, installs WooCommerce Beta Tester and switches to RC channel.
 *
 * @property {string}  [plugin_dev_zip_aws_s3_public_url] If set, installs/activates plugin zip from URL.
 * @property {string}  [activate_plugin_slugs] Space-separated plugin slugs to activate via wp-cli.
 */

/**
 * WordPress Playground Blueprint Builder
 * Template-driven engine for dynamic WP environments.
 */
class BlueprintBuilder {
  /**
   * @param {BlueprintVariables} variables - Key-value pairs for dynamic replacement.
   * @param {Function} templateFn - A function that defines the steps using 'this.addSteps'.
   */
  constructor(variables = {}, templateFn = null) {
    this.variables = variables;

    this.blueprint = {
      $schema: PLAYGROUND_SCHEMA_URL,
      description: this.getVar(
        "blueprint_name",
        "Krokedil WP CI generated WordPress Playground Blueprint"
      ),
      preferredVersions: {
        php: this.getVar("php_version", "8.3"),
        wp: this.getVar("wp_version", "beta"),
      },
      landingPage: this.getVar("landing_page", "/wp-admin/plugins.php"),
      login: this.getVar("login", true),
      steps: [],
    };

    // Automatically run the template if provided
    if (typeof templateFn === "function") {
      templateFn(this);
    }
  }

  /**
   * Access a variable with a fallback.
   */
  getVar(key, fallback = null) {
    return this.variables[key] !== undefined ? this.variables[key] : fallback;
  }

  /**
   * Internal method to add steps based on logic.
   *
   * Expects an array of step objects (even for a single step).
   */
  addSteps(condition, steps) {
    const shouldAdd =
      typeof condition === "function" ? condition(this.variables) : condition;

    if (shouldAdd) {
      if (!Array.isArray(steps)) {
        throw new Error(
          "BlueprintBuilder.addSteps expects an array of steps. Wrap single steps in an array."
        );
      }

      this.blueprint.steps.push(...steps);
    }
    return this;
  }

  /**
   * Validates this blueprint against the official WordPress Playground schema.
   * Fetches and compiles the schema once per process.
   */
  async validateWithSchema() {
    const validate = await getCompiledPlaygroundSchemaValidator();
    const valid = validate(this.blueprint);
    return { valid: !!valid, errors: validate.errors || [] };
  }

  async assertValidWithSchema() {
    const result = await this.validateWithSchema();
    if (!result.valid) {
      throw new Error(
        `Blueprint schema validation failed:\n${formatAjvErrors(result.errors)}`
      );
    }
  }

  /**
   * Generates a launchable URL.
   */
  async generateUrl() {
    await this.assertValidWithSchema();
    const jsonString = JSON.stringify(this.blueprint);
    const b64 = Buffer.from(jsonString, "utf8").toString("base64");
    return `https://playground.wordpress.net/#${b64}`;
  }

  /**
   * Exports to JSON file.
   */
  async saveToFile(fileName = "blueprint.json", dirPath = "./") {
    try {
      await this.assertValidWithSchema();
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const fullPath = path.join(dirPath, fileName);
      fs.writeFileSync(
        fullPath,
        JSON.stringify(this.blueprint, null, 2),
        "utf8"
      );
      console.log(`\x1b[32m✔ Blueprint saved to: ${fullPath}\x1b[0m`);
    } catch (error) {
      console.error(`\x1b[31m✘ Save failed: ${error.message}\x1b[0m`);
    }
    return this;
  }
}

// Export for use in other files.
// Export a plain object API (no backward-compat requirement).
if (typeof module !== "undefined") {
  module.exports = {
    BlueprintBuilder,
    applyKrokedilBlueprintTemplate,
    PLAYGROUND_SCHEMA_URL,
  };
}

// ==========================================
// CENTRALIZED STEPS DEFINITION (The Template)
// ==========================================

/**
 * Define ALL possible steps here.
 * The logic for which steps actually make it into the blueprint
 * is driven by the variables passed in.
 */
function applyKrokedilBlueprintTemplate(builder) {
  /** @type {BlueprintVariables} */
  const vars = builder.variables;

  // 1. Configure debug to true and logging in a centralized folder
  builder.addSteps(true, [
    {
      step: "mkdir",
      path: "/wordpress/wp-content/uploads/krokedil-wp-ci",
    },
    {
      step: "defineWpConfigConsts",
      consts: {
        WP_DEBUG: true,
        WP_DEBUG_DISPLAY: true,
        WP_DEBUG_LOG: "/wordpress/wp-content/uploads/krokedil-wp-ci/debug.log",
        WC_LOG_DIR: "/wordpress/wp-content/uploads/krokedil-wp-ci/wc-logs",
      },
    },
  ]);

  // 2. Delete default posts, comments and plugins
  builder.addSteps(true, [
    { step: "resetData" },
    {
      step: "rm",
      path: "/wordpress/wp-content/plugins/hello.php",
    },
    {
      step: "rmdir",
      path: "/wordpress/wp-content/plugins/akismet",
    },
  ]);

  // 2.5 Install and activate Storefront theme, then delete inactive themes
  builder.addSteps(true, [
    {
      step: "installTheme",
      themeData: {
        resource: "wordpress.org/themes",
        slug: "storefront",
      },
      options: {
        activate: true,
      },
    },
    {
      step: "wp-cli",
      command: "wp theme delete --all",
    },
  ]);

  // 2.6 Configure Storefront theme settings if requested
  builder.addSteps(!!vars.configure_storefront, [
    {
      step: "wp-cli",
      command: "wp widget reset --all",
    },
    {
      step: "wp-cli",
      command: "wp theme mod set storefront_product_pagination 0",
    },
  ]);

  // 3. Set site title and configure permalinks
  builder.addSteps(true, [
    {
      step: "setSiteOptions",
      options: {
        blogname: builder.getVar("blogname", "Krokedil WP CI Site"),
      },
    },
    {
      step: "writeFile",
      path: "/wordpress/wp-content/mu-plugins/rewrite.php",
      data: "<?php /* Use pretty permalinks */ add_action( 'after_setup_theme', function() { global $wp_rewrite; $wp_rewrite->set_permalink_structure('/%postname%/'); $wp_rewrite->flush_rules(); } );",
    },
  ]);

  // 4. Install and configure WooCommerce if requested
  builder.addSteps(!!vars.base_woocommerce, [
    {
      step: "installPlugin",
      pluginData: { resource: "wordpress.org/plugins", slug: "woocommerce" },
      options: { activate: true },
    },
    {
      step: "setSiteOptions",
      options: {
        show_on_front: "page",
        woocommerce_onboarding_profile: { skipped: true },
        woocommerce_default_country: builder.getVar(
          "woocommerce_default_country",
          "SE"
        ),
        woocommerce_currency: builder.getVar("woocommerce_currency", "SEK"),
        woocommerce_price_num_decimals: builder.getVar(
          "woocommerce_price_num_decimals",
          "2"
        ),
      },
    },
    {
      step: "wp-cli",
      command: "wp transient delete _wc_activation_redirect",
    },
    {
      step: "wp-cli",
      command:
        "wp wc product create --name='Simple product' --sku='simple-product' --regular_price='99.99' --virtual=false --downloadable=false --user='admin'",
    },
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; $page = get_page_by_path('refund_returns'); if ($page) { wp_publish_post($page->ID); update_option('woocommerce_terms_page_id', $page->ID); }",
    },
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; $shop_page_id = get_option('woocommerce_shop_page_id'); if ($shop_page_id) { update_option('page_on_front', $shop_page_id); update_option('show_on_front', 'page'); }",
    },
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; $checkout_page_id = get_option('woocommerce_checkout_page_id'); if ($checkout_page_id) { wp_update_post(['ID' => $checkout_page_id, 'post_content' => '[woocommerce_checkout]']); }",
    },
  ]);

  // 5. Install WC and WP Beta Tester plugins and update to RC versions if requested
  builder.addSteps(!!vars.wc_beta_tester, [
    {
      step: "installPlugin",
      pluginData: {
        resource: "url",
        url: "https://github.com/woocommerce/woocommerce/releases/download/wc-beta-tester-3.0.0/woocommerce-beta-tester.zip",
      },
      options: {
        activate: true,
      },
    },
    {
      step: "wp-cli",
      command:
        'wp option update wc_beta_tester_options \'{"channel":"rc"}\' --format=json',
    },
    {
      step: "wp-cli",
      command: "wp plugin update woocommerce",
    },
  ]);

  // 5. Install and activate plugin dev zip if requested
  builder.addSteps(!!vars.plugin_dev_zip_aws_s3_public_url, [
    {
      step: "installPlugin",
      pluginData: {
        resource: "url",
        url: vars.plugin_dev_zip_aws_s3_public_url,
      },
      options: { activate: true },
    },
  ]);

  // 6. Activate specific plugins if requested
  builder.addSteps(!!vars.activate_plugin_slugs, [
    {
      step: "wp-cli",
      command:
        "wp plugin activate " +
        vars.activate_plugin_slugs +
        " --skip-plugins --skip-themes",
    },
  ]);

  // 7. Write WooCommerce status report to krokedil-wp-ci folder after blueprint setup
  builder.addSteps(true, [
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; $class = 'Automattic\\\\WooCommerce\\\\Utilities\\\\RestApiUtil'; // Ensure we run as admin so REST has caps\nwp_set_current_user( 1 ); if ( class_exists( $class ) ) { $system_report = wc_get_container()->get( $class )->get_endpoint_data( '/wc/v3/system_status' ); } else { $system_report = array( 'error' => 'RestApiUtil not available', 'version' => defined( 'WC_VERSION' ) ? WC_VERSION : null ); } $dir = '/wordpress/wp-content/uploads/krokedil-wp-ci/'; $path = $dir . 'wc-system-report.json'; file_put_contents( $path, wp_json_encode( $system_report, JSON_PRETTY_PRINT ) );",
    },
  ]);
}
