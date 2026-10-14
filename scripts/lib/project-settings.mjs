import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SETTINGS_FILE } from "./profiles.mjs";

const HARNESS_IDS = ["cursor", "opencode", "codex", "pi", "agy", "claude"];

/**
 * @param {string} repoRoot
 * @returns {Record<string, unknown>}
 */
export function readProjectSettings(repoRoot) {
  const path = join(repoRoot, PROJECT_SETTINGS_FILE);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch {
    // ignore
  }
  return {};
}

/**
 * @param {string} repoRoot
 * @param {Record<string, unknown>} patch
 */
export function writeProjectSettings(repoRoot, patch) {
  const path = join(repoRoot, PROJECT_SETTINGS_FILE);
  const prior = readProjectSettings(repoRoot);
  const next = { ...prior, ...patch };
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

/**
 * @param {string} repoRoot
 * @returns {string[] | null}
 */
export function readInstalledHarnesses(repoRoot) {
  const data = readProjectSettings(repoRoot);
  if (!Array.isArray(data.installedHarnesses)) return null;
  return data.installedHarnesses.filter((h) => typeof h === "string" && HARNESS_IDS.includes(h));
}

/**
 * @param {string} repoRoot
 * @param {string[]} harnesses
 */
export function writeInstalledHarnesses(repoRoot, harnesses) {
  const list = [...new Set(harnesses)].filter((h) => HARNESS_IDS.includes(h)).sort();
  writeProjectSettings(repoRoot, { installedHarnesses: list });
  return list;
}
