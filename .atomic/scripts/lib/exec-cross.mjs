import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const WIN = process.platform === "win32";
const PATHEXT = process.env.PATHEXT
  ? process.env.PATHEXT.split(delimiter).map((e) => e.toLowerCase())
  : [".exe", ".cmd", ".bat", ".com"];

/**
 * @param {string} name
 * @returns {string | null}
 */
export function resolveExecutableOnPath(name) {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const bases = WIN ? [name, ...PATHEXT.map((ext) => `${name}${ext}`)] : [name];
  for (const dir of dirs) {
    for (const base of bases) {
      const full = join(dir, base);
      if (existsSync(full)) return full;
    }
  }
  if (WIN) {
    const res = spawnSync("where.exe", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (res.status === 0 && res.stdout) {
      const first = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      if (first && existsSync(first)) return first;
    }
  }
  return null;
}

/**
 * @param {string[]} names
 * @returns {string | null}
 */
export function firstExecutable(names) {
  for (const name of names) {
    const hit = resolveExecutableOnPath(name);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {string} file
 * @returns {boolean}
 */
export function needsShellSpawn(file) {
  return WIN && /\.(cmd|bat)$/i.test(file);
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} [options]
 */
export function spawnCli(file, args, options = {}) {
  if (needsShellSpawn(file)) {
    return spawn(file, args, { ...options, shell: true, windowsVerbatimArguments: true });
  }
  return spawn(file, args, { ...options, shell: false });
}
