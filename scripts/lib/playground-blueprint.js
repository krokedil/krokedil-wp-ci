// Shared WordPress Playground blueprint creators.
// Keep this file CommonJS so it can be used by repo root scripts.

const BLUEPRINT_SCHEMA_URL =
  "https://playground.wordpress.net/blueprint-schema.json";

function normalizeDir(dir) {
  if (!dir) return dir;
  return dir.endsWith("/") ? dir : dir + "/";
}

function createPlaygroundE2EBlueprint(options = {}) {
  const uploadsDirVfs =
    options.uploadsDirVfs || "/wordpress/wp-content/uploads/krokedil-wp-ci";
  const uploadsDirVfsNormalized = uploadsDirVfs.replace(/\/$/, "");

  const blueprint = {
    $schema: BLUEPRINT_SCHEMA_URL,
    steps: [
      { step: "resetData" },
      { step: "mkdir", path: uploadsDirVfsNormalized },
      {
        step: "defineWpConfigConsts",
        consts: {
          WP_DEBUG: true,
          WP_DEBUG_LOG: `${uploadsDirVfsNormalized}/debug.log`,
          WC_LOG_DIR: normalizeDir(`${uploadsDirVfsNormalized}/wc-logs`),
        },
      },
      { step: "rm", path: "/wordpress/wp-content/plugins/hello.php" },
      { step: "rmdir", path: "/wordpress/wp-content/plugins/akismet" },
      {
        step: "writeFile",
        path: "/wordpress/wp-content/mu-plugins/rewrite.php",
        data: "<?php /* Use pretty permalinks */ add_action( 'after_setup_theme', function() { global $wp_rewrite; $wp_rewrite->set_permalink_structure('/%postname%/'); $wp_rewrite->flush_rules(); } );",
      },
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
          woocommerce_default_country: "SE",
          woocommerce_currency: "SEK",
          woocommerce_price_num_decimals: "2",
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
      { step: "wp-cli", command: "wp plugin activate --all" },
      {
        step: "runPHP",
        code: `<?php require_once '/wordpress/wp-load.php'; $class = 'Automattic\\WooCommerce\\Utilities\\RestApiUtil'; // Ensure we run as admin so REST has caps\nwp_set_current_user( 1 ); if ( class_exists( $class ) ) { $system_report = wc_get_container()->get( $class )->get_endpoint_data( '/wc/v3/system_status' ); } else { $system_report = array( 'error' => 'RestApiUtil not available', 'version' => defined( 'WC_VERSION' ) ? WC_VERSION : null ); } $dir = '${uploadsDirVfsNormalized}/'; $timestamp = gmdate( 'Ymd-His' ); $path = $dir . 'wc-system-report-' . $timestamp . '.json'; file_put_contents( $path, wp_json_encode( $system_report, JSON_PRETTY_PRINT ) );`,
      },
    ],
    login: true,
    landingPage: "/wp-admin/plugins.php",
  };

  return blueprint;
}

function createPlaygroundMinimalBlueprint(options = {}) {
  const { landingPage, preferredVersions, pluginUrl } = options;

  const blueprint = {
    $schema: BLUEPRINT_SCHEMA_URL,
    preferredVersions,
    steps: [
      {
        step: "defineWpConfigConsts",
        consts: {
          WP_DEBUG: true,
          WP_DEBUG_DISPLAY: true,
        },
      },
      { step: "resetData" },
      { step: "wp-cli", command: "wp plugin delete --all" },
      {
        step: "writeFile",
        path: "/wordpress/wp-content/mu-plugins/rewrite.php",
        data: "<?php /* Pretty permalinks */ add_action('after_setup_theme', function(){ global $wp_rewrite; $wp_rewrite->set_permalink_structure('/%postname%/'); $wp_rewrite->flush_rules(); });",
      },
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
          woocommerce_default_country: "SE",
          woocommerce_currency: "SEK",
          woocommerce_price_num_decimals: "2",
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
    ],
    login: true,
    landingPage,
  };

  if (pluginUrl) {
    blueprint.steps.push({
      step: "installPlugin",
      pluginData: { resource: "url", url: pluginUrl },
      options: { activate: true },
    });
  }

  return blueprint;
}

function toPlaygroundUrl(blueprintObj) {
  const json = JSON.stringify(blueprintObj);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return `https://playground.wordpress.net/#${b64}`;
}

module.exports = {
  BLUEPRINT_SCHEMA_URL,
  createPlaygroundE2EBlueprint,
  createPlaygroundMinimalBlueprint,
  toPlaygroundUrl,
};
