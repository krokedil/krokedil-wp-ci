// blueprint/plugins/woocommerce.js
// ---------------------------------------------------------------------------
// Purpose
//   WooCommerce plugin blueprint. Handles all WooCommerce-related setup:
//   install, basic configuration, full store configuration, and beta tester.
//
// Inputs
//   - builder: BlueprintBuilder instance
//
// Variables used
//   - install_woocommerce              : Install and activate WooCommerce.
//   - configure_woocommerce_minimal    : Minimal WC config (country, currency, test product,
//                                        pages, COD payment, coming-soon off).
//   - configure_woocommerce_fully      : Comprehensive Swedish test store settings on top of
//                                        minimal (tax, shipping, checkout, HPOS, etc).
//                                        Implicitly includes configure_woocommerce_minimal.
//   - woocommerce_default_country      : Default "SE".
//   - woocommerce_currency             : Default "SEK".
//   - woocommerce_price_num_decimals   : Default "2".
//   - install_wc_beta_tester           : Install WC Beta Tester and switch to RC channel.

/**
 * @param {import('../blueprint-builder.js').BlueprintBuilder} builder
 */
function applyWooCommerceBlueprint(builder) {
  const vars = builder.variables;

  // ---------------------------------------------------------------------------
  // 1. Install WooCommerce
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 2. Minimal WooCommerce configuration
  //    Makes the store functional and inspectable: country, currency, test
  //    product, pages, COD payment, and coming-soon disabled.
  //    Also applied implicitly when configure_woocommerce_fully is true.
  // ---------------------------------------------------------------------------
  builder.addSteps(
    !!vars.configure_woocommerce_minimal || !!vars.configure_woocommerce_fully,
    [
      {
        step: "setSiteOptions",
        options: {
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
          "wp wc product create --name='Simple product' --sku='simple-product' --regular_price='99.99' --virtual=false --downloadable=false --user=1",
      },
      {
        step: "runPHP",
        code: "<?php require_once '/wordpress/wp-load.php'; $page = get_page_by_path('refund_returns'); if ($page) { wp_publish_post($page->ID); update_option('woocommerce_terms_page_id', $page->ID); }",
      },
      {
        step: "runPHP",
        code: "<?php require_once '/wordpress/wp-load.php'; $shop_page_id = get_option('woocommerce_shop_page_id'); if ($shop_page_id) { update_option('page_on_front', $shop_page_id); update_option('show_on_front', 'page'); }",
      },
      // Set up checkout page to use the checkout shortcode
      {
        step: "runPHP",
        code: "<?php require_once '/wordpress/wp-load.php'; $checkout_page_id = get_option('woocommerce_checkout_page_id'); if ($checkout_page_id) { wp_update_post(['ID' => $checkout_page_id, 'post_content' => '[woocommerce_checkout]']); }",
      },
      // Disable coming soon mode so the store is visible
      {
        step: "setSiteOptions",
        options: {
          woocommerce_coming_soon: "no",
          woocommerce_store_pages_only: "no",
        },
      },
    ],
  );

  // ---------------------------------------------------------------------------
  // 3. Full WC store configuration (comprehensive Swedish test store)
  //    Layers detailed settings on top of the minimal configuration above.
  //    Only enabled for InstaWP deployments and similar full-setup scenarios.
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.configure_woocommerce_fully, [
    // Store address and currency
    {
      step: "setSiteOptions",
      options: {
        woocommerce_store_address: "Test Road 1",
        woocommerce_store_address_2: "",
        woocommerce_store_city: "Arvika",
        woocommerce_store_postcode: "67131",
        woocommerce_allowed_countries: "specific",
        woocommerce_all_except_countries: "",
        woocommerce_specific_allowed_countries: ["SE"],
        woocommerce_ship_to_countries: "",
        woocommerce_specific_ship_to_countries: "",
        woocommerce_default_customer_address: "base",
        woocommerce_calc_taxes: "yes",
        woocommerce_enable_coupons: "yes",
        woocommerce_calc_discounts_sequentially: "no",
        woocommerce_currency_pos: "right_space",
        woocommerce_price_thousand_sep: " ",
        woocommerce_price_decimal_sep: ",",
      },
    },
    // Product and inventory settings
    {
      step: "setSiteOptions",
      options: {
        woocommerce_cart_redirect_after_add: "no",
        woocommerce_enable_ajax_add_to_cart: "yes",
        woocommerce_weight_unit: "kg",
        woocommerce_dimension_unit: "cm",
        woocommerce_manage_stock: "no",
        woocommerce_hold_stock_minutes: "60",
        woocommerce_hide_out_of_stock_items: "no",
      },
    },
    // Tax settings
    {
      step: "setSiteOptions",
      options: {
        woocommerce_prices_include_tax: "yes",
        woocommerce_tax_based_on: "shipping",
        woocommerce_shipping_tax_class: "inherit",
        woocommerce_tax_round_at_subtotal: "no",
        woocommerce_tax_classes: "",
        woocommerce_tax_display_shop: "incl",
        woocommerce_tax_display_cart: "incl",
        woocommerce_price_display_suffix: "",
        woocommerce_tax_total_display: "itemized",
      },
    },
    // Shipping settings
    {
      step: "setSiteOptions",
      options: {
        woocommerce_enable_shipping_calc: "yes",
        woocommerce_shipping_cost_requires_address: "no",
        woocommerce_shipping_hide_rates_when_free: "no",
        woocommerce_ship_to_destination: "billing",
        woocommerce_shipping_debug_mode: "no",
      },
    },
    // Pickup locations
    {
      step: "setSiteOptions",
      options: {
        woocommerce_pickup_location_settings: [],
        pickup_location_pickup_locations: [],
      },
    },
    // Checkout, account, and privacy settings
    {
      step: "setSiteOptions",
      options: {
        woocommerce_enable_guest_checkout: "yes",
        woocommerce_enable_checkout_login_reminder: "no",
        woocommerce_enable_signup_and_login_from_checkout: "no",
        woocommerce_enable_myaccount_registration: "no",
        woocommerce_registration_generate_password: "yes",
        woocommerce_delete_inactive_accounts: {
          number: "",
          unit: "months",
        },
        woocommerce_trash_pending_orders: "",
        woocommerce_trash_failed_orders: "",
        woocommerce_trash_cancelled_orders: "",
        woocommerce_anonymize_refunded_orders: {
          number: "",
          unit: "months",
        },
        woocommerce_anonymize_completed_orders: {
          number: "",
          unit: "months",
        },
      },
    },
    // Enable Cash on Delivery so checkout is functional
    {
      step: "setSiteOptions",
      options: {
        woocommerce_cod_settings: {
          enabled: "yes",
          title: "Cash on delivery",
          description: "Pay with cash upon delivery.",
          instructions: "Pay with cash upon delivery.",
          enable_for_methods: [],
          enable_for_virtual: "yes",
        },
      },
    },
    // Advanced: endpoints, HPOS, features
    {
      step: "setSiteOptions",
      options: {
        woocommerce_api_enabled: "no",
        woocommerce_allow_tracking: "no",
        woocommerce_custom_orders_table_enabled: "yes",
        woocommerce_custom_orders_table_data_sync_enabled: "",
        woocommerce_feature_rate_limit_checkout_enabled: "no",
        woocommerce_feature_order_attribution_enabled: "yes",
        woocommerce_feature_site_visibility_badge_enabled: "yes",
        woocommerce_feature_remote_logging_enabled: "yes",
        woocommerce_feature_email_improvements_enabled: "yes",
        woocommerce_feature_blueprint_enabled: "yes",
        woocommerce_feature_product_block_editor_enabled: "no",
        woocommerce_hpos_fts_index_enabled: "no",
        woocommerce_hpos_datastore_caching_enabled: "no",
        woocommerce_feature_block_email_editor_enabled: "no",
        woocommerce_feature_cost_of_goods_sold_enabled: "no",
      },
    },
  ]);

  // ---------------------------------------------------------------------------
  // 4. Install WC Beta Tester and update to RC versions
  // ---------------------------------------------------------------------------
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
}

module.exports = {
  applyWooCommerceBlueprint,
};
