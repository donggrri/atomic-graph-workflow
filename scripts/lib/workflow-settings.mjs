import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getWorkflowRoot } from "../work-status.mjs";
import { PROJECT_SETTINGS_FILE, GLOBAL_SETTINGS_FILE } from "./profiles.mjs";
import { EXECUTOR_IDS } from "./executors/constants.mjs";
import { GRAPH_STAGE_IDS } from "./graph.mjs";

const AGY_STAGES = ["plan", "implement", "review"];
const AGY_VALUES = new Set(["ask", "sdk", "agy"]);

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
  if (block == null) return { ok: true, executors: {}, executorModels: {} };
  if (typeof block !== "object" || Array.isArray(block)) {
    return { ok: false, reason: `${label}: executors must be an object` };
  }
  /** @type {Record<string, string>} */
  const executors = {};
  /** @type {Record<string, string>} */
  const executorModels = {};
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
        executorModels[key] = value.model.trim();
      }
      continue;
    }
    return { ok: false, reason: `${label}: executors.${key} must be string or { executor, model? }` };
  }
  return { ok: true, executors, executorModels };
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
 * Global settings, then project `.cursor-atomic-workflow.json` (project wins per stage).
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
  const projectPath = join(options.repoRoot, PROJECT_SETTINGS_FILE);

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
  const executorModels = { ...globalExec.executorModels, ...projectExec.executorModels };
  const executorTimeouts = { ...globalTimeouts.executorTimeouts, ...projectTimeouts.executorTimeouts };
  const trustedExecutors = {
    ...globalTrust.trustedExecutors,
    ...projectTrust.trustedExecutors,
  };

  const agyModel =
    project.data.agyModel === null
      ? null
      : typeof project.data.agyModel === "string" && project.data.agyModel.trim()
        ? project.data.agyModel.trim()
        : typeof global.data.agyModel === "string" && global.data.agyModel.trim()
          ? global.data.agyModel.trim()
          : null;

  const testDone =
    typeof project.data.testDone === "string" && project.data.testDone.trim()
      ? project.data.testDone.trim()
      : null;

  return {
    ok: true,
    agy,
    agyModel,
    testDone,
    executors,
    executorModels,
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
