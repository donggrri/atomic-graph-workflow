import test from "node:test";
import assert from "node:assert/strict";
import { parseGraphYaml, phaseToGraphStage } from "../scripts/lib/graph.mjs";

test("parseGraphYaml reads executors and agents", () => {
  const yaml = `version: 1
nodes:
  plan:
    skill: cursor-atomic-plan
    executor: agy
    agent: planner
`;
  const graph = parseGraphYaml(yaml);
  assert.equal(graph.nodes.plan.executor, "agy");
  assert.equal(graph.nodes.plan.agent, "planner");
});

test("phaseToGraphStage maps pipeline phases", () => {
  assert.equal(phaseToGraphStage("tasker"), "task");
  assert.equal(phaseToGraphStage("tester"), "wrapup");
});
