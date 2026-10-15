import { existsSync } from "node:fs";
import { join } from "node:path";
import { readInstalledHarnesses } from "./project-settings.mjs";

export const HARNESS_IDS = ["cursor", "opencode", "codex", "pi", "agy", "claude", "hermes"];

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
const MARKERS = [
  [".cursor", "cursor"],
  [".opencode", "opencode"],
  ["opencode.json", "opencode"],
  [".codex", "codex"],
  [".pi", "pi"],
  [".agent", "agy"],
  [".gemini", "agy"],
  ["GEMINI.md", "agy"],
  [".claude", "claude"],
  ["CLAUDE.md", "claude"],
  [".hermes", "hermes"],
];

/** @param {string} targetDir */
export function detectHarnessMarkers(targetDir) {
  const found = new Set();
  for (const [path, harness] of MARKERS) {
    if (existsSync(join(targetDir, path))) {
      found.add(harness);
    }
  }
  return found;
}

export function detectHarnessesSync(targetDir) {
  const found = detectHarnessMarkers(targetDir);
  const saved = readInstalledHarnesses(targetDir);
  if (saved?.length) {
    for (const h of saved) found.add(h);
    return found;
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
    const saved = readInstalledHarnesses(targetDir);
    const detected = saved?.length
      ? new Set(saved)
      : detectHarnessesSync(targetDir);
    for (const h of detected) {
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
