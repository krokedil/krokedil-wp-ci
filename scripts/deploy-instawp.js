#!/usr/bin/env node
const fs = require('fs');
const { loadMeta, safeGet } = require('./lib/plugin-meta');

let META;
try { META = loadMeta({ requireEnv: true }); } catch (e) { console.error(e.message); process.exit(1); }

const instawp = safeGet(META, 'instawp', {});
const BLUEPRINT_URL = safeGet(instawp, 'plugin_wc_blueprint_url', '');
const PAYMENT_GATEWAY_ID = safeGet(instawp, 'payment_gateway_id');
const USE_CHECKOUT_BLOCK = safeGet(instawp, 'use_checkout_block');
const PATCHES = safeGet(instawp, 'plugin_credentials_option_patches', []);

const AWS_S3_PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL || '';
const ZIP_FILE_NAME = process.env.ZIP_FILE_NAME || process.env.ZIP_FILE || '';
const INSTAWP_API_TOKEN = process.env.INSTAWP_API_TOKEN || '';

if (!INSTAWP_API_TOKEN) { console.error('INSTAWP_API_TOKEN required'); process.exit(1); }
if (!ZIP_FILE_NAME) { console.error('ZIP_FILE_NAME required'); process.exit(1); }

function logInfo(m){ console.log('[instawp]', m); }

// Placeholder: integrate actual InstaWP API calls here.
const siteCreated = true; // Simulate site creation
const siteid = '123456';

(async () => {
  try {
    if (AWS_S3_PUBLIC_URL) logInfo(`Dev zip URL: ${AWS_S3_PUBLIC_URL}`); else logInfo('No dev zip URL provided.');

    if (siteCreated) {
      BLUEPRINT_URL ? logInfo(`Apply blueprint: ${BLUEPRINT_URL}`) : logInfo('No blueprint configured.');
      if (PATCHES.length === 0) logInfo('No credential patches.'); else PATCHES.forEach(p => logInfo(`Patch option ${p.option_name}.${p.key}`));
      PAYMENT_GATEWAY_ID ? logInfo(`Configure payment gateway ordering for ${PAYMENT_GATEWAY_ID}`) : logInfo('No payment gateway id.');
      USE_CHECKOUT_BLOCK === false ? logInfo('Inject checkout shortcode.') : logInfo('Checkout block enabled or unspecified.');
    }

    const outputFile = process.env.GITHUB_OUTPUT || 'deploy-output.txt';
    fs.appendFileSync(outputFile, `site_id=${siteid}\nsite_url=https://example.test\nsite_created=${siteCreated}\n`);
    logInfo('Deployment simulation complete.');
  } catch (e) {
    console.error('Deployment error:', e.message);
    process.exit(1);
  }
})();
