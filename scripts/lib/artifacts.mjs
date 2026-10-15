import { isAbsolute, join, resolve, sep } from "node:path";

export const ARTIFACT_LOCATIONS = ["home", "repo", "custom"];
export const DEFAULT_REPO_ARTIFACTS_DIR = "specs";

/**
 * One-line note recommending that an in-repo artifacts dir is committed.
 * @param {string} [dir]
 * @returns {string}
 */
export function artifactsRepoNote(dir) {
  const d =
    typeof dir === "string" && dir.trim() ? dir.trim().replace(/[\\/]+$/, "") : DEFAULT_REPO_ARTIFACTS_DIR;
  return `artifacts: ${d}/ is inside the repo; commit it with your code (do not add it to .gitignore)`;
}

/**
 * Normalize the artifacts settings block from parsed JSON.
 * @param {unknown} block
 * @param {string} [label]
 * @returns {{ ok: true, artifacts: { location: string, dir?: string } | null } | { ok: false, reason: string }}
 */
export function parseArtifactsBlock(block, label = "project settings") {
  if (block == null) return { ok: true, artifacts: null };
  if (typeof block !== "object" || Array.isArray(block)) {
    return { ok: false, reason: `${label}: artifacts must be an object` };
  }
  const locationRaw = block.location;
  const location = locationRaw == null || locationRaw === "" ? "home" : String(locationRaw).trim() || "home";
  if (!ARTIFACT_LOCATIONS.includes(location)) {
    return {
      ok: false,
      reason: `${label}: unknown artifacts.location "${String(locationRaw)}" (allowed: home, repo, custom)`,
    };
  }
  const dirRaw = block.dir;
  if (dirRaw == null || dirRaw === "") {
    if (location === "custom") {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
    if (location === "home") return { ok: true, artifacts: { location } };
    return { ok: true, artifacts: { location } };
  }
  if (typeof dirRaw !== "string") {
    if (location === "custom") {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
    if (location === "repo") {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${String(dirRaw)}")`,
      };
    }
    return { ok: true, artifacts: { location } };
  }
  const dir = dirRaw.trim() || (location === "repo" ? "" : dirRaw);
  if (!dir) {
    if (location === "custom") {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
    return { ok: true, artifacts: { location } };
  }
  if (location === "repo") {
    if (isAbsolute(dir)) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${dir}")`,
      };
    }
    const segments = dir.split(/[\\/]+/);
    if (segments.includes("..")) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${dir}")`,
      };
    }
  }
  if (location === "custom") {
    if (!isAbsolute(dir)) {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
  }
  return { ok: true, artifacts: { location, dir } };
}

/**
 * Parse the `--artifacts <home|repo[:dir]|custom:/abs/path>` flag value.
 * @param {string} value
 * @returns {{ ok: true, artifacts: { location: string, dir?: string } } | { ok: false, reason: string }}
 */
export function parseArtifactsFlag(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return {
      ok: false,
      reason: `unknown artifacts location "" (expected home, repo[:dir], or custom:/abs/path)`,
    };
  }
  if (raw === "home") return { ok: true, artifacts: { location: "home" } };
  if (raw === "repo") return { ok: true, artifacts: { location: "repo", dir: DEFAULT_REPO_ARTIFACTS_DIR } };
  if (raw.startsWith("repo:")) {
    const dir = raw.slice("repo:".length).trim();
    if (!dir) {
      return { ok: true, artifacts: { location: "repo", dir: DEFAULT_REPO_ARTIFACTS_DIR } };
    }
    if (isAbsolute(dir)) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${dir}")`,
      };
    }
    const segments = dir.split(/[\\/]+/);
    if (segments.includes("..")) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${dir}")`,
      };
    }
    return { ok: true, artifacts: { location: "repo", dir } };
  }
  if (raw.startsWith("custom:")) {
    const dir = raw.slice("custom:".length).trim();
    if (!dir || !isAbsolute(dir)) {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
    return { ok: true, artifacts: { location: "custom", dir } };
  }
  return {
    ok: false,
    reason: `unknown artifacts location "${raw}" (expected home, repo[:dir], or custom:/abs/path)`,
  };
}

