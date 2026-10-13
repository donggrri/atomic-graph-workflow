import { readdir, stat, cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

/** Dev-only scripts at package root; not copied to target `.atomic/scripts/`. */
export const PACKAGE_ONLY_SCRIPTS = new Set([
  "check-agents.mjs",
]);

/**
 * @param {string} scriptsRoot package `scripts/` directory
 * @returns {Promise<string[]>} paths relative to scriptsRoot
 */
export async function listRuntimeScriptRelPaths(scriptsRoot) {
  const out = [];
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const full = join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full);
        continue;
      }
      const rel = relative(scriptsRoot, full);
      if (rel.startsWith("lib/") || rel.endsWith(".mjs") || rel.endsWith(".sh") || rel.endsWith(".ps1")) {
        if (!PACKAGE_ONLY_SCRIPTS.has(name)) {
          out.push(rel);
        }
      }
    }
  }
  await walk(scriptsRoot);
  return out.sort();
}

/**
 * @param {string} packageRoot
 * @param {string} targetRoot
 * @param {{ force?: boolean }} [options]
 */
export async function installAtomicRuntime(packageRoot, targetRoot, options = {}) {
  const force = !!options.force;
  const scriptsSrc = join(packageRoot, "scripts");
  const destRoot = join(targetRoot, ".atomic", "scripts");
  const rels = await listRuntimeScriptRelPaths(scriptsSrc);
  const copied = [];
  const skipped = [];

  for (const rel of rels) {
    const src = join(scriptsSrc, rel);
    const dest = join(destRoot, rel);
    if (existsSync(dest) && !force) {
      skipped.push(dest);
      continue;
    }
    await mkdir(join(dest, ".."), { recursive: true });
    await cp(src, dest, { force: true });
    copied.push(dest);
  }

  const graphSrc = join(packageRoot, "graph.yaml");
  const graphDest = join(targetRoot, ".atomic", "graph.yaml");
  if (existsSync(graphSrc)) {
    if (!existsSync(graphDest) || force) {
      await mkdir(join(graphDest, ".."), { recursive: true });
      await cp(graphSrc, graphDest, { force: true });
      copied.push(graphDest);
    } else {
      skipped.push(graphDest);
    }
  }

  return { copied, skipped, destRoot };
}
