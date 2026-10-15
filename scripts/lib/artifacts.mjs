import { isAbsolute } from "node:path";

export const DEFAULT_REPO_ARTIFACTS_DIR = "specs";

/**
 * One-line note recommending that an in-repo docs dir is committed.
 * @param {string} [dir]
 * @returns {string}
 */
export function artifactsRepoNote(dir) {
  const d =
    typeof dir === "string" && dir.trim() ? dir.trim().replace(/[\\/]+$/, "") : DEFAULT_REPO_ARTIFACTS_DIR;
  return `artifacts: ${d}/ is inside the repo; commit it with your code (do not add it to .gitignore)`;
}

function isValidRepoDir(dir) {
  if (typeof dir !== "string") return false;
  const t = dir.trim();
  if (!t) return false;
  if (isAbsolute(t)) return false;
  if (/^[A-Za-z]:[\\/]/.test(t)) return false;
  const segments = t.split(/[\\/]+/);
  if (segments.includes("..")) return false;
  if (segments.includes("")) return false;
  return true;
}

/**
 * True for absolute or ~-leading docsRoot values. Such values are only
 * allowed in global settings, never in the project
 * `.atomic-workflow.json` file (which must stay repo-relative).
 * @param {unknown} value
 */
export function isAbsoluteLikeDocsRoot(value) {
  const t = typeof value === "string" ? value.trim() : "";
  if (!t) return false;
  return isAbsolute(t) || t.startsWith("~") || /^[A-Za-z]:[\\/]/.test(t);
}

/**
 * Error text used when an absolute docsRoot is aimed at the project file.
 * Points at global settings instead.
 * @param {unknown} value
 */
export function absoluteDocsRootReason(value) {
  const t = typeof value === "string" ? value.trim() : String(value ?? "");
  return `docsRoot: absolute paths are only allowed in global settings (~/.atomic-workflow/settings.json "docsRoot"); the project file .atomic-workflow.json must use a repo-relative path (e.g. "specs") or be unset (got "${t}")`;
}

/**
 * Parse the `--artifacts <home|repo[:dir]|custom:/abs/path>` flag value.
 * Returns a docsRoot value: home -> null (unset), repo -> relative dir
 * (default "specs"), custom -> absolute path.
 * @param {string} value
 * @returns {{ ok: true, docsRoot: string | null } | { ok: false, reason: string }}
 */
export function parseArtifactsFlag(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return {
      ok: false,
      reason: `unknown artifacts location "" (expected home, repo[:dir], or custom:/abs/path)`,
    };
  }
  if (raw === "home") return { ok: true, docsRoot: null };
  if (raw === "repo") return { ok: true, docsRoot: DEFAULT_REPO_ARTIFACTS_DIR };
  if (raw.startsWith("repo:")) {
    const dir = raw.slice("repo:".length).trim();
    if (!dir) {
      return { ok: true, docsRoot: DEFAULT_REPO_ARTIFACTS_DIR };
    }
    if (!isValidRepoDir(dir)) {
      return {
        ok: false,
        reason: `docsRoot must be a relative path inside the repository (got "${dir}")`,
      };
    }
    return { ok: true, docsRoot: dir };
  }
  if (raw.startsWith("custom:")) {
    const dir = raw.slice("custom:".length).trim();
    if (!dir || !isAbsolute(dir)) {
      return {
        ok: false,
        reason: `docsRoot must be an absolute path for custom location (got "${dir}")`,
      };
    }
    return { ok: true, docsRoot: dir };
  }
  return {
    ok: false,
    reason: `unknown artifacts location "${raw}" (expected home, repo[:dir], or custom:/abs/path)`,
  };
}

/**
 * Map a deprecated `artifacts` block {location, dir} to a docsRoot value.
 * home (or missing) -> null, repo -> relative dir (default "specs"),
 * custom -> absolute path. Returns null for missing/invalid blocks.
 * @param {unknown} obj
 * @returns {string | null}
 */
export function docsRootFromLegacyArtifacts(obj) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const block = /** @type {Record<string, unknown>} */ (obj);
  const locationRaw = block.location;
  const location =
    locationRaw == null || locationRaw === "" ? "home" : String(locationRaw).trim() || "home";
  if (location === "home") return null;
  if (location === "repo") {
    const dirRaw = block.dir;
    if (dirRaw == null || dirRaw === "") return DEFAULT_REPO_ARTIFACTS_DIR;
    if (typeof dirRaw !== "string") return null;
    const dir = dirRaw.trim();
    if (!dir) return DEFAULT_REPO_ARTIFACTS_DIR;
    if (!isValidRepoDir(dir)) return null;
    return dir;
  }
  if (location === "custom") {
    const dirRaw = block.dir;
    if (typeof dirRaw !== "string") return null;
    const dir = dirRaw.trim();
    if (!dir || !isAbsolute(dir)) return null;
    return dir;
  }
  return null;
}