/**
 * Derive a short repo id when the caller does not provide one.
 * Mirrors getShortRepo in work-status.mjs without importing it.
 * @param {string} repoRoot
 */
function defaultShortRepo(repoRoot) {
  if (!repoRoot) return "unknown-repo";
  const base = String(repoRoot).split(/[\\/]/).filter(Boolean).pop() || "";
  let normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length > 24) {
    normalized = normalized.slice(0, 24).replace(/-+$/, "");
  }
  return normalized || "repo";
}

/**
 * Resolve the docs (artifact) directory for a slug.
 *
 * @param {{
 *   repoRoot?: string,
 *   slug?: string,
 *   shortRepo?: string,
 *   workflowRoot?: string,
 *   settings?: Record<string, unknown> | { location?: unknown, dir?: unknown } | null,
 *   env?: NodeJS.ProcessEnv
 * }} [options]
 * @returns {{ ok: true, docsDir: string, location: string } | { ok: false, reason: string }}
 */
export function resolveArtifactsDocsDir(options = {}) {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ? resolve(String(options.repoRoot)) : resolve(process.cwd());
  const slug = typeof options.slug === "string" ? options.slug : "";
  const workflowRoot = options.workflowRoot ? resolve(String(options.workflowRoot)) : "";
  const shortRepo = options.shortRepo || defaultShortRepo(repoRoot);

  const envOverrideRaw =
    env && typeof env.CURSOR_ATOMIC_ARTIFACTS_DIR === "string"
      ? env.CURSOR_ATOMIC_ARTIFACTS_DIR.trim()
      : "";
  if (envOverrideRaw) {
    if (!isAbsolute(envOverrideRaw)) {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
    return {
      ok: true,
      docsDir: join(resolve(envOverrideRaw), shortRepo, slug),
      location: "custom",
    };
  }

  const settings = options.settings;
  let block = null;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    if (
      settings.artifacts !== undefined &&
      settings.artifacts !== null &&
      typeof settings.artifacts === "object" &&
      !Array.isArray(settings.artifacts)
    ) {
      block = settings.artifacts;
    } else if (settings.location !== undefined) {
      block = settings;
    }
  }

  const parsed = parseArtifactsBlock(block, "project settings");
  if (!parsed.ok) return parsed;
  const artifacts = parsed.artifacts;
  const location = artifacts?.location || "home";
  const dir = artifacts?.dir;

  if (location === "home") {
    return {
      ok: true,
      docsDir: join(resolve(workflowRoot), "docs", shortRepo, slug),
      location: "home",
    };
  }

  if (location === "repo") {
    const rel = typeof dir === "string" && dir.trim() ? dir.trim() : DEFAULT_REPO_ARTIFACTS_DIR;
    if (isAbsolute(rel)) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${rel}")`,
      };
    }
    const segments = rel.split(/[\\/]+/);
    if (segments.includes("..")) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${rel}")`,
      };
    }
    const resolved = resolve(repoRoot, rel);
    if (resolved !== repoRoot && !resolved.startsWith(repoRoot + sep)) {
      return {
        ok: false,
        reason: `artifacts.dir must be a relative path inside the repository (got "${rel}")`,
      };
    }
    return {
      ok: true,
      docsDir: join(resolved, slug),
      location: "repo",
    };
  }

  if (location === "custom") {
    if (typeof dir !== "string" || !dir.trim() || !isAbsolute(dir.trim())) {
      return {
        ok: false,
        reason: `artifacts.dir must be an absolute path when artifacts.location is "custom"`,
      };
    }
    return {
      ok: true,
      docsDir: join(resolve(dir.trim()), shortRepo, slug),
      location: "custom",
    };
  }

  return {
    ok: false,
    reason: `unknown artifacts.location "${location}" (allowed: home, repo, custom)`,
  };
}
