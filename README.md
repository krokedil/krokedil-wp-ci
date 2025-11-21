# Krokedil WordPress CI

Reusable GitHub Actions workflows and helper scripts for Krokedil WordPress/WooCommerce plugins.

This repository is meant to be checked out inside plugin repositories and used via `uses:` from GitHub Actions. It centralizes common CI tasks like building dev zips, running shared tests, and deploying to InstaWP.

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
  "distribution-platform": "wordpress-org",
  "playground": {
    "plugins": ["my-plugin-slug"],
    "preferredVersions": {
      "php": "8.2",
      "wp": "latest"
    }
  }
}
```

Key fields:

- `slug` (required): The plugin directory/slug. Used when naming zips and building paths.
- `distribution-platform` (optional but recommended): Controls how the dev zip is prepared. Typical values:
  - `wordpress-org` – build using the WordPress.org-compatible flow.
  - Other values (e.g. `kernl`) – use a manual rsync-based packaging flow with `.distignore` / `.kernlignore` support.
- `playground` (optional): Used to generate a WordPress Playground blueprint URL in job summaries.

The shell script `scripts/get-plugin-meta.sh` is responsible for reading this file and exposing outputs to the workflows.

## Dev zip creation

The `create-plugin-dev-zip.yml` workflow encapsulates the common flow for building a dev zip of a plugin. At a high level it:

1. Reads `.github/plugin-meta.json` using `scripts/get-plugin-meta.sh`.
2. Prepares the dev zip contents using `scripts/prepare-plugin-dev-zip.sh` (builds assets, selects ignore file, etc.).
3. Optionally zips and uploads the artifact to AWS S3 using `scripts/upload-zip-aws-s3.sh`.
4. Writes a GitHub job summary with details and an optional WordPress Playground link.

This workflow is intended to be called from a plugin repository. See `examples/basic-dev-zip/` for a minimal usage example.

## InstaWP deployment

The `deploy-plugin-dev-zip-instawp.yml` workflow deploys a dev zip to InstaWP. It uses Node scripts under `scripts/` (such as `deploy-instawp.js` and `job-summary-deploy-plugin-dev-zip-instawp.js`) to:

- Trigger a deployment using an existing dev zip URL.
- Report status and key links in a job summary.

See `examples/basic-deploy-instawp/` for a minimal usage example.

## Helper scripts

The `scripts/` directory contains the shared shell and Node utilities used by the workflows. Notable scripts include:

- `scripts/get-plugin-meta.sh` – parses `.github/plugin-meta.json`, validates required fields, and writes outputs (`plugin_slug`, `distribution_platform`, `plugin_meta_json`).
- `scripts/prepare-plugin-dev-zip.sh` – prepares the dev zip contents based on `PLUGIN_SLUG` and `DISTRIBUTION_PLATFORM`, runs builds if present, and picks the appropriate ignore file (`.distignore` → `.kernlignore` → none).
- `scripts/upload-zip-aws-s3.sh` – creates the final zip from the prepared directory and uploads it to S3, emitting the public URL.
- `scripts/deploy-instawp.js` – Node script used to talk to the InstaWP API.
- `scripts/job-summary-create-plugin-dev-zip.js` – writes a Markdown job summary including the dev zip URL and optional Playground link.
- `scripts/job-summary-deploy-plugin-dev-zip-instawp.js` – writes a job summary for InstaWP deployments.

These scripts are meant to be invoked from within the reusable workflows, not directly from plugin repos.

## Examples

The `examples/` folder contains minimal plugin-side GitHub Actions configurations that show how to consume these reusable workflows:

- `examples/basic-plugin-meta-json/` – minimal example of a `.github/plugin-meta.json` file.
- `examples/basic-dev-zip/` – minimal workflow that calls `create-plugin-dev-zip.yml` to build a dev zip.
- `examples/basic-deploy-instawp/` – minimal workflow that deploys a dev zip to InstaWP using `deploy-plugin-dev-zip-instawp.yml`.

Use these as starting points when wiring new plugin repositories to this CI.

## Versioning and usage

These workflows are designed to be consumed from other repositories using a fixed tag, for example:

```yaml
uses: krokedil/krokedil-wp-ci/.github/workflows/create-plugin-dev-zip.yml@v1
```

When updating this repository, bump or re-tag as appropriate and update plugin repositories to point to the desired version.