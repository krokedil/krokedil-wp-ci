// playground/krokedil-template.js
// ---------------------------------------------------------------------------
// Purpose
//   Centralized WordPress Playground Blueprint step template used across this repo.
//
// Inputs
//   - builder: BlueprintBuilder instance (must support builder.addSteps + builder.getVar)
//
// Behavior
//   - Adds steps based on boolean/string variables.

function applyKrokedilBlueprintTemplate(builder) {
  const vars = builder.variables;

  // 1. Configure debug to true and logging in a centralized folder
  builder.addSteps(!!vars.configure_debug_logs, [
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
  builder.addSteps(!!vars.reset_wordpress, [
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
  builder.addSteps(!!vars.install_storefront, [
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

  // 2.6 Configure Storefront theme settings
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
  builder.addSteps(!!vars.configure_title_permalinks, [
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

  // 4. Install WooCommerce
  builder.addSteps(!!vars.install_woocommerce, [
    {
      step: "installPlugin",
      pluginData: { resource: "wordpress.org/plugins", slug: "woocommerce" },
      options: { activate: true },
    },
    {
      step: "setSiteOptions",
      options: {
        woocommerce_onboarding_profile: { skipped: true },
      },
    },
    {
      step: "wp-cli",
      command: "wp transient delete _wc_activation_redirect",
    },
  ]);

  // 6. Configure WooCommerce
  builder.addSteps(!!vars.configure_woocommerce, [
    {
      step: "setSiteOptions",
      options: {
        show_on_front: "page",
        woocommerce_default_country: builder.getVar(
          "woocommerce_default_country",
          "SE",
        ),
        woocommerce_currency: builder.getVar("woocommerce_currency", "SEK"),
        woocommerce_price_num_decimals: builder.getVar(
          "woocommerce_price_num_decimals",
          "2",
        ),
      },
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

  // 5. Install WC and WP Beta Tester plugins and update to RC versions
  builder.addSteps(!!vars.install_wc_beta_tester, [
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

  // 5. Install and activate plugin dev zip
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

  // 6. Activate specific plugins
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
  builder.addSteps(!!vars.generate_wc_status_report, [
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; $class = 'Automattic\\\\WooCommerce\\\\Utilities\\\\RestApiUtil'; // Ensure we run as admin so REST has caps\nwp_set_current_user( 1 ); if ( class_exists( $class ) ) { $system_report = wc_get_container()->get( $class )->get_endpoint_data( '/wc/v3/system_status' ); } else { $system_report = array( 'error' => 'RestApiUtil not available', 'version' => defined( 'WC_VERSION' ) ? WC_VERSION : null ); } $dir = '/wordpress/wp-content/uploads/krokedil-wp-ci/'; $path = $dir . 'wc-system-report.json'; file_put_contents( $path, wp_json_encode( $system_report, JSON_PRETTY_PRINT ) );",
    },
  ]);
}

module.exports = {
  applyKrokedilBlueprintTemplate,
};
