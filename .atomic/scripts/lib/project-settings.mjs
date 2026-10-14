import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SETTINGS_FILE } from "./profiles.mjs";

const HARNESS_IDS = ["cursor", "opencode", "codex", "pi", "agy", "claude"];

/**
 * @param {string} repoRoot
 * @param {{ strict?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function readProjectSettings(repoRoot, options = {}) {
  const path = join(repoRoot, PROJECT_SETTINGS_FILE);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (options.strict) {
      throw new Error(`${PROJECT_SETTINGS_FILE}: root must be a JSON object`);
    }
  } catch (err) {
    if (options.strict) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  return {};
}

/**
 * @param {string} repoRoot
 * @param {Record<string, unknown>} patch
 */
export function writeProjectSettings(repoRoot, patch) {
  const path = join(repoRoot, PROJECT_SETTINGS_FILE);
  let prior = {};
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        prior = raw;
      } else {
        throw new Error("root must be a JSON object");
      }
    } catch (err) {
      const backup = `${path}.invalid-${Date.now()}.bak`;
      copyFileSync(path, backup);
      throw new Error(
        `${PROJECT_SETTINGS_FILE}: invalid JSON (backup: ${backup}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
