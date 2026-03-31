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

  // Set KCO credentials (only if env vars are available)
  builder.addSteps(!!merchantId || !!sharedSecret, [
    {
      step: "setSiteOptions",
      options: {
        woocommerce_kco_settings: {
          enabled: "yes",
          test_merchant_id_eu: merchantId,
          test_shared_secret_eu: sharedSecret,
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

  // Switch checkout to classic shortcode
  builder.addSteps(true, [
    {
      step: "runPHP",
      code: "<?php require_once '/wordpress/wp-load.php'; $checkout_page_id = get_option('woocommerce_checkout_page_id'); if ($checkout_page_id) { wp_update_post(['ID' => $checkout_page_id, 'post_content' => '[woocommerce_checkout]']); }",
    },
  ]);
}

module.exports = {
  applyKlarnaCheckoutBlueprint,
};
