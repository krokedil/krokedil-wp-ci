#!/usr/bin/env node
/**
 * job-summary-create-plugin-dev-zip.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Produce a rich GitHub Actions Job Summary (and optional output variable)
 *   after building a development plugin zip.
 *
 * Inputs (environment variables):
 *   - ZIP_FILE_NAME        : Base name (without .zip) of the generated dev zip.
 *   - AWS_S3_PUBLIC_URL    : Public S3 URL to the zip (optional; enables playground install).
 *   - PLUGIN_META_JSON     : Raw JSON string with plugin metadata (optional). If present,
 *                            expected to include:
 *                               playground.landingPage (string)
 *                               playground.preferredVersions.wp (string)
 *                               playground.preferredVersions.php (string)
 *   - GITHUB_STEP_SUMMARY  : Path to summary file (GitHub provides automatically).
 *   - GITHUB_OUTPUT        : Path for step outputs (GitHub provides automatically).
 *
 * Output (step output when available):
 *   - playground_minimal_url : A blueprint URL pointing to WordPress Playground with:
 *       * WooCommerce installed
 *       * Your dev plugin zip installed and activated
 *       * Basic site setup tweaks (permalink structure, product, pages)
 *
 * Behavior:
 *   1. Reads metadata only if PLUGIN_META_JSON is set.
 *   2. Validates required playground fields. If incomplete, skips playground link.
 *   3. Builds a blueprint object, base64 encodes it, forms final URL.
 *   4. Writes a markdown summary with download link and (if available) playground link.
 *
 * Failure Modes:
 *   - Malformed PLUGIN_META_JSON => log error & exit(1).
 *   - Missing required playground fields => warning; no URL emitted.
 *   - Missing summary file path => prints to stdout instead (non-fatal).
 *
 * Safety / Size:
 *   Blueprint JSON is base64 encoded directly. Keep steps minimal to avoid very large
 *   blueprint strings (WordPress Playground handles moderately sized blueprints well).
 *
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const { loadMeta, assertFields, assertField } = require('./lib/plugin-meta');

// ---------------------------------------------------------------------------
// Environment extraction & basic presence checks
// ---------------------------------------------------------------------------
const summaryFile = process.env.GITHUB_STEP_SUMMARY;          // Where markdown summary is appended
const ZIP_FILE_NAME = process.env.ZIP_FILE_NAME || '';        // Name of built zip (without .zip)
const AWS_S3_PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL || ''; // Public URL to zip (optional)
const rawMetaProvided = !!process.env.PLUGIN_META_JSON;       // Whether plugin meta was supplied

// ---------------------------------------------------------------------------
// Parse metadata (only if provided). loadMeta throws if invalid JSON.
// ---------------------------------------------------------------------------
let META = {};
if (rawMetaProvided) {
  try {
    META = loadMeta({ requireEnv: true });
  } catch (e) {
    console.error('Invalid PLUGIN_META_JSON:', e.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Extract playground-related metadata (optional). If any required field missing, we skip.
// ---------------------------------------------------------------------------
let preferredVersions = {};
let landingPage = '';
let playgroundSupported = false;
if (rawMetaProvided) {
  try {
    const required = assertFields(META, ['playground.landingPage', 'playground.preferredVersions']);
    landingPage = required['playground.landingPage'];
    preferredVersions = required['playground.preferredVersions'];
    assertField(preferredVersions, 'php', 'playground.preferredVersions.php required');
    assertField(preferredVersions, 'wp', 'playground.preferredVersions.wp required');
    playgroundSupported = true;
  } catch (e) {
    console.warn('[summary] Playground metadata incomplete; no playground URL will be created:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Construct minimal playground blueprint & URL if preconditions satisfied.
// ---------------------------------------------------------------------------
let PLAYGROUND_MINIMAL_URL = '';
if (playgroundSupported && AWS_S3_PUBLIC_URL) {
  const blueprintObj = {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    preferredVersions,
    constants: { WP_DEBUG: true },
    steps: [
      { step: 'resetData' },
      { step: 'writeFile', path: '/wordpress/wp-content/mu-plugins/rewrite.php', data: "<?php /* Pretty permalinks */ add_action('after_setup_theme', function(){ global $wp_rewrite; $wp_rewrite->set_permalink_structure('/%postname%/'); $wp_rewrite->flush_rules(); });" },
      { step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: 'woocommerce' }, options: { activate: true } },
      { step: 'setSiteOptions', options: {
          show_on_front: 'page',
          woocommerce_onboarding_profile: { skipped: true },
          woocommerce_default_country: 'SE',
          woocommerce_currency: 'SEK',
          woocommerce_price_num_decimals: '2'
        } },
      { step: 'wp-cli', command: 'wp transient delete _wc_activation_redirect' },
      { step: 'wp-cli', command: "wp wc product create --name='Simple product' --sku='simple-product' --regular_price='99.99' --virtual=false --downloadable=false --user='admin'" },
      { step: 'runPHP', code: "<?php require_once 'wordpress/wp-load.php'; $page = get_page_by_path('refund_returns'); if ($page) { wp_publish_post($page->ID); update_option('woocommerce_terms_page_id', $page->ID); }" },
      { step: 'runPHP', code: "<?php require_once 'wordpress/wp-load.php'; $shop_page_id = get_option('woocommerce_shop_page_id'); if ($shop_page_id) { update_option('page_on_front', $shop_page_id); update_option('show_on_front', 'page'); }" },
      { step: 'runPHP', code: "<?php require_once 'wordpress/wp-load.php'; $checkout_page_id = get_option('woocommerce_checkout_page_id'); if ($checkout_page_id) { wp_update_post(['ID' => $checkout_page_id, 'post_content' => '[woocommerce_checkout]']); }" },
      { step: 'installPlugin', pluginData: { resource: 'url', url: AWS_S3_PUBLIC_URL }, options: { activate: true } }
    ],
    login: true,
    landingPage
  };
  const minimalBlueprintJson = JSON.stringify(blueprintObj);
  const b64 = Buffer.from(minimalBlueprintJson, 'utf8').toString('base64');
  PLAYGROUND_MINIMAL_URL = `https://playground.wordpress.net/#${b64}`;
}

