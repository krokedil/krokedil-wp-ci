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
- `distribution-platform` (optional but recommended): e.g. `wordpress-org` or other values
- `playground` (optional): config used to generate Playground links in job summaries

The canonical parser is `scripts/get-plugin-meta.sh`. Prefer using it rather than re-parsing JSON in workflows.

## Dev zip packaging rules

- If `distribution-platform` is `wordpress-org`: use wp.org-compatible packaging flow.
- Otherwise use rsync packaging and exclude file precedence:
  1. `.distignore`
  2. `.kernlignore`
  3. no ignore file

## Tests conventions

- Tests under `tests/plugin-dev-zip` are ESM (`"type": "module"`).
- Playwright and WordPress Playground CLI require Node >= 18; recommend Node 20.
- E2E should reuse the shared blueprint generator in `scripts/lib/playground-blueprint.js`.
- Keep changes minimal and aligned with existing patterns.

## When editing code

- Keep workflow/script inputs and outputs stable; if adding or changing them, update docs and examples.
- Prefer small, composable scripts over complex YAML logic.
- Avoid plugin-specific hardcoding in shared workflows/scripts/tests.
