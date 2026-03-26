# CLAUDE.md — krokedil-wp-ci

Reusable GitHub Actions workflows and helper scripts for Krokedil WordPress/WooCommerce plugins.

## Quick reference

```bash
# Node version (use nvm)
nvm use                    # loads .nvmrc → 20.19.0

# Install
npm install                # root dependencies
cd tests/plugin-dev-zip && npm install  # test dependencies

# Tests
npm run test:scripts       # unit tests (node --test tests/scripts)
cd tests/plugin-dev-zip
npm test                   # full suite (vitest + playwright)
npm run test:integration   # vitest only
npm run test:e2e           # playwright with UI
npm run test:e2e:fixture   # e2e against dummy fixture plugin

# Local dev
cd tests/plugin-dev-zip && npm run server  # WordPress Playground blueprint server
```

## Project structure

- `.github/workflows/` — reusable workflows (workflow_call pattern)
- `scripts/` — shared bash + node scripts called by workflows
- `scripts/lib/` — shared libraries (playground, instawp, job-summary)
- `tests/scripts/` — unit tests for root scripts (node --test)
- `tests/plugin-dev-zip/` — integration (vitest) + e2e (playwright) tests
- `examples/` — example plugin workflow configurations

## Key conventions

### Reusable workflow checkout path
Workflows run in the _caller_ repo checkout. Scripts from this repo are checked out to `.github/krokedil-wp-ci` so packaging can exclude them via `.distignore`. Reference scripts as `.github/krokedil-wp-ci/scripts/...`.

### Plugin meta contract
Caller repos provide `.github/plugin-meta.json` with `slug` (required), `distributionPlatform` (optional), and `playground` (optional). Canonical parser: `scripts/get-plugin-meta.sh`.

### Dev zip packaging
- `distributionPlatform: "wordpress-org"` → wp.org-compatible flow
- Otherwise → rsync with exclude precedence: `.distignore` > `.kernlignore` > none

### Tests
- Tests under `tests/plugin-dev-zip` are ESM (`"type": "module"`)
- E2E reuses shared blueprint generator from `scripts/lib/playground/index.js`
- PHP version control: `KROKEDIL_TEST_PHP_VERSIONS=8.2,8.3` (default: 8.3)

### Code style
- Scripts start with header comment: purpose, inputs, behavior, failure modes
- Section headers: `// ---------------------------------------------------------------------------` + 1-line title
- JSDoc `@typedef`/`@property` for config objects
- Comments explain "why" and "what", not obvious code
- Test files: header stating what's tested, fixtures used, env vars involved

### General rules
- Keep workflow/script inputs and outputs stable; update docs + examples if changing
- Prefer small composable scripts over complex YAML logic
- No plugin-specific hardcoding in shared workflows/scripts/tests
