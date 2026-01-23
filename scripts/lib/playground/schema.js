// playground/schema.js
// ---------------------------------------------------------------------------
// Purpose
//   Shared helpers for the WordPress Playground Blueprint JSON schema.
//
// Behavior
//   - Fetches the official schema JSON and compiles it with Ajv.
//   - Caches the compiled validator per Node.js process.
//
// Failure modes
//   - Network/HTTP failures fetching the schema throw an Error.
//   - Invalid schema / compilation failures throw an Error.

const PLAYGROUND_SCHEMA_URL =
  "https://playground.wordpress.net/blueprint-schema.json";

let compiledSchemaValidatorPromise;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

async function getCompiledPlaygroundSchemaValidator() {
  if (compiledSchemaValidatorPromise) return compiledSchemaValidatorPromise;

  compiledSchemaValidatorPromise = (async () => {
    const Ajv = require("ajv");
    const addFormats = require("ajv-formats");

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    const schema = await fetchJson(PLAYGROUND_SCHEMA_URL);

    return ajv.compile(schema);
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
