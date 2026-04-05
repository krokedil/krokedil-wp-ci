/**
 * resolve-plugin.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Tests for the shared resolve-plugin module (scripts/lib/resolve-plugin.js)
 *   and the CLI wrapper (scripts/resolve-plugin-cli.js).
 *
 * Fixtures:
 *   - Inline plugin arrays for unit tests.
 *   - .github/projects.json (the real registry) for CLI integration tests.
 *
 * Env vars: none
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const {
  resolvePlugin,
  isPassthrough,
} = require("../../scripts/lib/resolve-plugin.js");

const CLI = path.resolve(__dirname, "../../scripts/resolve-plugin-cli.js");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PLUGINS = [
  {
    displayName: "Alpha Plugin",
    repository: "org/alpha-plugin",
    abbreviation: "alpha",
  },
  {
    displayName: "Beta WooCommerce Gateway",
    repository: "other-org/beta-woocommerce-gateway",
    abbreviation: "beta",
  },
];

// ---------------------------------------------------------------------------
// resolvePlugin — unit tests
// ---------------------------------------------------------------------------

test("resolves by abbreviation", () => {
  const result = resolvePlugin("alpha", PLUGINS);
  assert.equal(result.repository, "org/alpha-plugin");
});

test("resolves by abbreviation (case-insensitive)", () => {
  const result = resolvePlugin("BETA", PLUGINS);
  assert.equal(result.repository, "other-org/beta-woocommerce-gateway");
});

test("resolves by repo slug", () => {
  const result = resolvePlugin("beta-woocommerce-gateway", PLUGINS);
  assert.equal(result.displayName, "Beta WooCommerce Gateway");
});

test("resolves by display name", () => {
  const result = resolvePlugin("Alpha Plugin", PLUGINS);
  assert.equal(result.abbreviation, "alpha");
});

test("resolves by display name (case-insensitive)", () => {
  const result = resolvePlugin("alpha plugin", PLUGINS);
  assert.equal(result.repository, "org/alpha-plugin");
});

test("returns null for unknown identifier", () => {
  const result = resolvePlugin("nonexistent", PLUGINS);
  assert.equal(result, null);
});

test("abbreviation takes priority over slug", () => {
  // If a plugin's abbreviation matches another plugin's slug, abbreviation wins.
  const plugins = [
    {
      displayName: "First",
      repository: "org/beta",
      abbreviation: "first",
    },
    {
      displayName: "Second",
      repository: "org/second",
      abbreviation: "beta",
    },
  ];
  const result = resolvePlugin("beta", plugins);
  assert.equal(result.displayName, "Second", "abbreviation match should win");
});

// ---------------------------------------------------------------------------
// resolvePlugin — slug field matching
// ---------------------------------------------------------------------------

const PLUGINS_WITH_SLUG = [
  ...PLUGINS,
  {
    displayName: "WP Org Plugin",
    repository: "org/wp-org-plugin",
    abbreviation: "wporg",
    slug: "wp-org-plugin-slug",
    distributionPlatform: "wordpress-org",
  },
  {
    displayName: "URL Plugin",
    repository: "org/url-plugin",
    abbreviation: "urlp",
    slug: "url-plugin-slug",
    downloadUrl: "https://example.com/plugin.zip",
  },
];

test("resolves wordpress-org plugin by slug field", () => {
  const result = resolvePlugin("wp-org-plugin-slug", PLUGINS_WITH_SLUG);
  assert.equal(result.displayName, "WP Org Plugin");
});

test("resolves url plugin by slug field", () => {
  const result = resolvePlugin("url-plugin-slug", PLUGINS_WITH_SLUG);
  assert.equal(result.displayName, "URL Plugin");
});

test("resolves plugin by slug (case-insensitive)", () => {
  const result = resolvePlugin("WP-ORG-PLUGIN-SLUG", PLUGINS_WITH_SLUG);
  assert.equal(result.abbreviation, "wporg");
});

test("abbreviation takes priority over slug", () => {
  // A plugin whose abbreviation matches another plugin's slug.
  const plugins = [
    {
      displayName: "First",
      repository: "org/first",
      abbreviation: "myplugin",
    },
    {
      displayName: "Second",
      repository: "org/second",
      abbreviation: "second",
      slug: "myplugin",
    },
  ];
  const result = resolvePlugin("myplugin", plugins);
  assert.equal(result.displayName, "First", "abbreviation match should win over slug");
});

test("repo slug takes priority over plugin slug", () => {
  const plugins = [
    {
      displayName: "First",
      repository: "org/shared-name",
      abbreviation: "first",
    },
    {
      displayName: "Second",
      repository: "org/other",
      abbreviation: "second",
      slug: "shared-name",
    },
  ];
  const result = resolvePlugin("shared-name", plugins);
  assert.equal(result.displayName, "First", "repo slug match should win over plugin slug");
});

// ---------------------------------------------------------------------------
// isPassthrough — unit tests
// ---------------------------------------------------------------------------

test("owner/repo format is passthrough", () => {
  assert.equal(isPassthrough("krokedil/some-repo"), true);
});

test("dummy fixture name is passthrough", () => {
  assert.equal(isPassthrough("dummy-plugin-for-repo-tests"), true);
});

test("plain name is not passthrough", () => {
  assert.equal(isPassthrough("budbee"), false);
});

test("display name is not passthrough", () => {
  assert.equal(isPassthrough("Alpha Plugin"), false);
});

// ---------------------------------------------------------------------------
// CLI integration tests (uses real .github/projects.json)
// ---------------------------------------------------------------------------

test("CLI resolves a known abbreviation", () => {
  const result = execFileSync("node", [CLI, "kco"], {
    encoding: "utf8",
  });
  assert.equal(result, "krokedil/klarna-checkout-for-woocommerce");
});

test("CLI passes through owner/repo format", () => {
  const result = execFileSync("node", [CLI, "krokedil/some-repo"], {
    encoding: "utf8",
  });
  assert.equal(result, "krokedil/some-repo");
});

test("CLI passes through dummy fixture name", () => {
  const result = execFileSync("node", [CLI, "dummy-plugin-for-repo-tests"], {
    encoding: "utf8",
  });
  assert.equal(result, "dummy-plugin-for-repo-tests");
});

test("CLI exits 1 for unknown identifier", () => {
  assert.throws(
    () => {
      execFileSync("node", [CLI, "nonexistent-plugin"], {
        encoding: "utf8",
        stdio: "pipe",
      });
    },
    { status: 1 },
    "Should exit 1 for unknown identifier",
  );
});

test("CLI exits 1 when no identifier provided", () => {
  assert.throws(
    () => {
      execFileSync("node", [CLI], {
        encoding: "utf8",
        stdio: "pipe",
      });
    },
    { status: 1 },
    "Should exit 1 when no identifier given",
  );
});
