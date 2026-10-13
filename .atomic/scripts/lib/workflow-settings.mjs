import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getWorkflowRoot } from "../work-status.mjs";
import { PROJECT_SETTINGS_FILE, GLOBAL_SETTINGS_FILE } from "./profiles.mjs";

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

  /** @type {Partial<Record<string, "ask"|"sdk"|"agy">>} */
  const agy = { ...globalAgy.choices, ...projectAgy.choices };

  return { ok: true, agy };
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
