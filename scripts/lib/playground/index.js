// playground/index.js
// ---------------------------------------------------------------------------
// Purpose
//   Public, reusable programmatic API for WordPress Playground helpers.
//
// Notes
//   - CommonJS by design to match the existing scripts/lib modules.
//   - Intended for reuse by scripts, workflows, and tests.

const { BlueprintBuilder } = require("./blueprint-builder.js");
const { applyKrokedilBlueprintTemplate } = require("./krokedil-template.js");
const {
  PLAYGROUND_SCHEMA_URL,
  getCompiledPlaygroundSchemaValidator,
  formatAjvErrors,
} = require("./schema.js");

const {
  computeSnapshotCacheKey,
  ensureSnapshotExtracted,
  copyWordpressFromSnapshot,
  hashDirectoryForCache,
} = require("./snapshot-cache.js");

module.exports = {
  BlueprintBuilder,
  applyKrokedilBlueprintTemplate,
  PLAYGROUND_SCHEMA_URL,
  getCompiledPlaygroundSchemaValidator,
  formatAjvErrors,

  computeSnapshotCacheKey,
  ensureSnapshotExtracted,
  copyWordpressFromSnapshot,
  hashDirectoryForCache,
};
