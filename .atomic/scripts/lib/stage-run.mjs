import { mkdirSync, readFileSync } from "node:fs";
import { loadGraph, GRAPH_STAGE_IDS, assertInsideRepo } from "./graph.mjs";
import { loadWorkflowSettings } from "./workflow-settings.mjs";
import { applyEffectiveExecutorSettings } from "./effective-settings.mjs";
import { createCompositeRoleRunner } from "./executors/composite.mjs";
import { ROLES, AUXILIARY_ROLES } from "./roles.mjs";
import { canonicalName } from "./legacy-aliases.mjs";
import { getWorkflowPaths } from "../work-status.mjs";

export const READONLY_ROLE_KEY = ROLES["reviewer"] ? "reviewer" : "worker";

/**
 * @param {string} agent
 * @returns {string | null}
 */
export function graphAgentToRoleKey(agent) {
  if (!agent || typeof agent !== "string") return null;
  agent = canonicalName(agent);
  if (agent === "atomic-reviewer") return "reviewer";
  if (ROLES[agent] || AUXILIARY_ROLES[agent]) return agent;
  return agent;
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
  if (Array.isArray(graph.errors) && graph.errors.length > 0) {
    return { ok: false, kind: "config", message: graph.errors.join("\n") };
  }
  const loaded = loadWorkflowSettings({ repoRoot });
  if (!loaded.ok) {
    return { ok: false, kind: "run", message: loaded.reason ?? "invalid workflow settings" };
  }
  const settings = applyEffectiveExecutorSettings(loaded);

  const runner = createCompositeRoleRunner({
    adapter: options.adapter ?? null,
    repoRoot,
    slug,
    runsDir,
    docsDir: paths.docsDir,
    graph,
    settings,
    log: options.log ?? (() => {}),
    crossExecutorStartupFallback: true,
  });

  const READONLY_SUFFIX = "Mode: read-only. Do not modify files; report findings only.";
  const withReadonlyPrompt = (prompt) =>
    prompt.includes(READONLY_SUFFIX) ? prompt : `${prompt}\n${READONLY_SUFFIX}`;

  const earlyNode = graph.nodes[stage] ?? {};
  const earlyReadonly = earlyNode.readonly === true;
  if (stage === "lite") {
    const prompt = earlyReadonly ? withReadonlyPrompt(options.prompt) : options.prompt;
    return runner.runLite({ prompt, phaseKey: "lite" });
  }

  const node = graph.nodes[stage] ?? {};
  const agent = typeof node.agent === "string" ? node.agent : null;
  const roleKey = graphAgentToRoleKey(agent);
  const isReadonly = node.readonly === true;
  const effectiveRole = isReadonly ? READONLY_ROLE_KEY : (roleKey ?? "worker");
  if (!roleKey) {
    const isCustom = !GRAPH_STAGE_IDS.includes(stage);
    if (isCustom && graph.nodes[stage]) {
      const genericRole = effectiveRole;
      const parts = [];
      if (typeof node.skill === "string" && node.skill) {
        parts.push(`Skill: ${node.skill}`);
        parts.push("");
      }
      if (typeof node.prompt === "string" && node.prompt) {
        try {
          const absPrompt = assertInsideRepo(repoRoot, node.prompt, "prompt");
          parts.push(readFileSync(absPrompt, "utf8"));
        } catch {
          // missing prompt file or outside repo: continue with user prompt only
        }
        parts.push("");
      }
      parts.push(options.prompt);
      if (Array.isArray(node.inputs) && node.inputs.length > 0) {
        parts.push(`Inputs: ${node.inputs.join(", ")}`);
      }
      if (Array.isArray(node.outputs) && node.outputs.length > 0) {
        parts.push(`Outputs: ${node.outputs.join(", ")}`);
      }
      if (isReadonly) {
        parts.push(READONLY_SUFFIX);
      }
      const genericPrompt = parts.join("\n");
      const result = await runner.runRole({
        role: genericRole,
        prompt: genericPrompt,
        cwd: repoRoot,
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
    return { ok: false, kind: "run", message: `graph node ${stage} has no agent` };
  }

  // readonly applies even when the node defines an agent or is a built-in
  // stage: enforce the read-only reviewer role and append the mode line.
  const finalRole = isReadonly ? READONLY_ROLE_KEY : roleKey;
  const finalPrompt = isReadonly ? withReadonlyPrompt(options.prompt) : options.prompt;
  const result = await runner.runRole({
    role: finalRole,
    prompt: finalPrompt,
    cwd: repoRoot,
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
