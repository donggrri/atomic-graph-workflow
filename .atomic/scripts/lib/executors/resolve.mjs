import { EXECUTOR_IDS } from "./constants.mjs";
import { phaseToGraphStage } from "../graph.mjs";

/**
 * @param {{ adapter?: { mode?: string } }} options
 * @returns {string}
 */
export function defaultExecutorForAdapter() {
  // The workflow cannot select a local Cursor SDK model. Let the parent harness
  // run the generic task-card with its own model/default settings instead.
  return "cursor-subagent";
}

/**
 * @param {{
 *   phaseKey: string,
 *   graph: { nodes: Record<string, Record<string, unknown>> },
 *   settings: { executors?: Record<string, string> },
 *   adapter?: { mode?: string },
 * }} options
 */
export function resolveExecutorForPhase(options) {
  let stage = phaseToGraphStage(options.phaseKey);
  if (!stage && options.graph?.nodes?.[options.phaseKey]) {
    stage = options.phaseKey;
  }
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
