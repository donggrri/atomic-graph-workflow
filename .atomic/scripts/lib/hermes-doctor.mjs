import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveBin } from "./cli-detect.mjs";

const SECRET_RE = /(key|token|secret)/i;

/**
 * @param {string} line
 */
export function lineLooksSensitive(line) {
  return SECRET_RE.test(line);
}

/**
 * @param {string} cwd
 * @returns {{ versionOk: boolean, statusOk: boolean, problems: string[], warnings: string[] }}
 */
export function checkHermesCli(cwd) {
  const problems = [];
  const warnings = [];
  const bin = resolveBin(["hermes"]);
  if (!bin) {
    warnings.push("hermes CLI not on PATH");
    return { versionOk: false, statusOk: false, problems, warnings };
  }

  const ver = spawnSync(bin, ["--version"], { cwd, encoding: "utf8" });
  const versionOk = ver.status === 0;
  if (!versionOk) {
    problems.push("hermes --version failed");
  }

  const status = spawnSync(bin, ["status"], { cwd, encoding: "utf8" });
  const statusOk = status.status === 0;
  if (!statusOk) {
    problems.push("hermes status failed");
  }

  const combined = `${status.stdout ?? ""}\n${status.stderr ?? ""}`;
  for (const line of combined.split(/\r?\n/)) {
    if (line.trim() && lineLooksSensitive(line)) {
      problems.push("hermes status output contained sensitive fields (not shown)");
      break;
    }
  }

  return { versionOk, statusOk, problems, warnings };
}

/**
 * @param {string} cwd
 * @returns {string[]}
 */
export function hermesDoctorWarnings(cwd) {
  const out = [];
  if (existsSync(join(cwd, ".hermes.md"))) {
    out.push(".hermes.md exists and shadows AGENTS.md — remove it or merge into AGENTS.md");
  }
  out.push("run `hermes skills trust` in the repo if skills are not loaded");
  return out;
}
