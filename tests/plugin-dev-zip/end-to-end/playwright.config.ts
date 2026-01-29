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
  timeout: 2 * 60 * 1000,
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
    "artifacts",
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
              "report.json",
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
              "html-report",
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
              "report.json",
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
              "html-report",
            ),
          },
        ],
      ],
  use: {
    /*
     * Traces are expensive.
     * - CI: only record on first retry to keep artifacts smaller
     * - Local: retain traces for failures to speed up debugging
     */
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    /* Capture screenshots only when a test fails (keeps CI artifacts smaller). */
    screenshot: "only-on-failure",
  },
  /* Configure projects for the PHP version matrix (server-only). */
  projects: (() => {
    /**
     * Default PHP versions to test against.
     *
     * Keep this list aligned with the versions supported by WordPress Playground
     * (and include deprecated versions as long as Playground still supports them).
     *
     * Can be overridden with `KROKEDIL_PHP_VERSIONS=8.2,8.3`.
     */
    const all = ["8.4", "8.3", "8.2", "8.1", "8.0", "7.4"];

    // Optional filter: comma-separated list, e.g. "8.2,8.3".
    const filter = process.env.KROKEDIL_PHP_VERSIONS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const versions = filter?.length
      ? all.filter((v) => filter.includes(v))
      : all;

    if (!versions.length) {
      throw new Error(
        `No PHP versions selected. Supported: ${all.join(", ")}. ` +
          `Filter: ${process.env.KROKEDIL_PHP_VERSIONS ?? "(not set)"}`,
      );
    }

    return versions.map((phpVersion) => ({
      name: phpVersion,
      use: { ...devices["Desktop Chrome"] },
      metadata: { phpVersion },
    }));
  })(),
});
