import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, renameSync } from "node:fs";
/**
 * @param {string} value
 * @param {string} [home]
 */
function expandHomePath(value, home = homedir()) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
  return value;
}

/** @deprecated read-only fallback; nothing installs this name anymore */
export const LEGACY_WORKFLOW_HOME_BASENAME = ".cursor-atomic-workflow";
export const WORKFLOW_HOME_BASENAME = ".atomic-workflow";

/** @deprecated read-only fallback */
export const LEGACY_PROJECT_SETTINGS_FILE = ".cursor-atomic-workflow.json";
export const PROJECT_SETTINGS_FILE = ".atomic-workflow.json";

/** @deprecated read-only fallback */
export const LEGACY_CONFIG_DIR_NAME = "cursor-atomic-workflow";
export const CONFIG_DIR_NAME = "atomic-workflow";

export const LEGACY_ENV_PREFIX = "CURSOR_ATOMIC_";
export const ENV_PREFIX = "ATOMIC_";

/** Installed alias prefix removed on install (skills, commands, agents). */
export const LEGACY_INSTALLED_ALIAS_PREFIX = "cursor-atomic-";

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} suffix e.g. `WORKFLOW_HOME` (no prefix)
 * @returns {string | undefined}
 */
export function readEnv(env, suffix) {
  const atomicKey = `${ENV_PREFIX}${suffix}`;
  const legacyKey = `${LEGACY_ENV_PREFIX}${suffix}`;
  const atomic = env[atomicKey];
  if (typeof atomic === "string" && atomic.trim()) return atomic.trim();
  const legacy = env[legacyKey];
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return undefined;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 */
export function workflowConfigPath(env = process.env, home = homedir()) {
  const xdg = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : "";
  const base = xdg ? resolve(expandHomePath(xdg, home)) : join(home, ".config");
  const newPath = join(base, CONFIG_DIR_NAME, "config.json");
  const oldPath = join(base, LEGACY_CONFIG_DIR_NAME, "config.json");
  if (existsSync(newPath)) return newPath;
  if (existsSync(oldPath)) return oldPath;
  return newPath;
}

/**
 * @param {string} [home]
 */
export function defaultWorkflowHome(home = homedir()) {
  return join(home, WORKFLOW_HOME_BASENAME);
}

/**
 * @param {string} [home]
 */
export function legacyWorkflowHome(home = homedir()) {
  return join(home, LEGACY_WORKFLOW_HOME_BASENAME);
}

/**
 * Rename legacy home to the new name once when the new path is missing.
 * @param {{ homeDir?: string, existsSync?: typeof existsSync, renameSync?: typeof renameSync }} [options]
 * @returns {string} preferred workflow home directory
 */
export function ensureWorkflowHomeDir(options = {}) {
  const home = options.homeDir ?? homedir();
  const exists = options.existsSync ?? existsSync;
  const rename = options.renameSync ?? renameSync;
  const newPath = defaultWorkflowHome(home);
  const oldPath = legacyWorkflowHome(home);
  if (exists(newPath)) return newPath;
  if (!exists(oldPath)) return newPath;
  try {
    rename(oldPath, newPath);
    return newPath;
  } catch {
    return oldPath;
  }
}

/**
 * Path used to read project settings (new file wins; else legacy).
 * @param {string} repoRoot
 * @param {(path: string) => boolean} [exists]
 */
export function resolveProjectSettingsReadPath(repoRoot, exists = existsSync) {
  const root = resolve(repoRoot);
  const newPath = join(root, PROJECT_SETTINGS_FILE);
  if (exists(newPath)) return newPath;
  const oldPath = join(root, LEGACY_PROJECT_SETTINGS_FILE);
  if (exists(oldPath)) return oldPath;
  return newPath;
}

/**
 * Path used when writing project settings (always the new name).
 * @param {string} repoRoot
 */
export function projectSettingsWritePath(repoRoot) {
  return join(resolve(repoRoot), PROJECT_SETTINGS_FILE);
}
