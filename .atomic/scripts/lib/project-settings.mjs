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
 * @param {{ dropKeys?: string[] }} [options] keys to remove from the stored settings
 */
export function writeProjectSettings(repoRoot, patch, options = {}) {
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
  for (const key of options.dropKeys ?? []) delete next[key];
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
 * Normalizes a `docsRoot` setting value. Returns a trimmed non-empty string
 * or null when unset. Throws with a clear reason when the type is invalid.
 * Relative values resolve against repoRoot; absolute values are used as-is.
 * @param {unknown} value
 * @param {string} label
 */
export function parseDocsRoot(value, label = "project settings") {
  if (value == null || value === "") return { ok: true, docsRoot: null };
  if (typeof value !== "string") {
    return { ok: false, reason: `${label}: docsRoot must be a string` };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, docsRoot: null };
  if (trimmed.includes("\0")) {
    return { ok: false, reason: `${label}: docsRoot must not contain null bytes` };
  }
  return { ok: true, docsRoot: trimmed };
}

/**
 * @param {string} repoRoot
 * @returns {string | null} trimmed docsRoot or null when unset/invalid
 */
export function readDocsRoot(repoRoot) {
  const data = readProjectSettings(repoRoot);
  const parsed = parseDocsRoot(data.docsRoot);
  return parsed.ok ? parsed.docsRoot : null;
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
