// blueprint/template.js
// ---------------------------------------------------------------------------
// Purpose
//   Main blueprint template for Krokedil WP CI. Handles WordPress-level setup
//   and orchestrates plugin blueprints.
//
// Inputs
//   - builder: BlueprintBuilder instance (must support builder.addSteps + builder.getVar)
//
// Variables used
//   - configure_debug_logs          : Enable WP debug + centralized logging.
//   - reset_wordpress               : Reset default content and remove default plugins.
//   - install_storefront            : Install + activate Storefront theme.
//   - configure_storefront          : Apply Storefront-specific settings.
//   - configure_general_site_options : Set general site options (title, permalinks, date/time, etc.).
//   - blogname                      : WordPress site title (default: "Krokedil WP CI Site").
//   - activate_plugin_slugs         : Space-separated plugin slugs to activate via wp-cli.
//   - plugin_blueprints             : Array of plugin slugs whose blueprints should be applied.
//   - install_extra_plugins         : Array of installPlugin resource defs (wordpress.org or URL).
//   - custom_wp_cli_command         : Run arbitrary wp-cli command after setup.
//   - generate_site_health_report   : Write wp-site-health-info.json.
//   - collect_composer_dependencies : Collect composer-dependencies.lock from all plugins.
//   - generate_wc_status_report     : Write wc-system-report.json.
//
//   Plus all variables consumed by plugin blueprints (e.g. woocommerce.js variables).

const { loadPluginBlueprint } = require("./plugins/loader.js");

function applyKrokedilBlueprintTemplate(builder) {
  const vars = builder.variables;

  // ---------------------------------------------------------------------------
  // 1. Configure debug to true and logging in a centralized folder
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.configure_debug_logs, [
    {
      step: "mkdir",
      path: "/wordpress/wp-content/uploads/krokedil-wp-ci",
    },
    {
      step: "defineWpConfigConsts",
      consts: {
        WP_DEBUG: true,
        WP_DEBUG_DISPLAY: false,
        WP_DEBUG_LOG: "/wordpress/wp-content/uploads/krokedil-wp-ci/debug.log",
        WC_LOG_DIR: "/wordpress/wp-content/uploads/krokedil-wp-ci/wc-logs",
        CONCATENATE_SCRIPTS: false,
      },
    },
  ]);

  // ---------------------------------------------------------------------------
  // 2. Delete default posts, comments and plugins
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 3. Install and activate Storefront theme, then delete inactive themes
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 4. Configure Storefront theme settings
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 5. Configure general site options
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.configure_general_site_options, [
    {
      step: "setSiteOptions",
      options: {
        blogname: builder.getVar("blogname", "Krokedil WP CI Site"),
        blogdescription: "By Krokedil",
        date_format: "Y-m-d",
        time_format: "H:i",
        start_of_week: "1",
        timezone_string: "Europe/Stockholm",
        blog_public: "0",
        show_on_front: "page",
      },
    },
    {
      step: "writeFile",
      path: "/wordpress/wp-content/mu-plugins/rewrite.php",
      data: "<?php /* Use pretty permalinks */ add_action( 'after_setup_theme', function() { global $wp_rewrite; $wp_rewrite->set_permalink_structure('/%postname%/'); $wp_rewrite->flush_rules(); } );",
    },
  ]);

  // ---------------------------------------------------------------------------
  // 6. Install extra plugins from wordpress.org or URL
  //    Runs before plugin activation and blueprints so the plugin files are
  //    present when activation and configuration happen.
  // ---------------------------------------------------------------------------
  const extraPlugins = vars.install_extra_plugins || [];
  for (const pluginDef of extraPlugins) {
    builder.addSteps(true, [
      {
        step: "installPlugin",
        pluginData: pluginDef,
        options: { activate: true },
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  // 7. Install and activate plugin dev zip from URL
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 8. Activate specific plugins by slug
  //    Runs before plugin blueprints so the plugin is active when its blueprint
  //    configures settings, payment gateways, etc.
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.activate_plugin_slugs, [
    {
      step: "wp-cli",
      command:
        "wp plugin activate " +
        vars.activate_plugin_slugs +
        " --skip-plugins --skip-themes",
    },
  ]);

  // ---------------------------------------------------------------------------
  // 9. Apply plugin blueprints
  //    Plugin blueprints are loaded by slug from scripts/lib/blueprint/plugins/.
  //    The plugin_blueprints variable is an array of slugs to apply.
  // ---------------------------------------------------------------------------
  const pluginSlugs = vars.plugin_blueprints || [];
  for (const slug of pluginSlugs) {
    const applyFn = loadPluginBlueprint(slug);
    if (applyFn) {
      applyFn(builder);
    }
  }

  // ---------------------------------------------------------------------------
  // 10. Run custom wp cli command
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.custom_wp_cli_command, [
    {
      step: "wp-cli",
      command: vars.custom_wp_cli_command,
    },
  ]);

  // ---------------------------------------------------------------------------
  // 11. Write WordPress site health info
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.generate_site_health_report, [
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; foreach ( ['update', 'plugin', 'file', 'misc', 'class-wp-debug-data'] as $file ) { require_once ABSPATH . 'wp-admin/includes/' . $file . '.php'; } $dir = '/wordpress/wp-content/uploads/krokedil-wp-ci/'; if ( ! file_exists( $dir ) ) { mkdir( $dir, 0777, true ); } file_put_contents( $dir . 'wp-site-health-info.json', json_encode( WP_Debug_Data::debug_data(), JSON_PRETTY_PRINT ) ); ?>",
    },
  ]);

  // ---------------------------------------------------------------------------
  // 12. Collect composer-dependencies.lock from all plugins that have one
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.collect_composer_dependencies, [
    {
      step: "runPHP",
      code: "<?php $result = array(); foreach ( glob( '/wordpress/wp-content/plugins/*/composer-dependencies.lock' ) as $lock_file ) { $slug = basename( dirname( $lock_file ) ); $content = json_decode( file_get_contents( $lock_file ), true ); if ( $content ) { $result[ $slug ] = $content; } } $dir = '/wordpress/wp-content/uploads/krokedil-wp-ci/'; if ( ! file_exists( $dir ) ) { mkdir( $dir, 0777, true ); } file_put_contents( $dir . 'composer-dependencies-all-plugins.json', json_encode( $result, JSON_PRETTY_PRINT ) ); ?>",
    },
  ]);

  // ---------------------------------------------------------------------------
  // 13. Write WooCommerce status report
  // ---------------------------------------------------------------------------
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
