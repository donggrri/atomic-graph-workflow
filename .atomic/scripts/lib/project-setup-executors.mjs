import { GRAPH_STAGE_IDS } from "./graph.mjs";
import { EXECUTOR_IDS } from "./executors/constants.mjs";
import { select } from "./prompt.mjs";

const STAGE_LABELS = {
  explore: "Explore",
  plan: "Plan",
  "plan-review": "Plan review",
  task: "Task",
  execute: "Execute",
  review: "Review",
  wrapup: "Wrapup / test",
  memory: "Memory",
};

/**
 * @param {boolean} interactive
 * @returns {Promise<Record<string, string>>}
 */
export async function collectExecutorChoices(interactive) {
  /** @type {Record<string, string>} */
  const executors = {};
  const choices = EXECUTOR_IDS.map((id) => ({ value: id, label: id }));

  for (const stage of GRAPH_STAGE_IDS) {
    const label = STAGE_LABELS[stage] ?? stage;
    const def = stage === "plan" ? "cursor-sdk" : "cursor-subagent";
    executors[stage] = interactive
      ? await select(`${label} 단계 executor`, choices, def)
      : def;
  }
  return executors;
}
