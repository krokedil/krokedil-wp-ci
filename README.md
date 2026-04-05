# Krokedil WordPress CI

Reusable GitHub Actions workflows and helper scripts for Krokedil WordPress/WooCommerce plugins.

This repository is meant to be checked out inside plugin repositories and used via `uses:` from GitHub Actions. It centralizes common CI tasks like building dev zips, running shared tests, and deploying to InstaWP.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (see `.nvmrc`)
- [Git](https://git-scm.com/)
- [PHP](https://www.php.net/) 8.2 — some plugins use Composer post-install scripts (e.g. php-scoper) that are not yet compatible with PHP 8.3+. On macOS with Homebrew:
  ```bash
  brew install shivammathur/php/php@8.2
  brew unlink php && brew link php@8.2 --force
  ```

## Contents

- Reusable workflows under `.github/workflows/`
- Helper scripts under `scripts/`
- Example plugin workflows under `examples/`

## Reusable workflows

The main entry points you will use from plugin repositories are:

- `get-plugin-meta.yml` – reads `.github/plugin-meta.json` in your plugin repo and exposes it as reusable outputs (e.g. `plugin_slug`, `distribution_platform`, `plugin_meta_json`).
- `create-plugin-dev-zip.yml` – builds a dev zip of your plugin, optionally uploads it to AWS S3, and writes a job summary including a WordPress Playground link when configured.
- `deploy-plugin-dev-zip-instawp.yml` – deploys a previously-built dev zip to InstaWP and adds a job summary.

Each workflow is declared with `on: workflow_call` so it can be used from other repositories via `uses:`.

## Plugin metadata

Each plugin repository that uses these workflows should define a `.github/plugin-meta.json` file. This is the single source of truth for plugin-specific metadata.

Minimal example (see `examples/basic-plugin-meta-json/.github/plugin-meta.json` for a complete version):

```json
{
  "slug": "my-plugin-slug",
  "distributionPlatform": "wordpress-org",
  "playground": {
    "preferredVersions": {
      "php": "8.2",
      "wp": "latest"
    }
  }
}
```

Key fields:

- `slug` (required): The plugin directory/slug. Used when naming zips and building paths.
- `distributionPlatform` (optional but recommended): Controls how the dev zip is prepared. Typical values:
  - `wordpress-org` – build using the WordPress.org-compatible flow.
  - Other values (e.g. `kernl`) – use a manual rsync-based packaging flow with `.distignore` / `.kernlignore` support.
- `playground` (optional): Used to generate a WordPress Playground blueprint URL in job summaries.
- `requiresPlugins` (optional, reserved for future use): Intended for declaring required plugin slugs (e.g. `woocommerce`).

The shell script `scripts/get-plugin-meta.sh` is responsible for reading this file and exposing outputs to the workflows.

## Dev zip creation

The `create-plugin-dev-zip.yml` workflow encapsulates the common flow for building a dev zip of a plugin. At a high level it:

1. Reads `.github/plugin-meta.json` using `scripts/get-plugin-meta.sh`.
2. Prepares the dev zip contents using `scripts/prepare-plugin-dev-zip.sh` (builds assets, selects ignore file, etc.).
3. Optionally zips and uploads the artifact to AWS S3 using `scripts/upload-zip-aws-s3.sh`.
4. Writes a GitHub job summary with details and an optional WordPress Playground link.

This workflow is intended to be called from a plugin repository. See `examples/basic-dev-zip/` for a minimal usage example.

### Building the plugin

When preparing the dev zip, `scripts/prepare-plugin-dev-zip.sh` will automatically look for common production build scripts in your plugin and run them if they exist:

- If your plugin has an `npm` script named `build:prod`, it will run `npm run build:prod`.
- Otherwise, if there is an `npm` script named `build-prod`, it will run `npm run build-prod`.

If neither script is present, the workflow skips the build step and just packages the current working tree. This lets each plugin opt in to its own build process while keeping the CI configuration shared.

## InstaWP deployment

The `deploy-plugin-dev-zip-instawp.yml` workflow deploys a dev zip to InstaWP. It uses Node scripts under `scripts/` (such as `deploy-instawp.js` and `job-summary-deploy-plugin-dev-zip-instawp.js`) and takes an `instawp_url` input which controls where the dev build is deployed.

### `instawp_url` behaviour

- **Existing InstaWP site**: If `instawp_url` points to an InstaWP site that already exists, the workflow will only send the new dev zip to that site. The environment stays the same; only the plugin build is updated.
- **New InstaWP site**: If `instawp_url` does not match an existing site, a new InstaWP site is created and configured using metadata from your `.github/plugin-meta.json` file.

See `examples/basic-deploy-instawp/` for a minimal usage example.

### InstaWP-related metadata

When creating a new site, plugin-specific configuration (WooCommerce setup, credentials, payment gateway order, checkout mode, etc.) is handled by blueprint modules under `scripts/lib/blueprint/plugins/`. See existing modules for examples.

## Helper scripts

The `scripts/` directory contains the shared shell and Node utilities used by the workflows. Notable scripts include:

- `scripts/get-plugin-meta.sh` – parses `.github/plugin-meta.json`, validates required fields, and writes outputs (`plugin_slug`, `distribution_platform`, `plugin_meta_json`).
- `scripts/prepare-plugin-dev-zip.sh` – prepares the dev zip contents based on `PLUGIN_SLUG` and `DISTRIBUTION_PLATFORM`, runs builds if present, and picks the appropriate ignore file (`.distignore` → `.kernlignore` → none).
- `scripts/upload-zip-aws-s3.sh` – creates the final zip from the prepared directory and uploads it to S3, emitting the public URL.
- `scripts/deploy-instawp.js` – Node script used to talk to the InstaWP API.
- `scripts/job-summary-create-plugin-dev-zip.js` – writes a Markdown job summary including the dev zip URL and optional Playground link.
- `scripts/job-summary-deploy-plugin-dev-zip-instawp.js` – writes a job summary for InstaWP deployments.

These scripts are meant to be invoked from within the reusable workflows, not directly from plugin repos.

- `scripts/playground.js` – starts a local WordPress Playground server with a Krokedil plugin installed. See [Local Playground](#local-playground) below.

## Managing the centrally-dispatched plugin list

The dropdown of plugins available in the `centrally-*` workflows is maintained in a single file: `.github/projects.json`.

To add or remove a plugin:

1. Edit `.github/projects.json` — add or remove an entry with `displayName` (human-readable name shown in the dropdown) and `repository` (`owner/repo`). Keep entries sorted A-Z by `displayName`.
2. Run `npm run sync:plugins` — this propagates the changes to the workflow dropdown options. Plugin resolution at runtime reads `projects.json` directly.
3. Commit the result.

To verify the list is in sync without making changes, run `npm run check:plugins`.

## WordPress Playground blueprint schema

Blueprint JSON schema validation in this repo is intentionally offline-only.

- The schema is vendored at [scripts/lib/blueprint/blueprint-schema.json](scripts/lib/blueprint/blueprint-schema.json).
- Validation code lives in [scripts/lib/blueprint/schema.js](scripts/lib/blueprint/schema.js) and will not fetch the schema from the network.

When you bump WordPress Playground packages (typically [tests/plugin-dev-zip/package.json](tests/plugin-dev-zip/package.json)), you should also refresh the vendored schema by copying it from the installed Playground packages and committing the updated JSON file.

## Local development

This repo expects Node.js 20+ (see `.nvmrc` and `package.json#engines`).

- Use nvm: `nvm use` (from repo root)
- Install dependencies:
  - Root scripts/tests: `npm install`
  - Shared plugin-dev-zip tests: `cd tests/plugin-dev-zip && npm install`
- Run script unit tests (Node test runner): `npm run test:scripts`
- Run shared plugin-dev-zip tests:
  - `cd tests/plugin-dev-zip && npm test`
  - e2e against the dummy fixture plugin: `cd tests/plugin-dev-zip && npm run test:e2e:fixture`

E2E PHP versions:

- Default is PHP 8.3.
- Override with `KROKEDIL_TEST_PHP_VERSIONS=8.2,8.3` or `KROKEDIL_TEST_PHP_VERSIONS=all`.
- Update the supported list in [tests/plugin-dev-zip/end-to-end/playwright.config.ts](tests/plugin-dev-zip/end-to-end/playwright.config.ts) when `@wp-playground/cli` adds/removes PHP versions.

Reusable workflow input:

- Set `with: test_php_versions: "8.2,8.3"` (or `"all"`) when calling `create-plugin-dev-zip.yml` to control the Playwright PHP matrix.

If you see errors like `node: bad option: --test`, you're running an older Node version.

### Local Playground

`scripts/playground.js` starts a WordPress Playground server with a plugin installed. Useful for inspecting pages and authoring `pluginDevZipE2e` assertions in `plugin-meta.json`.

```bash
# List available plugins (from .github/projects.json)
npm run playground -- --list

# Start Playground with a plugin (clones from GitHub automatically)
npm run playground -- kp
npm run playground -- kco --branch develop

# Use a specific blueprint preset
npm run playground -- kp --blueprint minimal
npm run playground -- kp --blueprint general-e2e

# Use a local plugin directory instead of cloning
npm run playground -- kp --dir ~/Projects/klarna-payments

# Start Playground + launch Playwright codegen for visual selector discovery
npm run playground -- kp --codegen

# Use the in-repo dummy fixture plugin
npm run playground -- dummy
```

Options:

- `<plugin>` (required) – abbreviation, slug, or display name from `.github/projects.json`. Use `dummy` for the in-repo fixture.
- `--blueprint <type>` – blueprint preset to use. Defaults to `full-store`. See below.
- `--dir <path>` – use an existing local directory instead of cloning from GitHub.
- `--branch <name>` – clone/checkout a specific branch (ignored when `--dir` is used).
- `--codegen` – after the server starts, launch `npx playwright codegen` pointed at `/wp-admin/` for interactive selector and assertion authoring.

Blueprint presets (defined in `scripts/lib/blueprint/presets.js`):

| Preset | Description |
|---|---|
| `full-store` (default) | Full Swedish WooCommerce store with tax, shipping, address, HPOS, and general site options. Matches InstaWP new site deploys. |
| `minimal` | Minimal WooCommerce config with beta tester. Matches the job summary playground link. |
| `general-e2e` | Storefront theme, reset WordPress, general site options, WooCommerce, and beta tester. Matches the shared e2e test suite setup. |

Instead of passing `--dir` every time, you can set a per-plugin env var in `.env`:

```bash
# In .env (variable name: {ABBREVIATION}_LOCAL_DIR)
KP_LOCAL_DIR=~/Projects/klarna-payments
KCO_LOCAL_DIR=~/Projects/klarna-checkout
```

Then `npm run playground -- kp` will use the local directory automatically. The `--dir` flag takes precedence over the env var. See `.env.example` for all available variables.

If the plugin has a `.github/plugin-meta.json` with a `slug` field, the plugin is activated automatically. Otherwise it is only mounted and must be activated manually from wp-admin.

## Examples

The `examples/` folder contains minimal plugin-side GitHub Actions configurations that show how to consume these reusable workflows:

- `examples/basic-plugin-meta-json/` – minimal example of a `.github/plugin-meta.json` file.
- `examples/basic-dev-zip/` – minimal workflow that calls `create-plugin-dev-zip.yml` to build a dev zip.
- `examples/basic-deploy-instawp/` – minimal workflow that deploys a dev zip to InstaWP using `deploy-plugin-dev-zip-instawp.yml`.
- `examples/wordpress-org-deploy/` – minimal workflow that deploys a plugin to WordPress.org using the appropriate reusable workflow.

Use these as starting points when wiring new plugin repositories to this CI.

## Versioning and usage

These workflows are designed to be consumed from other repositories using a fixed tag, for example:

```yaml
uses: krokedil/krokedil-wp-ci/.github/workflows/create-plugin-dev-zip.yml@v1
```

When updating this repository, bump or re-tag as appropriate and update plugin repositories to point to the desired version.
