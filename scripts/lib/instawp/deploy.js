// deploy.js
// ---------------------------------------------------------------------------
// Purpose:
//   Orchestrate InstaWP site selection/creation and dev-zip deployment.
//
// Inputs:
//   - instawpUrl: optional InstaWP site URL
//   - awsS3PublicUrl: required S3 URL to the dev zip
//   - metaConfig: InstaWP metadata-derived settings
//   - client: InstaWP API client
//   - logger: logging helpers
//
// Behavior:
//   - Finds or creates a site, uploads dev zip, and runs setup commands
//
// Failure modes:
//   - Propagates client errors (API/network) to the caller
// ---------------------------------------------------------------------------

/**
 * @typedef {import("./meta").InstawpMetaConfig} InstawpMetaConfig
 */

/**
 * @typedef {Object} DeployOptions
 * @property {string} instawpUrl
 * @property {string} awsS3PublicUrl
 * @property {InstawpMetaConfig} metaConfig
 * @property {{
 *  getExistingSites: () => Promise<Array<{ id: string, url?: string }>>,
 *  createNewSite: (normalizedUrl: string) => Promise<Record<string, any>>,
 *  triggerInstaWpCommand: (siteId: string, commandId: number, args?: any[]) => Promise<void>,
 *  maybeTriggerCommand: (options: {
 *    siteId: string,
 *    commandId: number,
 *    condition: boolean,
 *    args?: any[],
 *    skipMessage?: string,
 *  }) => Promise<{ skipped: boolean }>,
 * }} client
 * @property {{
 *  logInfo: (msg: string) => void,
 *  logGroupStart: (name: string) => void,
 *  logGroupEnd: () => void,
 * }} logger
 */

function normalizeUrl(url) {
  return url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
}

/**
 * @param {DeployOptions} options
 * @returns {Promise<{ siteId: string, siteUrl: string, siteCreated: boolean }>}
 */
async function deployPluginDevZip({
  instawpUrl,
  awsS3PublicUrl,
  metaConfig,
  client,
  logger,
}) {
  const normalizedUrl = normalizeUrl(instawpUrl);
  let siteId;
  let siteUrl;
  let siteCreated = false;

  if (normalizedUrl) {
    const sites = await client.getExistingSites();
    const matches = sites.filter((site) => {
      if (!site.url) return false;
      const url = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return url.toLowerCase() === normalizedUrl.toLowerCase();
    });

    if (matches.length > 0) {
      siteId = matches[0].id;
      siteUrl = matches[0].url || "";
      siteCreated = false;
    } else {
      const newSite = await client.createNewSite(normalizedUrl);
      siteId = newSite.id;
      siteUrl = newSite.wp_url || newSite.url || "";
      siteCreated = true;
    }
  } else {
    const newSite = await client.createNewSite("");
    siteId = newSite.id;
    siteUrl = newSite.wp_url || newSite.url || "";
    siteCreated = true;
  }

  await client.triggerInstaWpCommand(siteId, 2301, [
    { dev_zip_public_url: awsS3PublicUrl },
  ]);

  if (siteCreated) {
    logger.logGroupStart("InstaWP setup commands for new site");
    await client.triggerInstaWpCommand(siteId, 2344);

    await client.maybeTriggerCommand({
      siteId,
      commandId: 2334,
      condition: !!metaConfig.pluginWcBlueprintUrl,
      args: [{ wc_blueprint_json_public_url: metaConfig.pluginWcBlueprintUrl }],
      skipMessage:
        "Skipping WooCommerce blueprint (no PLUGIN_WC_BLUEPRINT_URL configured)",
    });

    if (metaConfig.pluginCredentialsOptionPatches.length === 0) {
      logger.logInfo("Skipping credential option patches (none configured)");
    } else {
      for (const patch of metaConfig.pluginCredentialsOptionPatches) {
        await client.maybeTriggerCommand({
          siteId,
          commandId: 2679,
          condition: !!patch.value,
          args: [patch],
          skipMessage: `Skipping credential patch for ${patch.option_name}.${patch.key} (empty value)`,
        });
      }
    }

    await client.maybeTriggerCommand({
      siteId,
      commandId: 2681,
      condition: !!metaConfig.paymentGatewayId,
      args: [{ payment_gateway_id: metaConfig.paymentGatewayId, order: 1 }],
      skipMessage:
        "Skipping payment gateway order (no PAYMENT_GATEWAY_ID in metadata)",
    });

    await client.maybeTriggerCommand({
      siteId,
      commandId: 2549,
      condition: metaConfig.useCheckoutBlock === false,
      args: [],
      skipMessage:
        metaConfig.useCheckoutBlock === true
          ? "Skipping checkout shortcode (USE_CHECKOUT_BLOCK=true)"
          : "Skipping checkout shortcode (USE_CHECKOUT_BLOCK not specified)",
    });
    logger.logGroupEnd();
  }

  return { siteId, siteUrl, siteCreated };
}

module.exports = {
  deployPluginDevZip,
};
