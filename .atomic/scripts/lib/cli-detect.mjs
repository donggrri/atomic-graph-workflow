import { firstExecutable } from "./exec-cross.mjs";

/**
 * @param {string[]} names
 * @returns {boolean}
 */
export function binOnPath(names) {
  return firstExecutable(names) != null;
}

/**
 * @param {string[]} names
 * @returns {string | null}
 */
export function resolveBin(names) {
  return firstExecutable(names);
}

/** @typedef {{ id: string, label: string, bins: string[], installed: boolean }} HarnessCliInfo */

/** @returns {HarnessCliInfo[]} */
export function detectHarnessClis() {
  const specs = [
    { id: "cursor", label: "Cursor (CLI/에디터)", bins: ["cursor-agent", "agent"] },
    { id: "agy", label: "AGY (Antigravity)", bins: ["agy"] },
    { id: "opencode", label: "opencode", bins: ["opencode"] },
    { id: "codex", label: "Codex", bins: ["codex"] },
    { id: "pi", label: "Pi", bins: ["pi"] },
    { id: "claude", label: "Claude Code", bins: ["claude"] },
  ];
  return specs.map((s) => ({
    ...s,
    installed: binOnPath(s.bins),
  }));
}

/** @returns {boolean} */
export function detectGitRepo(cwd) {
  const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
  });
  return res.status === 0 && res.stdout.trim() === "true";
}
