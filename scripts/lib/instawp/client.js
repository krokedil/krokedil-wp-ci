// client.js
// ---------------------------------------------------------------------------
// Purpose:
//   Provide a small InstaWP API client with logging and retries for site
//   creation, site lookups, and command execution.
//
// Inputs (params):
//   - apiToken (string): InstaWP API token
//   - host (string, optional): API host (default: app.instawp.io)
//   - logger (object): logInfo/logWarn/logError/logGroupStart/logGroupEnd
//
// Behavior:
//   - Wraps API calls with log groups and payload/response logging
//   - Provides helpers for site creation and task polling
//
// Failure modes:
//   - Missing apiToken throws immediately
//   - API errors throw with status code and response
// ---------------------------------------------------------------------------

const https = require("https");

/**
 * @typedef {Object} InstawpClientOptions
 * @property {string} apiToken
 * @property {string} [host]
 * @property {{
 *  logInfo: (msg: string) => void,
 *  logWarn: (msg: string) => void,
 *  logError: (msg: string) => void,
 *  logGroupStart: (name: string) => void,
 *  logGroupEnd: () => void,
 * }} logger
 */

/**
 * @typedef {Object} ApiCallParams
 * @property {string} method
 * @property {string} path
 * @property {string} [body]
 * @property {string} [logLabel]
 */

function createInstawpClient({ apiToken, host = "app.instawp.io", logger }) {
  if (!apiToken) throw new Error("INSTAWP_API_TOKEN env not set");

  const INSTA_WP_API_HEADERS = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function apiCall({ method, path, body, logLabel }) {
    logger.logGroupStart(logLabel || `API Request: ${method} ${path}`);
    if (body) {
      logger.logInfo("Payload:");
      try {
        console.log(
          typeof body === "string" ? body : JSON.stringify(body, null, 2),
        );
      } catch {}
    }
    let response;
    try {
      response = await instawpApiRequest({ method, path, body });
    } catch (err) {
      logger.logError(
        `API call failed: ${err && err.message ? err.message : err}`,
      );
      logger.logGroupEnd();
      throw err;
    }
    logger.logGroupStart("API Response");
    console.log(JSON.stringify(response, null, 2));
    logger.logGroupEnd();
    logger.logGroupEnd();
    return response;
  }

  function instawpApiRequest({ method, path, body }) {
    const options = {
      hostname: host,
      path,
      method,
      headers: { ...INSTA_WP_API_HEADERS },
    };
    if (body) {
      options.headers["Content-Length"] = Buffer.byteLength(body);
    }
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch (e) {
              resolve(data);
            }
          } else {
            logger.logError(
              `InstaWP API error: ${JSON.stringify({
                method,
                path,
                statusCode: res.statusCode,
                response: data,
              })}`,
            );
            reject(new Error(`InstaWP API error: ${res.statusCode} - ${data}`));
          }
        });
      });
      req.on("error", (err) => {
        logger.logError(
          "Network error: " + (err && err.stack ? err.stack : err),
        );
        reject(err);
      });
      if (body) req.write(body);
      req.end();
    });
  }

  async function getExistingSites() {
    const json = await apiCall({
      method: "GET",
      path: "/api/v2/sites?per_page=300",
      logLabel: "Get sites",
    });
    return json.data || [];
  }

  async function createNewSite(normalizedUrl) {
    logger.logGroupStart("Create InstaWP site");
    const payload = {
      configuration_id: 5141,
      team_id: 4875,
      server_group_id: 4,
      is_reserved: false,
      expiry_hours: 1,
    };
    if (normalizedUrl) payload.site_name = normalizedUrl;
    logger.logInfo(`Create site payload: ${JSON.stringify(payload)}`);
    const json = await apiCall({
      method: "POST",
      path: "/api/v2/sites",
      body: JSON.stringify(payload),
      logLabel: "Site creation",
    });
    const siteData = json.data || json;

    if (siteData.task_id) {
      logger.logInfo(
        `Creation is asynchronous (task_id=${siteData.task_id}). Waiting for readiness...`,
      );
      for (let i = 1; i <= 30; i++) {
        logger.logInfo(`Checking site status (attempt ${i})...`);
        try {
          const statusRes = await instawpApiRequest({
            method: "GET",
            path: `/api/v2/tasks/${siteData.task_id}/status`,
          });
          logger.logGroupStart("Task status response");
          console.log(JSON.stringify(statusRes, null, 2));
          logger.logGroupEnd();
          const taskStatus = statusRes?.data?.status;
          const siteId = statusRes?.data?.resource_id;
          logger.logInfo(`Task status: ${taskStatus}, site_id: ${siteId}`);
          if (taskStatus === "completed" && siteId && siteId !== "null") {
            logger.logInfo("Site is ready!");
            logger.logGroupEnd();
            return { ...siteData, id: siteId };
          }
        } catch (err) {
          logger.logError(
            "Error checking site status: " +
              (err && err.stack ? err.stack : err),
          );
        }
        await new Promise((res) => setTimeout(res, 10000));
      }
      logger.logError("Timed out waiting for site to be ready.");
      logger.logGroupEnd();
      throw new Error("Timed out waiting for site to be ready.");
    }
    logger.logGroupEnd();
    return siteData;
  }

  async function triggerInstaWpCommand(siteId, commandId, commandArguments) {
    const payload = { command_id: commandId };
    if (Array.isArray(commandArguments) && commandArguments.length > 0) {
      payload.commandArguments = commandArguments;
    }
    logger.logInfo(
      `Triggering InstaWP command ${commandId} for site ${siteId}`,
    );
    await apiCall({
      method: "POST",
      path: `/api/v2/sites/${siteId}/execute-command`,
      body: JSON.stringify(payload),
      logLabel: `Command ${commandId}`,
    });
  }

  async function maybeTriggerCommand({
    siteId,
    commandId,
    condition,
    args = [],
    skipMessage,
  }) {
    if (!condition) {
      if (skipMessage) logger.logInfo(skipMessage);
      return { skipped: true };
    }
    await triggerInstaWpCommand(siteId, commandId, args);
    return { skipped: false };
  }

  return {
    apiCall,
    instawpApiRequest,
    getExistingSites,
    createNewSite,
    triggerInstaWpCommand,
    maybeTriggerCommand,
  };
}

module.exports = {
  createInstawpClient,
};
