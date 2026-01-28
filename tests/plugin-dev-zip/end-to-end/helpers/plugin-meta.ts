/**
 * E2E helper: plugin meta access at module scope
 * ---------------------------------------------------------------------------
 * Purpose
 *   Provide access to plugin meta (especially `slug`) in places where Playwright
 *   fixtures are not available (e.g. `test.use(...)` at module evaluation time).
 *
 * Inputs
 *   - PLUGIN_META_JSON (env var): JSON string containing at least { slug }.
 *   - Fallback: .github/plugin-meta.json relative to process.cwd().
 *
 * Failure modes
 *   - Throws with a clear error if slug is missing/invalid.
 */

import fs from "node:fs";
import path from "node:path";

type PluginMeta = {
  slug?: string;
};

export function readPluginSlugFromEnvOrFile(): string {
  const raw = process.env.PLUGIN_META_JSON;
  if (raw) {
    const meta = JSON.parse(raw) as PluginMeta;
    if (typeof meta?.slug === "string" && meta.slug.trim()) return meta.slug;
    throw new Error("PLUGIN_META_JSON.slug is required for e2e tests");
  }

  const metaPath = path.resolve(process.cwd(), ".github", "plugin-meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as PluginMeta;
    if (typeof meta?.slug === "string" && meta.slug.trim()) return meta.slug;
    throw new Error(`Missing or invalid slug in ${metaPath}`);
  }

  throw new Error(
    "Missing PLUGIN_META_JSON env var (JSON string) and could not find .github/plugin-meta.json",
  );
}
