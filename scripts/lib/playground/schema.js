// playground/schema.js
// ---------------------------------------------------------------------------
// Purpose
//   Shared helpers for the WordPress Playground Blueprint JSON schema.
//
// Behavior
//   - Loads a vendored schema JSON from this repo and compiles it with Ajv.
//   - Caches the compiled validator per Node.js process.
//
// Failure modes
//   - Missing vendored schema throws an Error with a clear hint.
//   - Invalid schema / compilation failures throw an Error.

const fs = require("node:fs");
const path = require("node:path");

const PLAYGROUND_SCHEMA_URL =
  "https://playground.wordpress.net/blueprint-schema.json";

let compiledSchemaValidatorPromise;

const VENDORED_SCHEMA_PATH = path.join(__dirname, "blueprint-schema.json");

function readVendoredPlaygroundSchema() {
  if (!fs.existsSync(VENDORED_SCHEMA_PATH)) {
    throw new Error(
      "WordPress Playground blueprint schema is missing. " +
        `Expected vendored schema at ${VENDORED_SCHEMA_PATH}. ` +
        "This repo validates blueprints offline and does not fetch the schema from the network.",
    );
  }

  const raw = fs.readFileSync(VENDORED_SCHEMA_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(
      `Vendored Playground schema JSON is invalid at ${VENDORED_SCHEMA_PATH}: ${message}`,
    );
  }
}

async function getCompiledPlaygroundSchemaValidator() {
  if (compiledSchemaValidatorPromise) return compiledSchemaValidatorPromise;

  compiledSchemaValidatorPromise = (async () => {
    try {
      const Ajv = require("ajv");
      const addFormats = require("ajv-formats");

      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);

      const schema = readVendoredPlaygroundSchema();
      return ajv.compile(schema);
    } catch (error) {
      // Avoid caching failures forever; allow a later call to succeed.
      compiledSchemaValidatorPromise = undefined;
      throw error;
    }
  })();

  return compiledSchemaValidatorPromise;
}

function formatAjvErrors(errors) {
  if (!errors || errors.length === 0) return "Unknown schema validation error.";
  return errors
    .map((error) => {
      const instancePath = error.instancePath || "(root)";
      const message = error.message || "invalid";
      return `${instancePath}: ${message}`;
    })
    .join("\n");
}

module.exports = {
  PLAYGROUND_SCHEMA_URL,
  getCompiledPlaygroundSchemaValidator,
  formatAjvErrors,
};
