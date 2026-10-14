import { spawnSync } from "node:child_process";

/**
 * @param {string[]} names
 * @returns {boolean}
 */
export function binOnPath(names) {
  for (const name of names) {
    const res = spawnSync("sh", ["-c", `command -v ${name} >/dev/null 2>&1`], {
      stdio: "ignore",
    });
    if (res.status === 0) return true;
  }
  return false;
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
