// index.js
// ---------------------------------------------------------------------------
// Purpose:
//   Public entry point for InstaWP helpers used by scripts.
//
// Inputs (params):
//   - See individual modules for function-specific inputs
//
// Behavior:
//   - Re-exports helper constructors and deployment orchestration
//
// Failure modes:
//   - None (pure re-exports)
// ---------------------------------------------------------------------------

const { createLogger } = require("./logging");
const { createInstawpClient } = require("./client");
const { buildInstawpMetaConfig } = require("./meta");
const { deployPluginDevZip } = require("./deploy");

module.exports = {
  createLogger,
  createInstawpClient,
  buildInstawpMetaConfig,
  deployPluginDevZip,
};
