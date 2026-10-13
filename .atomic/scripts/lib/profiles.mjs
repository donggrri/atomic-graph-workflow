import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getWorkflowRoot } from "../work-status.mjs";

export const DEFAULT_PROFILE_ID = "atomic";
export const PROJECT_SETTINGS_FILE = ".cursor-atomic-workflow.json";
export const GLOBAL_SETTINGS_FILE = "settings.json";

const SSH_LINE =
  "If PLAN has no target IP, do not SSH to any board; stop at spec and coverage checks.";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function emptyToNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * @param {string} input
 * @param {string} homeDir
 * @returns {string}
 */
export function expandHome(input, homeDir) {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return join(homeDir, input.slice(2));
  return input;
}

/**
 * @param {{
 *   exists?: (path: string) => boolean,
 *   readFile?: (path: string, encoding: string) => string,
 *   listDir?: (path: string) => string[],
 * }} [options]
 */
function fsOf(options = {}) {
  return {
    exists: options.exists ?? existsSync,
    readFile: options.readFile ?? ((path, encoding) => readFileSync(path, encoding)),
    listDir: options.listDir ?? ((path) => readdirSync(path)),
  };
}

/**
 * @param {string} filePath
 * @param {string} label
 * @param {ReturnType<typeof fsOf>} fs
 * @returns {{ ok: true, profile: string | null } | { ok: false, reason: string }}
 */
function readProfileSetting(filePath, label, fs) {
  if (!fs.exists(filePath)) return { ok: true, profile: null };
  let raw;
  try {
    raw = JSON.parse(fs.readFile(filePath, "utf8"));
  } catch {
    return { ok: false, reason: `${label}: invalid JSON` };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `${label}: invalid JSON` };
  }
  if (!Object.hasOwn(raw, "profile") || raw.profile == null || raw.profile === "") {
    return { ok: true, profile: null };
  }
  if (typeof raw.profile !== "string" || !raw.profile.trim()) {
    return { ok: false, reason: `${label}: profile must be a string` };
  }
  return { ok: true, profile: raw.profile.trim() };
}

/**
 * CLI, then project `.cursor-atomic-workflow.json`, then global settings, then atomic.
 *
 * @param {{
 *   cliProfile?: string | null,
 *   repoRoot: string,
 *   workflowHome?: string,
 *   exists?: (path: string) => boolean,
 *   readFile?: (path: string, encoding: string) => string,
 * }} options
 */
export function resolveProfileId(options) {
  const cli = emptyToNull(options.cliProfile ?? null);
  if (cli) return { ok: true, id: cli, source: "cli" };

  const fs = fsOf(options);
  const projectPath = join(options.repoRoot, PROJECT_SETTINGS_FILE);
  const project = readProfileSetting(projectPath, "project settings", fs);
  if (!project.ok) return project;
  if (project.profile) return { ok: true, id: project.profile, source: "project" };

  const workflowHome = options.workflowHome ?? getWorkflowRoot();
  const globalPath = join(workflowHome, GLOBAL_SETTINGS_FILE);
  const global = readProfileSetting(globalPath, "global settings", fs);
  if (!global.ok) return global;
  if (global.profile) return { ok: true, id: global.profile, source: "global" };

  return { ok: true, id: DEFAULT_PROFILE_ID, source: "default" };
}

/**
 * @param {string} dir
 * @param {ReturnType<typeof fsOf>} fs
 * @returns {string[]}
 */
function listJson(dir, fs) {
  if (!fs.exists(dir)) return [];
  return fs
    .listDir(dir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".example.json"))
    .sort();
}

/**
 * @param {string} command
 * @param {string} homeDir
 * @param {ReturnType<typeof fsOf>} fs
 * @param {string} id
 * @param {string} field
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
function resolveCommand(command, homeDir, fs, id, field) {
  const expanded = expandHome(command, homeDir);
  if (!isAbsolute(expanded)) {
    return { ok: false, reason: `profile ${id}: ${field} must be absolute or start with ~` };
  }
  if (!fs.exists(expanded)) {
    return { ok: false, reason: `profile ${id}: ${field} not found: ${expanded}` };
  }
  return { ok: true, path: expanded };
}

/**
 * @param {string} filePath
 * @param {ReturnType<typeof fsOf>} fs
 * @param {string} homeDir
 * @returns {{ ok: true, profile: object, warnings: string[] } | { ok: false, reason: string, id: string }}
 */
