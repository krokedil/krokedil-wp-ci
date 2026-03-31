// blueprint/index.js
// ---------------------------------------------------------------------------
// Purpose
//   Public, reusable programmatic API for the unified blueprint builder.
//
// Notes
//   - CommonJS by design to match the existing scripts/lib modules.
//   - Intended for reuse by scripts, workflows, and tests.

const { BlueprintBuilder } = require("./blueprint-builder.js");
const {
  applyKrokedilBlueprintTemplate,
} = require("./template.js");
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

const { loadPluginBlueprint } = require("./plugins/loader.js");

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

  loadPluginBlueprint,
};
