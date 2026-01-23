/**
 * plugin-meta.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Contract tests for `scripts/lib/plugin-meta.js`.
 *
 * Fixtures:
 *   - tests/scripts/fixtures/dummy-plugin-for-repo-tests/.github/plugin-meta.json
 *
 * Inputs:
 *   - PLUGIN_META_JSON (env var)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  loadMeta,
  safeGet,
  assertField,
  assertFields,
  getOptionalString,
  getOptionalArrayOfObjects,
} = require("../../scripts/lib/plugin-meta.js");

function readFixturePluginMetaJson() {
  // ---------------------------------------------------------------------------
  // Fixture loader
  // ---------------------------------------------------------------------------
  const fixturePath = path.resolve(
    __dirname,
    "fixtures",
    "dummy-plugin-for-repo-tests",
    ".github",
    "plugin-meta.json",
  );
  return fs.readFileSync(fixturePath, "utf8");
}

function withEnv(overrides, fn) {
  // ---------------------------------------------------------------------------
  // Helper: temporary env overrides for a single test.
  // ---------------------------------------------------------------------------
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("loadMeta: requireEnv=false returns {} when missing", () => {
  // Missing env should not throw when requireEnv=false.
  withEnv({ PLUGIN_META_JSON: undefined }, () => {
    assert.deepEqual(loadMeta({ requireEnv: false }), {});
  });
});

test("loadMeta: requireEnv=true throws when missing", () => {
  // Missing env should throw when requireEnv=true.
  withEnv({ PLUGIN_META_JSON: undefined }, () => {
    assert.throws(
      () => loadMeta({ requireEnv: true }),
      /PLUGIN_META_JSON env not set/,
    );
  });
});

test("loadMeta: parses valid JSON", () => {
  // Use the shared fixture so tests are deterministic and reusable.
  withEnv(
    {
      PLUGIN_META_JSON: readFixturePluginMetaJson(),
    },
    () => {
      const meta = loadMeta({ requireEnv: true });
      assert.equal(meta.slug, "dummy-plugin-for-repo-tests");
      assert.equal(meta.name, "Dummy Plugin for Repo Tests");
    },
  );
});

test("loadMeta: throws on invalid JSON", () => {
  // Invalid JSON should throw a clear parse error.
  withEnv({ PLUGIN_META_JSON: "{not-json" }, () => {
    assert.throws(
      () => loadMeta({ requireEnv: true }),
      /Failed to parse PLUGIN_META_JSON/,
    );
  });
});

test("safeGet: reads deep paths and returns defaults", () => {
  // safeGet supports deep reads without throwing.
  const obj = { a: { b: { c: 123 } }, empty: "" };
  assert.equal(safeGet(obj, "a.b.c", 0), 123);
  assert.equal(safeGet(obj, "a.b.missing", "fallback"), "fallback");
  assert.equal(safeGet(null, "a.b", "fallback"), "fallback");
});

test("assertField/assertFields: throws for missing values", () => {
  // These helpers are used to enforce required plugin meta fields.
  const meta = { slug: "kco", name: "" };

  assert.equal(assertField(meta, "slug"), "kco");
  assert.throws(
    () => assertField(meta, "name"),
    /Required metadata field missing: name/,
  );

  assert.deepEqual(assertFields({ a: 1, b: 2 }, ["a", "b"]), { a: 1, b: 2 });
  assert.throws(
    () => assertFields({ a: 1 }, ["a", "b"]),
    /Required metadata field missing: b/,
  );
});

test("getOptionalString: returns trimmed non-empty strings", () => {
  assert.equal(getOptionalString({ a: "  hello  " }, "a"), "hello");
});

test("getOptionalString: returns undefined for missing/empty/non-strings", () => {
  assert.equal(getOptionalString({}, "missing"), undefined);
  assert.equal(getOptionalString({ a: "   " }, "a"), undefined);
  assert.equal(getOptionalString({ a: 123 }, "a"), undefined);
});

test("getOptionalArrayOfObjects: filters arrays to objects", () => {
  withEnv(
    {
      PLUGIN_META_JSON: readFixturePluginMetaJson(),
    },
    () => {
      const meta = loadMeta({ requireEnv: true });

      const pages =
        getOptionalArrayOfObjects(meta, "pluginDevZipE2e.pages") || [];
      assert.equal(pages.length, 1);

      assert.equal(
        getOptionalString(pages[0], "url"),
        "/wp-admin/options-general.php?page=dummy-plugin-for-repo-tests",
      );

      const assertions =
        getOptionalArrayOfObjects(pages[0], "assertions") || [];
      assert.equal(assertions.length, 1);
      assert.equal(getOptionalString(assertions[0], "selector"), "h1");
      assert.equal(
        getOptionalString(assertions[0], "text"),
        "Dummy Plugin for Repo Tests Settings",
      );
      assert.equal(getOptionalString(assertions[0], "match"), "contains");
    },
  );
});
