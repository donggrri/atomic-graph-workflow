#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installAtomicRuntime, listRuntimeScriptRelPaths } from "./lib/atomic-runtime.mjs";

export const ATOMIC_SCRIPT_DIR = join(".atomic", "scripts");

/** @deprecated */
export const BUNDLED_SCRIPT_DIR = ATOMIC_SCRIPT_DIR;

/** @deprecated use listRuntimeScriptRelPaths */
export const BUNDLED_SCRIPTS = ["work-status.mjs", "run-done.mjs", "memory.mjs"];

/**
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export async function bundledScriptDiffs(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const scriptsRoot = join(cwd, "scripts");
  const mismatches = [];
  const rels = await listRuntimeScriptRelPaths(scriptsRoot);
  for (const rel of rels) {
    const rootScript = join(scriptsRoot, rel);
    const bundledScript = join(cwd, ATOMIC_SCRIPT_DIR, rel);
    if (!existsSync(rootScript)) {
      mismatches.push(`missing scripts/${rel}`);
      continue;
    }
    if (!existsSync(bundledScript)) {
      mismatches.push(`missing ${ATOMIC_SCRIPT_DIR}/${rel}`);
      continue;
    }
    const [rootText, bundledText] = await Promise.all([
      readFile(rootScript, "utf8"),
      readFile(bundledScript, "utf8"),
    ]);
    if (rootText !== bundledText) mismatches.push(rel);
  }
  return mismatches;
}

/**
 * @param {{ cwd?: string, force?: boolean }} [options]
 */
export async function syncBundledScripts(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const { copied } = await installAtomicRuntime(cwd, cwd, { force: true });
  return copied.map((p) => p.replace(join(cwd, ATOMIC_SCRIPT_DIR) + "/", ""));
}

function usage() {
  return `Usage: node scripts/sync-bundled.mjs [--check]
Copies runtime scripts/ tree to ${ATOMIC_SCRIPT_DIR}/.
--check exits 1 when copies differ.`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  if (args.some((arg) => arg !== "--check")) {
    console.error(usage());
    process.exit(2);
  }
  const check = args.includes("--check");
  const cwd = process.cwd();
  if (!check) {
    const copied = await syncBundledScripts({ cwd });
    console.log(`synced ${copied.length} file(s) to ${ATOMIC_SCRIPT_DIR}`);
  }
  const mismatches = await bundledScriptDiffs({ cwd });
  if (mismatches.length > 0) {
    for (const item of mismatches) console.error(item);
    process.exit(1);
  }
  if (check) console.log("ok");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
