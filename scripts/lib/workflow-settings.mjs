import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { docsRootFromLegacyArtifacts } from "./artifacts.mjs";
import { getWorkflowRoot } from "../work-status.mjs";
import { GLOBAL_SETTINGS_FILE } from "./profiles.mjs";
import { resolveProjectSettingsReadPath } from "./legacy-paths.mjs";
import { EXECUTOR_IDS } from "./executors/constants.mjs";
import { GRAPH_STAGE_IDS } from "./graph.mjs";

const AGY_STAGES = ["plan", "implement", "review"];
const AGY_VALUES = new Set(["ask", "sdk", "agy"]);

/**
 * Warning emitted when the project settings file carries an absolute (or
 * ~-leading) docsRoot. The project file must use a repo-relative path;
 * absolute paths are only honored in global settings.
 */
export const PROJECT_DOCSROOT_ABSOLUTE_WARNING =
  "docsRoot from project settings must be a relative path inside the repository; absolute paths are only allowed in global settings";

/**
 * @param {string} value trimmed docsRoot
 */
function isAbsoluteLikeDocsRoot(value) {
  return (
    isAbsolute(value) || value.startsWith("~") || /^[A-Za-z]:[\\/]/.test(value)
  );
}

/**
 * @param {string} value trimmed docsRoot
 */
function hasDotDotSegment(value) {
  return value.split(/[\\/]/).includes("..");
}

/**
 * @param {string} filePath
 * @param {string} label
 * @returns {{ ok: true, data: Record<string, unknown> } | { ok: false, reason: string }}
 */
function readSettingsFile(filePath, label) {
  if (!existsSync(filePath)) return { ok: true, data: {} };
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { ok: false, reason: `${label}: invalid JSON` };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `${label}: invalid JSON` };
  }
  return { ok: true, data: raw };
}

/**
 * @param {unknown} agyBlock
 * @param {string} label
 * @returns {{ ok: true, choices: Partial<Record<string, "ask"|"sdk"|"agy">> } | { ok: false, reason: string }}
 */
function parseAgyBlock(agyBlock, label) {
  if (agyBlock == null) return { ok: true, choices: {} };
  if (typeof agyBlock !== "object" || Array.isArray(agyBlock)) {
    return { ok: false, reason: `${label}: agy must be an object` };
  }
  /** @type {Partial<Record<string, "ask"|"sdk"|"agy">>} */
  const choices = {};
  for (const [key, value] of Object.entries(agyBlock)) {
    if (!AGY_STAGES.includes(key)) {
      return { ok: false, reason: `${label}: agy.${key} is not a valid stage` };
    }
    if (typeof value !== "string" || !AGY_VALUES.has(value)) {
      return {
        ok: false,
        reason: `${label}: agy.${key} must be "ask", "sdk", or "agy"`,
      };
    }
    choices[key] = value;
  }
  return { ok: true, choices };
}

/**
 * @param {unknown} block
 * @param {string} label
 */
function parseExecutorsBlock(block, label) {
  if (block == null) return { ok: true, executors: {}, warnings: [] };
  if (typeof block !== "object" || Array.isArray(block)) {
    return { ok: false, reason: `${label}: executors must be an object` };
  }
  /** @type {Record<string, string>} */
  const executors = {};
  /** @type {string[]} */
  const warnings = [];
  for (const [key, value] of Object.entries(block)) {
    if (!GRAPH_STAGE_IDS.includes(key)) {
      return { ok: false, reason: `${label}: executors.${key} is not a valid stage` };
    }
    if (typeof value === "string") {
      if (!EXECUTOR_IDS.includes(value)) {
        return { ok: false, reason: `${label}: executors.${key} unknown executor ${value}` };
      }
      executors[key] = value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const id = value.executor ?? value.id;
      if (typeof id !== "string" || !EXECUTOR_IDS.includes(id)) {
        return { ok: false, reason: `${label}: executors.${key}.executor invalid` };
      }
      executors[key] = id;
      if (typeof value.model === "string" && value.model.trim()) {
        warnings.push(`${label}: executors.${key}.model is ignored (the workflow does not select models)`);
      }
      continue;
    }
    return { ok: false, reason: `${label}: executors.${key} must be string or { executor }` };
  }
  return { ok: true, executors, warnings };
}

