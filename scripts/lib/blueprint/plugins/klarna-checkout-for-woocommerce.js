// blueprint/plugins/klarna-checkout-for-woocommerce.js
// ---------------------------------------------------------------------------
// Purpose
//   Plugin blueprint for Klarna Checkout for WooCommerce (KCO).
//   Sets test credentials, payment gateway ordering, and classic checkout.
//
// Inputs
//   - builder: BlueprintBuilder instance
//
// Environment variables
//   - KCO_TEST_MERCHANT_ID_EU  : Test merchant ID (skipped if not set).
//   - KCO_TEST_SHARED_SECRET_EU: Test shared secret (skipped if not set).

/**
 * @param {import('../blueprint-builder.js').BlueprintBuilder} builder
 */
function applyKlarnaCheckoutBlueprint(builder) {
  const merchantId = process.env.KCO_TEST_MERCHANT_ID_EU || "";
  const sharedSecret = process.env.KCO_TEST_SHARED_SECRET_EU || "";

  // Activate the plugin so WP-CLI commands below can reference its gateway.
  builder.addSteps(true, [
    {
      step: "wp-cli",
      command:
        "wp plugin activate klarna-checkout-for-woocommerce --skip-plugins --skip-themes",
    },
  ]);

  // Set KCO credentials (only if env vars are available)
  builder.addSteps(true, [
    {
      step: "setSiteOptions",
      options: {
        woocommerce_kco_settings: {
          enabled: "yes",
          title: "Klarna",
          description: "",
          select_another_method_text: "Other payment methods",
          testmode: "yes",
          logging: "yes",
          checkout_layout: "two_column_right",
          test_merchant_id_eu: merchantId,
          test_shared_secret_eu: sharedSecret,
          allow_separate_shipping: "no",
          shipping_methods_in_iframe: "yes",
          shipping_details: "",
          send_product_urls: "yes",
          dob_mandatory: "no",
          title_mandatory: "no",
          add_terms_and_conditions_checkbox: "yes",
          allowed_customer_types: "B2CB",
          prefill_consent: "yes",
          quantity_fields: "yes",
          show_subtotal_detail: "woo",
          color_button: "",
          color_button_text: "",
          color_checkbox: "",
          color_checkbox_checkmark: "",
          color_header: "",
          color_link: "",
          radius_border: "",
          checkout_flow: "embedded",
        },
      },
    },
  ]);

  // Set KCO as priority payment gateway
  builder.addSteps(true, [
    {
      step: "wp-cli",
      command:
        "wp wc payment_gateway update kco --order=1 --user=1 --skip-themes",
    },
  ]);
}

module.exports = {
  applyKlarnaCheckoutBlueprint,
};
