/**
 * slack-notify.test.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Tests for `scripts/slack-notify-create-plugin-dev-zip.js`.
 *   Runs the script as a child process with controlled env vars and verifies
 *   that stdout is a valid Slack Block Kit JSON payload with expected content.
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
 * @returns {{ text: string, blocks: object[] }}
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

/**
 * Collect all mrkdwn text from blocks into a single string for content assertions.
 * @param {object[]} blocks
 * @returns {string}
 */
function allBlockText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.text?.text) parts.push(block.text.text);
    if (block.elements) {
      for (const el of block.elements) {
        if (el.text) parts.push(el.text);
      }
    }
  }
  return parts.join("\n");
}

test("outputs valid Block Kit payload with text fallback and blocks array", () => {
  const result = runScript({
    ZIP_FILE_NAME: "my-plugin-1.0.0",
    WORKFLOW_RUN_URL: "https://github.com/org/repo/actions/runs/123",
  });

  assert.equal(typeof result.text, "string");
  assert.ok(result.text.length > 0, "text fallback should not be empty");
  assert.ok(Array.isArray(result.blocks), "should have blocks array");
  assert.ok(result.blocks.length > 0, "blocks should not be empty");
});

test("has header block for Created dev zip", () => {
  const result = runScript({ ZIP_FILE_NAME: "test-plugin" });

  const headers = result.blocks.filter((b) => b.type === "header");
  const headerTexts = headers.map((h) => h.text.text);
  assert.ok(
    headerTexts.some((t) => t.includes("Created dev zip")),
    "should have a header block for Created dev zip",
  );
});

test("has divider blocks for visual separation", () => {
  const result = runScript({ ZIP_FILE_NAME: "test-plugin" });

  const dividers = result.blocks.filter((b) => b.type === "divider");
  assert.ok(dividers.length > 0, "should have at least one divider block");
});

test("includes zip name and S3 download link in blocks", () => {
  const result = runScript({
    ZIP_FILE_NAME: "my-plugin-1.0.0",
    AWS_S3_PUBLIC_URL: "https://s3.example.com/my-plugin-1.0.0.zip",
  });

  const text = allBlockText(result.blocks);
  assert.ok(
    text.includes("<https://s3.example.com/my-plugin-1.0.0.zip|my-plugin-1.0.0.zip>"),
    "should contain Slack-formatted download link",
  );
  assert.ok(
    text.includes("Download or share URL for created dev zip through the link below, which is available for 30 days:"),
    "should match GitHub summary download text",
  );
});

test("includes local-only message when no S3 URL", () => {
  const result = runScript({ ZIP_FILE_NAME: "my-plugin-1.0.0" });

  const text = allBlockText(result.blocks);
  assert.ok(
    text.includes("Dev zip created locally"),
    "should note local-only when no S3 URL",
  );
});

test("includes workflow run URL in a context block", () => {
  const url = "https://github.com/krokedil/plugin/actions/runs/6848299318";
  const result = runScript({
    ZIP_FILE_NAME: "test-plugin",
    WORKFLOW_RUN_URL: url,
  });

  const text = allBlockText(result.blocks);
  assert.ok(
    text.includes(`_Triggered by workflow run:_ ${url}`),
    "should contain workflow run URL",
  );

  const contextBlocks = result.blocks.filter((b) => b.type === "context");
  const hasRunUrl = contextBlocks.some((b) =>
    b.elements.some((el) => el.text.includes("Triggered by workflow run")),
  );
  assert.ok(hasRunUrl, "workflow run URL should be in a context block");
});

test("includes documentation text in blocks", () => {
  const result = runScript({ ZIP_FILE_NAME: "test-plugin" });

  const text = allBlockText(result.blocks);
  assert.ok(
    text.includes("Documentation about how to install the dev zip can be found"),
    "should contain documentation text",
  );
  assert.ok(
    text.includes("<https://docs.krokedil.com/"),
    "should contain documentation link in Slack format",
  );
});

test("does not contain markdown headings in block text", () => {
  const result = runScript({ ZIP_FILE_NAME: "test-plugin" });

  const text = allBlockText(result.blocks);
  assert.ok(!text.includes("# "), "should not contain markdown headings");
});

test("omits workflow run block when WORKFLOW_RUN_URL is empty", () => {
  const result = runScript({
    ZIP_FILE_NAME: "test-plugin",
    WORKFLOW_RUN_URL: "",
  });

  const text = allBlockText(result.blocks);
  assert.ok(
    !text.includes("Triggered by workflow run"),
    "should not contain workflow run when URL is empty",
  );
});
