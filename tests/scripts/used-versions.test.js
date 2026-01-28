/**
 * used-versions.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Contract tests for extracting `used-versions-for-test.json` evidence from
 *   WP Site Health "Info" output (`wp-site-health-info.json`).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractUsedVersionsForTestFromWpSiteHealthInfo,
} = require("../../scripts/lib/used-versions.js");

test("extractUsedVersionsForTestFromWpSiteHealthInfo: extracts versions and activated plugins", () => {
  const siteHealth = {
    "wp-core": {
      label: "WordPress",
      fields: {
        version: { label: "Version", value: "6.9", debug: "6.9" },
      },
    },
    "wp-server": {
      label: "Server",
      fields: {
        php_version: {
          label: "PHP version",
          value: "8.3.27-dev (Supports 64bit values)",
          debug: "8.3.27-dev 64bit",
        },
      },
    },
    "wp-active-theme": {
      label: "Active Theme",
      fields: {
        name: { label: "Name", value: "Storefront (storefront)" },
        version: { label: "Version", value: "4.6.2", debug: "4.6.2" },
      },
    },
    "wp-plugins-active": {
      label: "Active Plugins",
      fields: {
        WooCommerce: {
          label: "WooCommerce",
          value: "Version 10.4.3 by Automattic | Auto-updates disabled",
          debug: "version: 10.4.3, author: Automattic, Auto-updates disabled",
        },
        "WooCommerce Beta Tester": {
          label: "WooCommerce Beta Tester",
          value: "Version 3.0.0 by WooCommerce | Auto-updates disabled",
          debug: "version: 3.0.0, author: WooCommerce, Auto-updates disabled",
        },
        "Dummy Plugin": {
          label: "Dummy Plugin",
          value: "No version info",
          debug: "author: someone",
        },
      },
    },
  };

  const used = extractUsedVersionsForTestFromWpSiteHealthInfo(
    JSON.stringify(siteHealth),
  );

  assert.equal(used.wordpress, "6.9");
  assert.equal(used.php, "8.3.27-dev");
  assert.deepEqual(used.activated_theme, {
    name: "Storefront (storefront)",
    version: "4.6.2",
  });

  // Sorted by name.
  assert.deepEqual(used.activated_plugins, [
    { name: "Dummy Plugin", version: undefined },
    { name: "WooCommerce", version: "10.4.3" },
    { name: "WooCommerce Beta Tester", version: "3.0.0" },
  ]);
});

test("extractUsedVersionsForTestFromWpSiteHealthInfo: returns safe fallbacks on invalid JSON", () => {
  const used = extractUsedVersionsForTestFromWpSiteHealthInfo("{not-json");
  assert.equal(used.wordpress, undefined);
  assert.equal(used.php, undefined);
  assert.deepEqual(used.activated_theme, {
    name: undefined,
    version: undefined,
  });
  assert.deepEqual(used.activated_plugins, []);
});
