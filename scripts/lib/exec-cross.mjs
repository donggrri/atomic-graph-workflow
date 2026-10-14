import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const WIN = process.platform === "win32";
const PATHEXT = process.env.PATHEXT
  ? process.env.PATHEXT.split(delimiter).map((e) => e.toLowerCase())
  : [".exe", ".cmd", ".bat", ".com"];

/**
 * Quote one argument for `cmd.exe /d /s /c "…"` (inside the outer quoted command).
 * Metacharacters (&|<>^) stay literal inside double quotes; only `"` and `%` are escaped.
 * @param {string} arg
 */
export function quoteCmdArgument(arg) {
  let out = '"';
  for (const ch of String(arg)) {
    if (ch === '"') {
      out += '""';
    } else if (ch === "%") {
      out += "%^%";
    } else {
      out += ch;
    }
  }
  out += '"';
  return out;
}

/**
 * @param {string} executable
 * @param {string[]} args
 */
export function buildCmdExeCommandLine(executable, args) {
  return [quoteCmdArgument(executable), ...args.map((a) => quoteCmdArgument(a))].join(" ");
}

/**
 * @param {string} executable
 * @param {string[]} args
 */
export function getCmdExeSpawnInvocation(executable, args) {
  const commandLine = buildCmdExeCommandLine(executable, args);
  return {
    file: "cmd.exe",
    argv: ["/d", "/s", "/c", `"${commandLine}"`],
    options: { shell: false, windowsVerbatimArguments: true },
  };
}

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
 * @param {typeof spawn} spawnFn
 * @param {string} file
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} [options]
 */
export function spawnCliWith(spawnFn, file, args, options = {}) {
  if (needsShellSpawn(file)) {
    const inv = getCmdExeSpawnInvocation(file, args);
    return spawnFn(inv.file, inv.argv, { ...options, ...inv.options });
  }
  return spawnFn(file, args, { ...options, shell: false });
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} [options]
 */
export function spawnCli(file, args, options = {}) {
  return spawnCliWith(spawn, file, args, options);
}
