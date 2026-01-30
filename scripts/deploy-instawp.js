#!/usr/bin/env node
/**
 * deploy-instawp.js
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Orchestrate InstaWP site detection/creation and dev-zip deployment.
 *
 * Inputs (environment variables):
 *   - INSTA_WP_URL         : Optional InstaWP site URL to deploy to
 *   - INSTAWP_API_TOKEN    : InstaWP API token (required)
 *   - AWS_S3_PUBLIC_URL    : Public S3 URL of the dev zip (required)
 *   - PLUGIN_META_JSON     : Plugin metadata for InstaWP settings (required)
 *   - GITHUB_ENV           : Path for GitHub Actions env outputs (optional)
 *   - GITHUB_OUTPUT        : Path for GitHub Actions step outputs (optional)
 *
 * Behavior:
 *   - Resolves InstaWP metadata, selects or creates a site, uploads the dev zip,
 *     and runs setup commands when a new site is created.
 *
 * Failure modes:
 *   - Missing required env vars or invalid PLUGIN_META_JSON exits with code 1.
 *   - InstaWP API failures bubble up and fail the step.
 * ---------------------------------------------------------------------------
 */

const fs = require("fs");

const { loadMeta } = require("./lib/plugin-meta");
const {
  createLogger,
  createInstawpClient,
  buildInstawpMetaConfig,
  deployPluginDevZip,
} = require("./lib/instawp");

const logger = createLogger();

let META;
try {
  META = loadMeta({ requireEnv: true });
} catch (e) {
  logger.logError(e.message);
  process.exit(1);
}

const INSTA_WP_URL = process.env.INSTA_WP_URL || "";
const INSTAWP_API_TOKEN = process.env.INSTAWP_API_TOKEN || "";
const AWS_S3_PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL || "";
const GITHUB_ENV = process.env.GITHUB_ENV;
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

const REQUIRED_ENVS = ["INSTAWP_API_TOKEN", "AWS_S3_PUBLIC_URL"];
const missingEnvs = REQUIRED_ENVS.filter((env) => !process.env[env]);
if (missingEnvs.length > 0) {
  logger.logError(
    `Missing required environment variables: ${missingEnvs.join(", ")}`,
  );
  process.exit(1);
}

const metaConfig = buildInstawpMetaConfig(META, process.env);
const client = createInstawpClient({ apiToken: INSTAWP_API_TOKEN, logger });

(async () => {
  try {
    const { siteId, siteUrl, siteCreated } = await deployPluginDevZip({
      instawpUrl: INSTA_WP_URL,
      awsS3PublicUrl: AWS_S3_PUBLIC_URL,
      metaConfig,
      client,
      logger,
    });

    if (GITHUB_ENV) {
      fs.appendFileSync(GITHUB_ENV, `INSTA_WP_SITE_ID=${siteId}\n`);
    }
    if (GITHUB_OUTPUT) {
      fs.appendFileSync(GITHUB_OUTPUT, `instawp_site_id=${siteId}\n`);
      fs.appendFileSync(GITHUB_OUTPUT, `instawp_site_url=${siteUrl}\n`);
      fs.appendFileSync(GITHUB_OUTPUT, `instawp_site_created=${siteCreated}\n`);
    }

    console.log(
      `${siteCreated ? "Created new" : "Found"} site with siteid: ${
        siteId
      }, siteurl: ${siteUrl}`,
    );
  } catch (e) {
    logger.logError("Unhandled error: " + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
})();
