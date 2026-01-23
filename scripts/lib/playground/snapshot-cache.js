// playground/snapshot-cache.js
// ---------------------------------------------------------------------------
// Purpose
//   Build and cache WordPress Playground snapshots for reuse across tests.
//
// Inputs
//   - pluginDir: string (path to the plugin folder to mount)
//   - snapshotBlueprint: object (Playground blueprint JSON object)
//   - buildSnapshotZip: async function that produces a snapshot zip
//
// Behavior
//   - Computes a cache key based on the snapshot blueprint + plugin directory hash.
//   - Uses a lock file to make snapshot builds safe with parallel workers.
//   - Extracts the snapshot zip to <cacheDir>/snapshot and ensures wp-config.php exists.
//
// Failure modes
//   - Missing/unreadable pluginDir throws.
//   - Snapshot build failures throw (unless the zip exists anyway).
//   - Extraction failures throw.

const {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { resolve, relative } = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

function shouldIgnoreDirEntry(name) {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === ".github" ||
    name === ".DS_Store"
  );
}

function hashFileForCache({ filePath, maxInlineBytes = 512 * 1024 }) {
  const st = statSync(filePath);

  const h = createHash("sha256");
  h.update(String(st.size));
  h.update("\0");
  h.update(String(st.mtimeMs));
  h.update("\0");

  if (st.size <= maxInlineBytes) {
    h.update(readFileSync(filePath));
  }

  return h.digest("hex");
}

function hashDirectoryForCache(options) {
  const { dirPath } = options;

  const root = resolve(dirPath);
  if (!existsSync(root)) {
    throw new Error(`Plugin directory does not exist: ${root}`);
  }

  const entries = [];

  /** @param {string} current */
  function walk(current) {
    const names = readdirSync(current);
    names.sort();

    for (const name of names) {
      if (shouldIgnoreDirEntry(name)) continue;

      const fullPath = resolve(current, name);
      let st;
      try {
        st = statSync(fullPath);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile()) {
        entries.push(fullPath);
      }
    }
  }

  walk(root);

  const h = createHash("sha256");
  h.update("dir-hash-v1\n");

  for (const fullPath of entries) {
    const rel = relative(root, fullPath).replace(/\\/g, "/");
    h.update(rel);
    h.update("\0");
    h.update(hashFileForCache({ filePath: fullPath }));
    h.update("\n");
  }

  return h.digest("hex");
}

function computeSnapshotCacheKey(options) {
  const { pluginSlug, snapshotBlueprintJson, pluginDir } = options;

  const pluginHash = hashDirectoryForCache({ dirPath: pluginDir });

  const seedParts = [
    "playground-snapshot-v2",
    pluginSlug,
    pluginHash,
    snapshotBlueprintJson,
  ];

  return createHash("sha256").update(seedParts.join("\n")).digest("hex");
}

async function extractZip({ zipPath, outDir, unzip }) {
  mkdirSync(outDir, { recursive: true });

  if (typeof unzip === "function") {
    await unzip({ zipPath, outDir });
    return;
  }

  // Default: use system unzip (available on macOS and most Linux distros).
  execFileSync("unzip", ["-q", zipPath, "-d", outDir], { stdio: "ignore" });
}

async function ensureSnapshotExtracted(options) {
  const {
    cacheDir,
    pluginAutoMount,
    snapshotBlueprint,
    buildSnapshotZip,
    unzip,
    lockTimeoutMs = 10 * 60 * 1000,
  } = options;

  mkdirSync(cacheDir, { recursive: true });

  const zipPath = resolve(cacheDir, "snapshot.zip");
  const snapshotDir = resolve(cacheDir, "snapshot");
  const wordpressDir = resolve(snapshotDir, "wordpress");
  const wpConfigSamplePath = resolve(wordpressDir, "wp-config-sample.php");
  const wpConfigPath = resolve(wordpressDir, "wp-config.php");
  const markerPath = resolve(cacheDir, "built.txt");

  const looksReady =
    existsSync(resolve(wordpressDir, "wp-admin")) && existsSync(wpConfigPath);
  if (existsSync(markerPath) && looksReady) {
    return { wordpressDir, snapshotDir, markerPath };
  }

  const lockPath = resolve(cacheDir, ".build.lock");
  let lockFd;

  const startedAt = Date.now();

  while (lockFd === undefined) {
    try {
      lockFd = openSync(lockPath, "wx");
    } catch {
      const readyNow =
        existsSync(markerPath) &&
        existsSync(resolve(wordpressDir, "wp-admin")) &&
        existsSync(wpConfigPath);
      if (readyNow) return { wordpressDir, snapshotDir, markerPath };

      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(
          `Timed out waiting for snapshot build lock: ${lockPath}`,
        );
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  try {
    const readyNow =
      existsSync(markerPath) &&
      existsSync(resolve(wordpressDir, "wp-admin")) &&
      existsSync(wpConfigPath);
    if (readyNow) return { wordpressDir, snapshotDir, markerPath };

    rmSync(snapshotDir, { recursive: true, force: true });
    mkdirSync(snapshotDir, { recursive: true });

    if (typeof buildSnapshotZip !== "function") {
      throw new Error(
        "ensureSnapshotExtracted requires buildSnapshotZip(...) function",
      );
    }

    try {
      await buildSnapshotZip({
        outfile: zipPath,
        blueprint: snapshotBlueprint,
        autoMount: pluginAutoMount,
        quiet: true,
      });
    } catch (error) {
      if (!existsSync(zipPath)) throw error;
    }

    await extractZip({ zipPath, outDir: snapshotDir, unzip });

    if (!existsSync(wpConfigPath) && existsSync(wpConfigSamplePath)) {
      copyFileSync(wpConfigSamplePath, wpConfigPath);
    }

    if (existsSync(zipPath)) {
      unlinkSync(zipPath);
    }

    writeFileSync(markerPath, `Built at ${new Date().toISOString()}\n`);

    return { wordpressDir, snapshotDir, markerPath };
  } finally {
    try {
      if (lockFd !== undefined) closeSync(lockFd);
      rmSync(lockPath, { force: true });
    } catch {
      // ignore
    }
  }
}

function copyWordpressFromSnapshot(options) {
  const { wordpressTemplateDir, perTestWordpressDir } = options;

  rmSync(perTestWordpressDir, { recursive: true, force: true });
  mkdirSync(perTestWordpressDir, { recursive: true });

  // Node 20: fs.cpSync is available.
  require("node:fs").cpSync(wordpressTemplateDir, perTestWordpressDir, {
    recursive: true,
  });
}

module.exports = {
  computeSnapshotCacheKey,
  ensureSnapshotExtracted,
  copyWordpressFromSnapshot,
  hashDirectoryForCache,
};
