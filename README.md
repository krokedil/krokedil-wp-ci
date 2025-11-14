# Krokedil WP CI

Reusable GitHub Actions reusable workflows for WordPress / WooCommerce plugin metadata, dev build zipping (optional S3 upload) and InstaWP deployment.

## Reusable Workflows

| Workflow | Purpose | Key Inputs | Key Outputs |
|----------|---------|------------|-------------|
| `get-plugin-meta.yml` | Read `.github/plugin-meta.json` to expose slug + JSON | (none) | `plugin_slug`, `plugin_meta_json` |
| `build-dev-zip.yml` | Create deterministic dev zip (+ optional S3 upload & playground summary) | `plugin_slug`, `aws_upload`, `zip_file_suffix`, `aws_region`, `plugin_meta_json?` | `zip_file_name`, `aws_s3_public_url`, `playground_minimal_url?` |
| `deploy-instawp.yml` | Simulate / perform InstaWP deployment using meta + zip | `plugin_meta_json`, `zip_file_name`, `instawp_api_token` (+ optional) | `instawp_site_id`, `instawp_site_url`, `instawp_site_created` |

All implementation logic lives in scripts under `scripts/` for a DRY codebase.

## Consumer Usage Example

```yaml
name: Plugin Dev Pipeline
on: [push]
jobs:
  meta:
    uses: krokedil/krokedil-wp-ci/.github/workflows/get-plugin-meta.yml@v1

  build_zip:
    needs: meta
    uses: krokedil/krokedil-wp-ci/.github/workflows/build-dev-zip.yml@v1
    with:
      plugin_slug: ${{ needs.meta.outputs.plugin_slug }}
      aws_upload: true
      zip_file_suffix: -test
    secrets:
      AWS_ACCESS_KEY_ID_KROKEDIL_PLUGIN_DEV_ZIP: ${{ secrets.AWS_ACCESS_KEY_ID_KROKEDIL_PLUGIN_DEV_ZIP }}
      AWS_SECRET_ACCESS_KEY_KROKEDIL_PLUGIN_DEV_ZIP: ${{ secrets.AWS_SECRET_ACCESS_KEY_KROKEDIL_PLUGIN_DEV_ZIP }}

  deploy_instawp:
    needs: [meta, build_zip]
    uses: krokedil/krokedil-wp-ci/.github/workflows/deploy-instawp.yml@v1
    with:
      plugin_meta_json: ${{ needs.meta.outputs.plugin_meta_json }}
      zip_file_name: ${{ needs.build_zip.outputs.zip_file_name }}
      aws_s3_public_url: ${{ needs.build_zip.outputs.aws_s3_public_url }}
      instawp_api_token: ${{ secrets.INSTAWP_API_TOKEN }}

  summary:
    runs-on: ubuntu-latest
    needs: deploy_instawp
    steps:
      - run: |
          echo "Zip: ${{ needs.build_zip.outputs.zip_file_name }}"
          echo "Site: ${{ needs.deploy_instawp.outputs.instawp_site_url }}"
```

## Outputs Reference

| Workflow | Output | Description |
|----------|--------|-------------|
| get-plugin-meta | plugin_slug | Plugin slug (folder name) |
| get-plugin-meta | plugin_meta_json | Compact plugin-meta.json content |
| build-dev-zip | zip_file_name | Dev zip base name (no .zip) |
| build-dev-zip | aws_s3_public_url | Public S3 object URL (if uploaded) |
| build-dev-zip | playground_minimal_url | WordPress Playground URL (requires `plugin_meta_json` + S3 upload) |
### Playground Summary (Optional)

To generate a WordPress Playground test link, pass `plugin_meta_json` (from `get-plugin-meta` workflow) when invoking `build-dev-zip.yml` and enable S3 upload. Example:

```yaml
  build_zip:
    needs: meta
    uses: krokedil/krokedil-wp-ci/.github/workflows/build-dev-zip.yml@v1
    with:
      plugin_slug: ${{ needs.meta.outputs.plugin_slug }}
      aws_upload: true
      plugin_meta_json: ${{ needs.meta.outputs.plugin_meta_json }}
    secrets:
      AWS_ACCESS_KEY_ID_KROKEDIL_PLUGIN_DEV_ZIP: ${{ secrets.AWS_ACCESS_KEY_ID_KROKEDIL_PLUGIN_DEV_ZIP }}
      AWS_SECRET_ACCESS_KEY_KROKEDIL_PLUGIN_DEV_ZIP: ${{ secrets.AWS_SECRET_ACCESS_KEY_KROKEDIL_PLUGIN_DEV_ZIP }}
```

The workflow will add a job summary with a Playground link and expose `playground_minimal_url` as an output.
| deploy-instawp | instawp_site_id | InstaWP site ID (simulated placeholder) |
| deploy-instawp | instawp_site_url | InstaWP site URL (simulated placeholder) |
| deploy-instawp | instawp_site_created | 'true' if new site created |

## Versioning & Tagging

Tag a stable release (e.g. `v1`) after changes:

```bash
git tag v1
git push origin v1
```

Consumers should pin to a tag or commit SHA for reproducibility.

## Development Notes

- Logic consolidated into `scripts/*.sh` and `scripts/deploy-instawp.js`.
- Removing composite actions reduces duplication; all reuse is at job level.
- To extend deployment logic, modify `scripts/deploy-instawp.js` (ensure it still writes outputs to `$GITHUB_OUTPUT`).

## Future Enhancements

- Replace simulated InstaWP deployment with real API integration.
- Add checksum output for the built zip (`zip_sha256`).
- Add matrix support (PHP / WordPress versions) in a separate workflow.
