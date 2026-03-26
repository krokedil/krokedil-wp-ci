/**
 * slack-notify.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Tests for `scripts/slack-notify-create-plugin-dev-zip.js`.
 *   Runs the script as a child process with controlled env vars and verifies
 *   that stdout is a valid Slack webhook JSON payload with expected content.
 *
 * Fixtures:
 *   - Uses the Playwright JSON report fixture when present (tests run from repo root).
 *
 * Env vars:
 *   - ZIP_FILE_NAME, AWS_S3_PUBLIC_URL, PLAYWRIGHT_REPORT_URL, PLUGIN_META_JSON,
 *     WORKFLOW_RUN_URL
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "slack-notify-create-plugin-dev-zip.js",
);

/**
 * Run the Slack notify script with the given env vars and return parsed JSON.
 * @param {Record<string, string>} envOverrides
 * @returns {{ text: string }}
 */
function runScript(envOverrides = {}) {
  const env = {
    ...process.env,
    // Clear vars that the script reads so tests are deterministic.
    ZIP_FILE_NAME: "",
    AWS_S3_PUBLIC_URL: "",
    PLAYWRIGHT_REPORT_URL: "",
    PLUGIN_META_JSON: "",
    WORKFLOW_RUN_URL: "",
    GITHUB_STEP_SUMMARY: "",
    ...envOverrides,
  };

  const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });

  return JSON.parse(stdout);
}

test("outputs valid JSON with a text field", () => {
  const result = runScript({
    ZIP_FILE_NAME: "my-plugin-1.0.0",
    WORKFLOW_RUN_URL: "https://github.com/org/repo/actions/runs/123",
  });

  assert.equal(typeof result.text, "string");
  assert.ok(result.text.length > 0, "text should not be empty");
});

test("includes zip name and S3 download link in Slack format", () => {
  const result = runScript({
    ZIP_FILE_NAME: "my-plugin-1.0.0",
    AWS_S3_PUBLIC_URL: "https://s3.example.com/my-plugin-1.0.0.zip",
  });

  assert.ok(
    result.text.includes("<https://s3.example.com/my-plugin-1.0.0.zip|my-plugin-1.0.0.zip>"),
    "should contain Slack-formatted download link",
  );
});

test("includes local-only message when no S3 URL", () => {
  const result = runScript({
    ZIP_FILE_NAME: "my-plugin-1.0.0",
  });

  assert.ok(
    result.text.includes("Dev zip created locally"),
    "should note local-only when no S3 URL",
  );
});

test("includes workflow run URL at the end", () => {
  const url = "https://github.com/krokedil/plugin/actions/runs/6848299318";
  const result = runScript({
    ZIP_FILE_NAME: "test-plugin",
    WORKFLOW_RUN_URL: url,
  });

  assert.ok(
    result.text.includes(`_Triggered by workflow run:_ ${url}`),
    "should contain workflow run URL",
  );
});

test("includes documentation link in Slack format", () => {
  const result = runScript({
    ZIP_FILE_NAME: "test-plugin",
  });

  assert.ok(
    result.text.includes("<https://docs.krokedil.com/"),
    "should contain documentation link in Slack format",
  );
});

test("uses *bold* headings instead of markdown #", () => {
  const result = runScript({
    ZIP_FILE_NAME: "test-plugin",
  });

  assert.ok(
    result.text.includes("*Created dev zip*"),
    "should use Slack bold for heading",
  );
  assert.ok(
    !result.text.includes("# "),
    "should not contain markdown headings",
  );
});

test("omits workflow run line when WORKFLOW_RUN_URL is empty", () => {
  const result = runScript({
    ZIP_FILE_NAME: "test-plugin",
    WORKFLOW_RUN_URL: "",
  });

  assert.ok(
    !result.text.includes("Triggered by workflow run"),
    "should not contain workflow run line when URL is empty",
  );
});