// ---------------------------------------------------------------------------
// Compose summary markdown.
// ---------------------------------------------------------------------------
const lines = [];
lines.push('# Created dev zip');
if (ZIP_FILE_NAME) {
  if (AWS_S3_PUBLIC_URL) {
    lines.push('Download or share URL for created dev zip through the link below, which is available for 30 days:');
    lines.push(`* [${ZIP_FILE_NAME}.zip](${AWS_S3_PUBLIC_URL})`);
  } else {
    lines.push('Dev zip created locally (no S3 upload requested).');
    lines.push(`* ${ZIP_FILE_NAME}.zip`);
  }
}
lines.push('\nDocumentation about how to install the dev zip can be found [here](https://docs.krokedil.com/krokedil-general-support-info/installing-a-development-version/).');
if (playgroundSupported && PLAYGROUND_MINIMAL_URL) {
  lines.push('## Test dev zip using WordPress Playground (experimental)');
  lines.push('You can test the created dev zip directly in [WordPress Playground](https://wordpress.org/playground/), which is an experimental project and functionality can be limited, through the links below:')
  lines.push(`* [Test dev zip using WordPress Playground](${PLAYGROUND_MINIMAL_URL}) (WP ${preferredVersions.wp}, PHP ${preferredVersions.php}, WooCommerce and created dev zip)`);
} else if (rawMetaProvided) {
  lines.push('\n_Playground link skipped: missing AWS_S3_PUBLIC_URL or required metadata._');
}

const markdownContent = lines.join('\n') + '\n';

// ---------------------------------------------------------------------------
// Write summary (or fallback to stdout if GITHUB_STEP_SUMMARY missing).
// ---------------------------------------------------------------------------
if (summaryFile) {
  try {
    fs.appendFileSync(summaryFile, markdownContent);
    console.log('Summary written.');
  } catch (e) {
    console.error('Failed writing summary:', e.message);
  }
} else {
  console.warn('GITHUB_STEP_SUMMARY not set; printing summary to stdout');
  console.log(markdownContent);
}