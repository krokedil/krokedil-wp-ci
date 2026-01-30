// logging.js
// ---------------------------------------------------------------------------
// Purpose:
//   Provide consistent GitHub Actions log helpers for InstaWP scripts.
//
// Inputs (params):
//   - message strings for info/warn/error
//   - group labels for log grouping
//
// Behavior:
//   - Prefixes messages with [INFO]/[WARN] and uses ::error:: for failures
//   - Emits ::group:: / ::endgroup:: for collapsible log sections
//
// Failure modes:
//   - None (logging helpers are best-effort and do not throw)
// ---------------------------------------------------------------------------

function logInfo(message) {
  console.log(`[INFO] ${message}`);
}

function logWarn(message) {
  console.warn(`[WARN] ${message}`);
}

function logError(message) {
  console.error(`::error::${message}`);
}

function logGroupStart(name) {
  console.log(`::group::${name}`);
}

function logGroupEnd() {
  console.log("::endgroup::");
}

function createLogger() {
  return {
    logInfo,
    logWarn,
    logError,
    logGroupStart,
    logGroupEnd,
  };
}

module.exports = {
  createLogger,
};