/**
 * @param {unknown} block
 * @param {string} label
 */
/**
 * @param {unknown} block
 * @param {string} label
 */
export function parseTrustedExecutors(block, label) {
  if (block == null) return { ok: true, trustedExecutors: {} };
  if (typeof block !== "object" || Array.isArray(block)) {
    return { ok: false, reason: `${label}: trustedExecutors must be an object` };
  }
  /** @type {Record<string, boolean>} */
  const trustedExecutors = {};
  for (const [key, value] of Object.entries(block)) {
    if (!EXECUTOR_IDS.includes(key)) {
      return { ok: false, reason: `${label}: trustedExecutors.${key} is not a valid executor` };
    }
    trustedExecutors[key] = Boolean(value);
  }
  return { ok: true, trustedExecutors };
}

export function parseExecutorTimeouts(block, label) {
  if (block == null) return { ok: true, executorTimeouts: {} };
  if (typeof block !== "object" || Array.isArray(block)) {
    return { ok: false, reason: `${label}: executorTimeouts must be an object` };
  }
  /** @type {Record<string, number>} */
  const executorTimeouts = {};
  for (const [key, value] of Object.entries(block)) {
    if (!GRAPH_STAGE_IDS.includes(key) && key !== "lite") {
      return { ok: false, reason: `${label}: executorTimeouts.${key} is not a valid stage` };
    }
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return { ok: false, reason: `${label}: executorTimeouts.${key} must be a positive number (minutes)` };
    }
    executorTimeouts[key] = num;
  }
  return { ok: true, executorTimeouts };
}

/**
 * Global settings, then project `.atomic-workflow.json` (project wins per stage).
 *
 * @param {{
 *   repoRoot: string,
 *   workflowHome?: string,
 *   exists?: (path: string) => boolean,
 *   readFile?: (path: string, encoding: string) => string,
 * }} options
 */
