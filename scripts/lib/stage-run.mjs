import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadGraph } from "./graph.mjs";
import { loadWorkflowSettings } from "./workflow-settings.mjs";
import { applyEffectiveExecutorSettings } from "./effective-settings.mjs";
import { createCompositeRoleRunner } from "./executors/composite.mjs";
import { ROLES, AUXILIARY_ROLES, getRole } from "./roles.mjs";
import { getWorkflowPaths } from "../work-status.mjs";

/**
 * @param {string} agent
 * @returns {string | null}
 */
export function graphAgentToRoleKey(agent) {
  if (!agent || typeof agent !== "string") return null;
  if (agent === "cursor-atomic-reviewer") return "reviewer";
  if (ROLES[agent] || AUXILIARY_ROLES[agent]) return agent;
  return agent;
}

/**
 * @param {string} roleKey
 */
export function roleTaskModel(roleKey) {
  if (ROLES[roleKey]) return getRole(roleKey).taskModel;
  if (AUXILIARY_ROLES[roleKey]) return AUXILIARY_ROLES[roleKey].taskModel;
  return "composer-2.5";
}

/**
 * @param {{
 *   repoRoot: string,
 *   stage: string,
 *   prompt: string,
 *   slug?: string,
 *   adapter?: { mode?: string, runRole?: Function } | null,
 *   runsDir?: string,
 *   log?: (...args: unknown[]) => void,
 * }} options
 */
export async function runGraphStage(options) {
  const repoRoot = options.repoRoot;
  const stage = options.stage;
  const slug = options.slug ?? "stage-run";
  const paths = getWorkflowPaths(repoRoot, slug);
  const runsDir = options.runsDir ?? paths.runsDir;
  mkdirSync(runsDir, { recursive: true });

  const graph = loadGraph(repoRoot);
  const loaded = loadWorkflowSettings({ repoRoot });
  const settings = applyEffectiveExecutorSettings(loaded.ok ? loaded : { executors: {} });

  const runner = createCompositeRoleRunner({
    adapter: options.adapter ?? null,
    repoRoot,
    slug,
    runsDir,
    graph,
    settings,
    log: options.log ?? (() => {}),
  });

  if (stage === "lite") {
    return runner.runLite({ prompt: options.prompt, phaseKey: "lite" });
  }

  const node = graph.nodes[stage] ?? {};
  const agent = typeof node.agent === "string" ? node.agent : null;
  const roleKey = graphAgentToRoleKey(agent);
  if (!roleKey) {
    return { ok: false, kind: "run", message: `graph node ${stage} has no agent` };
  }

  const result = await runner.runRole({
    role: roleKey,
    prompt: options.prompt,
    cwd: repoRoot,
    model: roleTaskModel(roleKey),
    phaseKey: stage,
  });

  if (result.ok) {
    return { ok: true, summary: result.summary ?? "ok" };
  }
  return {
    ok: false,
    message: result.message ?? result.kind ?? "run failed",
    kind: result.kind,
  };
}
