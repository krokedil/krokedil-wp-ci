// write-summary.js
// ---------------------------------------------------------------------------
// Purpose:
//   Provide a shared helper for writing GitHub Actions job summaries.
//
// Inputs (params):
//   - summaryFile: string | undefined (path to GITHUB_STEP_SUMMARY)
//   - markdownContent: string (already-formatted markdown)
//   - label: string (optional log label, e.g. "Summary")
//
// Behavior:
//   - Appends markdown to the summary file when available
//   - Falls back to stdout when summary file is missing
//
// Failure modes:
//   - File write errors are logged but do not throw
// ---------------------------------------------------------------------------

const fs = require("fs");

/**
 * @param {{ summaryFile?: string, markdownContent: string, label?: string }} options
 */
function writeJobSummary({ summaryFile, markdownContent, label = "Summary" }) {
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, markdownContent);
      console.log(`${label} written.`);
      return;
    } catch (e) {
      console.error(`Failed writing ${label.toLowerCase()}:`, e.message);
    }
  } else {
    console.warn("GITHUB_STEP_SUMMARY not set; printing summary to stdout");
  }

  console.log(markdownContent);
}

module.exports = {
  writeJobSummary,
};
