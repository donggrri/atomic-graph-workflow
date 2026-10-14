import { EXECUTOR_IDS } from "./constants.mjs";
import { phaseToGraphStage } from "../graph.mjs";

/**
 * @param {{ adapter?: { mode?: string } }} options
 * @returns {string}
 */
export function defaultExecutorForAdapter(adapter) {
  if (adapter?.mode === "sdk") return "cursor-sdk";
  return "cursor-subagent";
}

/**
 * @param {{
 *   phaseKey: string,
 *   graph: { nodes: Record<string, Record<string, unknown>> },
 *   settings: { executors?: Record<string, string>, executorModels?: Record<string, string> },
 *   adapter?: { mode?: string },
 * }} options
 */
export function resolveExecutorForPhase(options) {
  const stage = phaseToGraphStage(options.phaseKey);
  const settingsExec =
    stage && options.settings?.executors?.[stage]
      ? options.settings.executors[stage]
      : null;
  const graphNode = stage ? options.graph?.nodes?.[stage] : null;
  const graphExec =
    graphNode && typeof graphNode.executor === "string" ? graphNode.executor : null;

  const raw = settingsExec || graphExec || defaultExecutorForAdapter(options.adapter);
  if (!EXECUTOR_IDS.includes(raw)) {
    throw new Error(`unknown executor "${raw}" for stage ${stage ?? options.phaseKey}`);
  }
  return { stage, executorId: raw };
}

/**
 * @param {{
 *   stage: string | null,
 *   graph: { nodes: Record<string, Record<string, unknown>> },
 *   settings: { executorModels?: Record<string, string> },
 *   roleModel: string,
 * }} options
 */
export function resolveExecutorModel(options) {
  const { stage, graph, settings, roleModel } = options;
  if (stage && settings?.executorModels?.[stage]) {
    return settings.executorModels[stage];
  }
  const node = stage ? graph?.nodes?.[stage] : null;
  if (node && typeof node.model === "string" && node.model.trim()) {
    return node.model.trim();
  }
  return roleModel;
}
