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
//   - install_woocommerce           : Install and activate WooCommerce.
//   - configure_woocommerce         : Basic WC config (country, currency, test product).
//   - configure_woocommerce_store   : Comprehensive Swedish test store settings
//                                     (tax, shipping, checkout, payments, email, HPOS, etc).
//   - woocommerce_default_country   : Default "SE".
//   - woocommerce_currency          : Default "SEK".
//   - woocommerce_price_num_decimals: Default "2".
//   - install_wc_beta_tester        : Install WC Beta Tester and switch to RC channel.

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
  // 2. Configure WooCommerce basics (country, currency, test product)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // 3. Full WC store configuration (comprehensive Swedish test store)
  //    Only enabled for InstaWP deployments and similar full-setup scenarios.
  // ---------------------------------------------------------------------------
  builder.addSteps(!!vars.configure_woocommerce_store, [
    // Store address and currency
    {
      step: "setSiteOptions",
      options: {
        woocommerce_store_address: "Test Road 1",
        woocommerce_store_address_2: "",
        woocommerce_store_city: "Test City",
        woocommerce_default_country: "SE",
        woocommerce_store_postcode: "12345",
        woocommerce_allowed_countries: "specific",
        woocommerce_all_except_countries: "",
        woocommerce_specific_allowed_countries: ["SE"],
        woocommerce_ship_to_countries: "",
        woocommerce_specific_ship_to_countries: "",
        woocommerce_default_customer_address: "base",
        woocommerce_calc_taxes: "yes",
        woocommerce_enable_coupons: "yes",
        woocommerce_calc_discounts_sequentially: "no",
        woocommerce_currency: "SEK",
        woocommerce_currency_pos: "right_space",
        woocommerce_price_thousand_sep: " ",
        woocommerce_price_decimal_sep: ",",
        woocommerce_price_num_decimals: "2",
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
        woocommerce_enable_reviews: "no",
        woocommerce_review_rating_verification_label: "yes",
        woocommerce_review_rating_verification_required: "no",
        woocommerce_enable_review_rating: "yes",
        woocommerce_review_rating_required: "yes",
        woocommerce_manage_stock: "no",
        woocommerce_hold_stock_minutes: "60",
        woocommerce_notify_low_stock: "yes",
        woocommerce_notify_no_stock: "yes",
        woocommerce_notify_low_stock_amount: "2",
        woocommerce_notify_no_stock_amount: "0",
        woocommerce_hide_out_of_stock_items: "no",
        woocommerce_stock_format: "",
        woocommerce_file_download_method: "force",
        woocommerce_downloads_redirect_fallback_allowed: "no",
        woocommerce_downloads_require_login: "no",
        woocommerce_downloads_grant_access_after_payment: "yes",
        woocommerce_downloads_deliver_inline: "",
        woocommerce_downloads_add_hash_to_filename: "yes",
        woocommerce_downloads_count_partial: "yes",
        woocommerce_attribute_lookup_enabled: "no",
        woocommerce_attribute_lookup_direct_updates: "no",
        woocommerce_attribute_lookup_optimized_updates: "no",
        woocommerce_product_match_featured_image_by_sku: "no",
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
    // Cash on delivery payment method
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
    // Checkout, account, and privacy settings
    {
      step: "setSiteOptions",
      options: {
        woocommerce_enable_guest_checkout: "yes",
        woocommerce_enable_checkout_login_reminder: "no",
        woocommerce_enable_signup_and_login_from_checkout: "no",
        woocommerce_enable_myaccount_registration: "no",
        woocommerce_registration_generate_password: "yes",
        woocommerce_erasure_request_removes_order_data: "no",
        woocommerce_erasure_request_removes_download_data: "no",
        woocommerce_allow_bulk_remove_personal_data: "no",
        woocommerce_registration_privacy_policy_text:
          "Your personal data will be used to support your experience throughout this website, to manage access to your account, and for other purposes described in our [privacy_policy].",
        woocommerce_checkout_privacy_policy_text:
          "Your personal data will be used to process your order, support your experience throughout this website, and for other purposes described in our [privacy_policy].",
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
    // Email settings
    {
      step: "setSiteOptions",
      options: {
        previewing_new_templates: "",
        woocommerce_email_header_image: "",
        woocommerce_email_header_image_width: "120",
        woocommerce_email_header_alignment: "left",
        woocommerce_email_font_family: "Helvetica",
        woocommerce_email_footer_text:
          "{site_title} &mdash; Built with {WooCommerce}",
        email_color_palette: "",
        woocommerce_email_base_color: "#111111",
        woocommerce_email_background_color: "#FFFFFF",
        woocommerce_email_body_background_color: "#FFFFFF",
        woocommerce_email_text_color: "#111111",
        woocommerce_email_footer_text_color: "#787c82",
        email_improvements_button: "",
        woocommerce_new_order_settings: "",
        woocommerce_cancelled_order_settings: "",
        woocommerce_failed_order_settings: "",
        woocommerce_customer_failed_order_settings: "",
        woocommerce_customer_on_hold_order_settings: "",
        woocommerce_customer_processing_order_settings: "",
        woocommerce_customer_completed_order_settings: "",
        woocommerce_customer_refunded_order_settings: "",
        woocommerce_customer_invoice_settings: "",
        woocommerce_customer_note_settings: "",
        woocommerce_customer_reset_password_settings: "",
        woocommerce_customer_new_account_settings: "",
      },
    },
    // Coming soon / store visibility
    {
      step: "setSiteOptions",
      options: {
        woocommerce_coming_soon: "no",
        woocommerce_store_pages_only: "no",
      },
    },
    // Advanced: endpoints, HPOS, features
    {
      step: "setSiteOptions",
      options: {
        woocommerce_checkout_pay_endpoint: "order-pay",
        woocommerce_checkout_order_received_endpoint: "order-received",
        woocommerce_myaccount_add_payment_method_endpoint:
          "add-payment-method",
        woocommerce_myaccount_delete_payment_method_endpoint:
          "delete-payment-method",
        woocommerce_myaccount_set_default_payment_method_endpoint:
          "set-default-payment-method",
        woocommerce_myaccount_orders_endpoint: "orders",
        woocommerce_myaccount_view_order_endpoint: "view-order",
        woocommerce_myaccount_downloads_endpoint: "downloads",
        woocommerce_myaccount_edit_account_endpoint: "edit-account",
        woocommerce_myaccount_edit_address_endpoint: "edit-address",
        woocommerce_myaccount_payment_methods_endpoint: "payment-methods",
        woocommerce_myaccount_lost_password_endpoint: "lost-password",
        woocommerce_logout_endpoint: "customer-logout",
        woocommerce_api_enabled: "no",
        woocommerce_allow_tracking: "yes",
        woocommerce_show_marketplace_suggestions: "yes",
        woocommerce_custom_orders_table_enabled: "yes",
        woocommerce_custom_orders_table_data_sync_enabled: "",
        woocommerce_analytics_enabled: "yes",
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
        woocommerce_onboarding_profile: {
          skipped: true,
        },
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