function loadProfileFile(filePath, fs, homeDir) {
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const fileId = fileName.replace(/\.json$/, "");
  let raw;
  try {
    raw = JSON.parse(fs.readFile(filePath, "utf8"));
  } catch {
    return { ok: false, reason: `profile ${fileId}: invalid JSON`, id: fileId };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `profile ${fileId}: invalid JSON`, id: fileId };
  }
  if (raw.id !== fileId) {
    return {
      ok: false,
      reason: `profile ${fileId}: id "${raw.id ?? ""}" does not match file name`,
      id: fileId,
    };
  }

  /** @type {string[]} */
  const warnings = [];
  for (const key of Object.keys(raw)) {
    if (key !== "id" && key !== "plan" && key !== "test") {
      warnings.push(`profile ${fileId}: ignoring unsupported key "${key}"`);
    }
  }

  /** @type {string | null} */
  let planCommand = null;
  if (raw.plan != null) {
    if (typeof raw.plan !== "object" || Array.isArray(raw.plan)) {
      return { ok: false, reason: `profile ${fileId}: plan must be an object`, id: fileId };
    }
    for (const key of Object.keys(raw.plan)) {
      if (key !== "command") {
        warnings.push(`profile ${fileId}: ignoring unsupported key "plan.${key}"`);
      }
    }
    const command = emptyToNull(raw.plan.command);
    if (command) {
      const resolved = resolveCommand(command, homeDir, fs, fileId, "plan.command");
      if (!resolved.ok) return { ...resolved, id: fileId };
      planCommand = resolved.path;
    }
  }

  const hasTest = raw.test != null;
  /** @type {string | null} */
  let testCommand = null;
  /** @type {string | null} */
  let testDone = "npm test";
  if (hasTest) {
    if (typeof raw.test !== "object" || Array.isArray(raw.test)) {
      return { ok: false, reason: `profile ${fileId}: test must be an object`, id: fileId };
    }
    for (const key of Object.keys(raw.test)) {
      if (key !== "command" && key !== "done") {
        warnings.push(`profile ${fileId}: ignoring unsupported key "test.${key}"`);
      }
    }
    const command = emptyToNull(raw.test.command);
    if (command) {
      const resolved = resolveCommand(command, homeDir, fs, fileId, "test.command");
      if (!resolved.ok) return { ...resolved, id: fileId };
      testCommand = resolved.path;
    }
    if (raw.test.done == null || raw.test.done === "") {
      testDone = testCommand ? null : "npm test";
    } else if (typeof raw.test.done !== "string") {
      return { ok: false, reason: `profile ${fileId}: test.done must be a string`, id: fileId };
    } else {
      testDone = raw.test.done;
    }
  }

  return {
    ok: true,
    warnings,
    profile: {
      id: fileId,
      source: filePath,
      plan: { command: planCommand },
      test: { command: testCommand, done: testDone },
    },
  };
}

/**
 * @param {{
 *   repoRoot?: string,
 *   packageRoot?: string,
 *   workflowHome?: string,
 *   homeDir?: string,
 *   exists?: (path: string) => boolean,
 *   readFile?: (path: string, encoding: string) => string,
 *   listDir?: (path: string) => string[],
 * }} [options]
 */
export function discoverProfiles(options = {}) {
  const fs = fsOf(options);
  const homeDir = options.homeDir ?? homedir();
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const workflowHome = options.workflowHome ?? getWorkflowRoot();
  const repoRoot = options.repoRoot ?? "";

  /** @type {Map<string, { ok: true, profile: object, warnings: string[] } | { ok: false, reason: string, id: string }>} */
  const byId = new Map();
  byId.set(DEFAULT_PROFILE_ID, {
    ok: true,
    warnings: [],
    profile: {
      id: DEFAULT_PROFILE_ID,
      source: "builtin",
      plan: { command: null },
      test: { command: null, done: "npm test" },
    },
  });

  const dirs = [
    join(packageRoot, "profiles"),
    join(workflowHome, "profiles"),
  ];
  if (repoRoot) dirs.push(join(repoRoot, "profiles"));

  for (const dir of dirs) {
    for (const name of listJson(dir, fs)) {
      const loaded = loadProfileFile(join(dir, name), fs, homeDir);
      byId.set(loaded.ok ? loaded.profile.id : loaded.id, loaded);
    }
  }

  const knownIds = [...byId.keys()].sort();
  return { byId, knownIds };
}

/**
 * @param {string} id
 * @param {Parameters<typeof discoverProfiles>[0]} [options]
 */
export function getProfile(id, options = {}) {
  const { byId, knownIds } = discoverProfiles(options);
  const loaded = byId.get(id);
  if (!loaded) {
    return {
      ok: false,
      reason: `unknown profile: ${id} (known: ${knownIds.join(", ")})`,
      knownIds,
    };
  }
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason, knownIds };
  }
  return { ok: true, profile: loaded.profile, warnings: loaded.warnings, knownIds };
}

/**
 * @param {{ plan?: { command: string | null } }} profile
 * @param {string} planPath
 * @returns {string[]}
 */
export function plannerProfileLines(profile, planPath) {
  if (!profile.plan?.command) return [];
  return [
    `Profile plan command: ${profile.plan.command} — read and follow it, but write the output only to ${planPath}.`,
  ];
}

/**
 * @param {{ test?: { command: string | null, done: string | null } }} profile
 * @param {string} slug
 * @returns {{ prompt: string, done: string | null }}
 */
export function testerStep(profile, slug) {
  const lines = [`Test slug ${slug}`];
  if (profile.test?.command) {
    lines.push(`Profile test command: ${profile.test.command} — read and follow it.`);
    lines.push(SSH_LINE);
  }
  return {
    prompt: lines.join("\n"),
    done: profile.test?.done ?? null,
  };
}