export function loadWorkflowSettings(options) {
  const workflowHome = options.workflowHome ?? getWorkflowRoot();
  const globalPath = join(workflowHome, GLOBAL_SETTINGS_FILE);
  const projectPath = resolveProjectSettingsReadPath(options.repoRoot);

  const global = readSettingsFile(globalPath, "global settings");
  if (!global.ok) return global;
  const project = readSettingsFile(projectPath, "project settings");
  if (!project.ok) return project;

  const globalAgy = parseAgyBlock(global.data.agy, "global settings");
  if (!globalAgy.ok) return globalAgy;
  const projectAgy = parseAgyBlock(project.data.agy, "project settings");
  if (!projectAgy.ok) return projectAgy;

  const globalExec = parseExecutorsBlock(global.data.executors, "global settings");
  if (!globalExec.ok) return globalExec;
  const projectExec = parseExecutorsBlock(project.data.executors, "project settings");
  if (!projectExec.ok) return projectExec;

  const globalTimeouts = parseExecutorTimeouts(global.data.executorTimeouts, "global settings");
  if (!globalTimeouts.ok) return globalTimeouts;
  const projectTimeouts = parseExecutorTimeouts(project.data.executorTimeouts, "project settings");
  if (!projectTimeouts.ok) return projectTimeouts;

  const globalTrust = parseTrustedExecutors(global.data.trustedExecutors, "global settings");
  if (!globalTrust.ok) return globalTrust;
  const projectTrust = parseTrustedExecutors(project.data.trustedExecutors, "project settings");
  if (!projectTrust.ok) return projectTrust;

  /** @type {Partial<Record<string, "ask"|"sdk"|"agy">>} */
  const agy = { ...globalAgy.choices, ...projectAgy.choices };
  const executors = { ...globalExec.executors, ...projectExec.executors };
  const executorTimeouts = { ...globalTimeouts.executorTimeouts, ...projectTimeouts.executorTimeouts };
  const trustedExecutors = {
    ...globalTrust.trustedExecutors,
    ...projectTrust.trustedExecutors,
  };

  /** @type {string[]} */
  const warnings = [...globalExec.warnings, ...projectExec.warnings];
  for (const [label, data] of [
    ["global settings", global.data],
    ["project settings", project.data],
  ]) {
    if (data.agyModel != null) {
      warnings.push(`${label}: agyModel is ignored (the workflow does not select models)`);
    }
    if (data.artifacts != null) {
      warnings.push(`${label}: artifacts is deprecated (use docsRoot instead)`);
    }
  }

  const testDone =
    typeof project.data.testDone === "string" && project.data.testDone.trim()
      ? project.data.testDone.trim()
      : null;

  let docsRoot = null;
  let globalDocsRoot = null;
  if (global.data.docsRoot != null && global.data.docsRoot !== "") {
    if (typeof global.data.docsRoot !== "string" || !global.data.docsRoot.trim()) {
      return { ok: false, reason: "global settings: docsRoot must be a string" };
    }
    if (global.data.docsRoot.includes("\0")) {
      return { ok: false, reason: "global settings: docsRoot must not contain null bytes" };
    }
    // Absolute (or ~-leading) paths remain allowed in global settings.
    globalDocsRoot = global.data.docsRoot.trim();
  }
  if (project.data.docsRoot != null && project.data.docsRoot !== "") {
    if (typeof project.data.docsRoot !== "string" || !project.data.docsRoot.trim()) {
      return { ok: false, reason: "project settings: docsRoot must be a string" };
    }
    if (project.data.docsRoot.includes("\0")) {
      return { ok: false, reason: "project settings: docsRoot must not contain null bytes" };
    }
    const trimmed = project.data.docsRoot.trim();
    if (isAbsoluteLikeDocsRoot(trimmed)) {
      warnings.push(PROJECT_DOCSROOT_ABSOLUTE_WARNING);
    } else if (hasDotDotSegment(trimmed)) {
      return { ok: false, reason: `project settings: docsRoot must be a relative path inside the repository (got "${trimmed}")` };
    } else {
      docsRoot = trimmed;
    }
  }
  if (
    docsRoot == null &&
    project.data.artifacts != null &&
    typeof project.data.artifacts === "object" &&
    !Array.isArray(project.data.artifacts)
  ) {
    // Keep the legacy alias consistent: a project-level `custom` absolute
    // dir is ignored with the same warning instead of being honored.
    const mapped = docsRootFromLegacyArtifacts(project.data.artifacts);
    if (mapped != null && isAbsoluteLikeDocsRoot(mapped.trim())) {
      warnings.push(PROJECT_DOCSROOT_ABSOLUTE_WARNING);
    }
  }

  return {
    ok: true,
    agy,
    testDone,
    docsRoot: docsRoot ?? globalDocsRoot,
    executors,
    warnings,
    executorTimeouts,
    trustedExecutors,
  };
}

/**
 * @param {object} state
 * @param {string} stage
 * @param {{ auto?: boolean }} flags
 * @param {Partial<Record<string, "ask"|"sdk"|"agy">>} [agyDefaults]
 * @returns {"agy"|"sdk"|null}
 */
export function resolveAgyDecision(state, stage, flags, agyDefaults = {}) {
  if (flags.auto) return "sdk";
  const chosen = state.agyChoice?.[stage];
  if (chosen === "agy" || chosen === "sdk") return chosen;
  const preset = agyDefaults[stage];
  if (preset === "agy" || preset === "sdk") return preset;
  return null;
}
