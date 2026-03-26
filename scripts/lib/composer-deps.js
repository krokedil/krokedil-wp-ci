// composer-deps.js
// ---------------------------------------------------------------------------
// Purpose
//   Extract Krokedil composer dependencies from a combined JSON file that
//   contains parsed composer-dependencies.lock contents for all plugins.
//
// Primary input source
//   - composer-dependencies-all-plugins.json
//     A JSON file keyed by plugin slug, where each value is the parsed
//     content of that plugin's composer-dependencies.lock file. Generated
//     by the Playground blueprint step that scans all plugin directories.
//
// Outputs
//   - extractKrokedilComposerDeps(): structured list of Krokedil packages per plugin
//   - buildComposerDepsAnnotation(): { annotation } for Playwright report
//
// Failure modes
//   - Invalid JSON / unexpected shape: returns empty array and never throws.

/**
 * @typedef {Object} KrokedilComposerDepsForPlugin
 * @property {string} pluginSlug
 * @property {Array<{ name: string, version: string }>} packages
 */

/**
 * Extract Krokedil packages (name starts with "krokedil/") from a combined
 * lock data file containing all plugins' composer-dependencies.lock contents.
 *
 * @param {string} allPluginsJsonText - JSON string of { pluginSlug: composerLockContent }
 * @returns {KrokedilComposerDepsForPlugin[]}
 */
function extractKrokedilComposerDeps(allPluginsJsonText) {
  try {
    const allPlugins = JSON.parse(allPluginsJsonText);
    if (!allPlugins || typeof allPlugins !== "object") return [];

    /** @type {KrokedilComposerDepsForPlugin[]} */
    const results = [];

    for (const [slug, lock] of Object.entries(allPlugins)) {
      if (!lock || typeof lock !== "object") continue;

      const packages = Array.isArray(lock.packages) ? lock.packages : [];
      const krokedilPkgs = packages
        .filter(
          (pkg) =>
            pkg &&
            typeof pkg.name === "string" &&
            pkg.name.startsWith("krokedil/"),
        )
        .map((pkg) => ({
          name: pkg.name,
          version: typeof pkg.version === "string" ? pkg.version : "(unknown)",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (krokedilPkgs.length) {
        results.push({ pluginSlug: slug, packages: krokedilPkgs });
      }
    }

    return results.sort((a, b) => a.pluginSlug.localeCompare(b.pluginSlug));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Annotation builder

/**
 * Format Krokedil composer deps into a Playwright annotation description.
 *
 * @param {KrokedilComposerDepsForPlugin[]} deps
 * @returns {string}
 */
function formatComposerDepsAnnotationText(deps) {
  const lines = ["Krokedil composer dependencies:"];

  for (const { pluginSlug, packages } of deps) {
    lines.push("");
    lines.push(`${pluginSlug}:`);
    for (const pkg of packages) {
      lines.push(`- ${pkg.name}: ${pkg.version}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Build a Playwright annotation for Krokedil composer dependencies.
 *
 * @param {string} allPluginsJsonText - JSON string of { pluginSlug: composerLockContent }
 * @returns {{ annotation: { type: string, description: string }, deps: KrokedilComposerDepsForPlugin[] } | null}
 */
function buildComposerDepsAnnotation(allPluginsJsonText) {
  const deps = extractKrokedilComposerDeps(allPluginsJsonText);
  if (!deps.length) return null;

  const description = formatComposerDepsAnnotationText(deps);

  return {
    annotation: {
      type: "composer-krokedil-deps",
      description,
    },
    deps,
  };
}

module.exports = {
  extractKrokedilComposerDeps,
  buildComposerDepsAnnotation,
};
