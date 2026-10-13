import { existsSync } from "node:fs";
import { join } from "node:path";

export const HARNESS_IDS = ["cursor", "opencode", "codex", "pi", "agy", "claude"];

/** @param {string} raw */
export function parseHarnessSpec(raw) {
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error("empty --harness value");
  }
  return parts;
}

/**
 * @param {string[]} parts
 * @param {{ withClaude?: boolean }} options
 * @returns {Set<string>}
 */
export function resolveHarnessSet(parts, options = {}) {
  const withClaude = !!options.withClaude;
  const set = new Set();

  for (const part of parts) {
    if (part === "auto" || part === "all") {
      continue;
    }
    if (!HARNESS_IDS.includes(part)) {
      throw new Error(`unknown harness: ${part}`);
    }
    set.add(part);
  }

  return set;
}

/**
 * @param {string} targetDir
 * @returns {Set<string>}
 */
export function detectHarnessesSync(targetDir) {
  const found = new Set();
  const markers = [
    [".cursor", "cursor"],
    [".opencode", "opencode"],
    ["opencode.json", "opencode"],
    [".codex", "codex"],
    [".pi", "pi"],
    [".agents", "agy"],
    [".agent", "agy"],
    ["GEMINI.md", "agy"],
    [".claude", "claude"],
    ["CLAUDE.md", "claude"],
  ];
  for (const [path, harness] of markers) {
    if (existsSync(join(targetDir, path))) {
      found.add(harness);
    }
  }
  if (found.size === 0) {
    found.add("cursor");
  }
  return found;
}

/**
 * @param {string[]} parts
 * @param {string} targetDir
 * @param {{ withClaude?: boolean }} options
 */
export function resolveHarnesses(parts, targetDir, options = {}) {
  const withClaude = !!options.withClaude;
  const set = resolveHarnessSet(parts, { withClaude });

  if (parts.includes("auto")) {
    for (const h of detectHarnessesSync(targetDir)) {
      if (h === "claude" && !withClaude) continue;
      set.add(h);
    }
  }

  if (parts.includes("all")) {
    for (const h of HARNESS_IDS) {
      if (h === "claude" && !withClaude) continue;
      set.add(h);
    }
  }

  if (set.size === 0) {
    set.add("cursor");
  }

  if (!withClaude) {
    set.delete("claude");
  }

  return set;
}
