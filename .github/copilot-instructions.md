# Copilot instructions for krokedil-wp-ci

This repo provides reusable GitHub Actions workflows and helper scripts for Krokedil WordPress/WooCommerce plugins.

## Core structure (do not invent new structure)

- Reusable workflows live in `.github/workflows/`.
- Shared scripts live in `scripts/` (bash + node). Workflows should call scripts, not duplicate logic.
- Shared tests live in `tests/plugin-dev-zip/`.

## Reusable workflow convention (critical)

Reusable workflows run in the _caller_ repository checkout. Therefore, when a workflow needs scripts from this repo, it must:

1. checkout the caller repo (default behavior), and then
2. checkout `krokedil/krokedil-wp-ci` into `.github/krokedil-wp-ci`

This path is intentional so packaging can exclude it (e.g. via `.distignore`).

When referencing scripts from workflows, prefer:

- `.github/krokedil-wp-ci/scripts/...`

## Plugin meta contract

Caller repos must provide `.github/plugin-meta.json`.

Known keys:

- `slug` (required): plugin directory slug
- `distributionPlatform` (optional but recommended): e.g. `wordpress-org` or other values
- `playground` (optional): config used to generate Playground links in job summaries

The canonical parser is `scripts/get-plugin-meta.sh`. Prefer using it rather than re-parsing JSON in workflows.

## Dev zip packaging rules

- If `distributionPlatform` is `wordpress-org`: use wp.org-compatible packaging flow.
- Otherwise use rsync packaging and exclude file precedence:
  1. `.distignore`
  2. `.kernlignore`
  3. no ignore file

## Tests conventions

- Tests under `tests/plugin-dev-zip` are ESM (`"type": "module"`).
- Playwright and WordPress Playground CLI require Node >= 18; recommend Node 20.
- E2E should reuse the shared blueprint generator in `scripts/lib/playground/index.js`.
- Keep changes minimal and aligned with existing patterns.

## When editing code

- Keep workflow/script inputs and outputs stable; if adding or changing them, update docs and examples.
- Prefer small, composable scripts over complex YAML logic.
- Avoid plugin-specific hardcoding in shared workflows/scripts/tests.

## Comment style

- For Node/bash scripts in `scripts/`, prefer starting the file with a short “introduction” header comment that documents:
  - Purpose
  - Inputs (env vars/args)
  - Behavior (high-level steps)
  - Failure modes (what happens when inputs are missing, external calls fail, etc)
- Prefer short, structured “section header” comments to explain intent in scripts (like:
  `// ---------------------------------------------------------------------------` + a 1-line title).
- For “variables/config object” inputs (env vars, options, template variables), prefer a JSDoc `@typedef`/`@property` block that documents:
  - what each variable controls,
  - expected type/shape,
  - default/fallback behavior.
- Use comments to clarify _why_ and _what_ (inputs, outputs, failure modes), not restating obvious code.
- Keep comments up-to-date when changing logic; remove stale comments.

### Tests comment style

- For test files under `tests/**`, add a short header comment at the top that states:
  - what is being tested (contract/behavior)
  - which fixture(s) and env vars are involved (e.g. `PLUGIN_META_JSON`)
  - why the fixture exists (deterministic and reusable)
- Prefer short, structured section headers in longer tests/helpers (same style as scripts):
  `// ---------------------------------------------------------------------------` + a 1-line title.
- If a test overrides env vars, add a short comment explaining what is being overridden and why.

## References

- Playground Blueprints docs: https://wordpress.github.io/wordpress-playground/blueprints/
- Playground Blueprint schema: https://playground.wordpress.net/blueprint-schema.json
- Playground CLI docs: https://wordpress.github.io/wordpress-playground/cli/
- Playwright test runner docs: https://playwright.dev/docs/test-intro
- Playwright config reference: https://playwright.dev/docs/test-configuration

