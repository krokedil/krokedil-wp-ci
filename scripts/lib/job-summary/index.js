// index.js
// ---------------------------------------------------------------------------
// Purpose:
//   Public entry point for job summary helpers used by scripts.
//
// Inputs:
//   - See individual modules for function-specific inputs
//
// Behavior:
//   - Re-exports helper functions for job summary writing
//
// Failure modes:
//   - None (pure re-exports)
// ---------------------------------------------------------------------------

const { writeJobSummary } = require("./write-summary");

module.exports = {
  writeJobSummary,
};
