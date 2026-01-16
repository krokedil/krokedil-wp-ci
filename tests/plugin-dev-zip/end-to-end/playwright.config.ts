import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: ".",
  /* Default per-test timeout in milliseconds, includes hooks. 1000 ms = 1 second */
  timeout: 60 * 1000,
  /* Default timeout for expect(...) polling assertions. */
  expect: {
    timeout: 5000,
  },
  /* Raw per-test artifacts (attachments, traces, screenshots, etc.). */
  outputDir: path.join(
    __dirname,
    "..",
    "test-results",
    "end-to-end",
    "artifacts"
  ),
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* CI runs can be resource-constrained; tune this if Playground becomes flaky. */
  workers: process.env.CI ? 4 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        ["github"],
        ["dot"],
        [
          "json",
          {
            /* Machine-readable report (useful for CI summaries and tooling). */
            outputFile: path.join(
              __dirname,
              "..",
              "test-results",
              "end-to-end",
              "json-report",
              "report.json"
            ),
          },
        ],
        [
          "html",
          {
            open: "never",
            /* Human-readable HTML report (view with `npx playwright show-report`). */
            outputFolder: path.join(
              __dirname,
              "..",
              "test-results",
              "end-to-end",
              "html-report"
            ),
          },
        ],
      ]
    : [
        ["line"],
        [
          "json",
          {
            /* Machine-readable report (useful for CI summaries and tooling). */
            outputFile: path.join(
              __dirname,
              "..",
              "test-results",
              "end-to-end",
              "json-report",
              "report.json"
            ),
          },
        ],
        [
          "html",
          {
            open: "never",
            /* Human-readable HTML report (view with `npx playwright show-report`). */
            outputFolder: path.join(
              __dirname,
              "..",
              "test-results",
              "end-to-end",
              "html-report"
            ),
          },
        ],
      ],
  use: {
    /* Traces are expensive, "on-first-retry" records only after a failure triggers a retry. */
    trace: "on-first-retry",
    /* Capture screenshots only when a test fails (keeps CI artifacts smaller). */
    screenshot: "only-on-failure",
  },
  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
