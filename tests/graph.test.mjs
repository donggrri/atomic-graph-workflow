import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGraphYaml,
  phaseToGraphStage,
  stripYamlInlineComment,
} from "../scripts/lib/graph.mjs";

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
  assert.equal(phaseToGraphStage("review"), "review");
  assert.equal(phaseToGraphStage("task"), "task");
  assert.equal(phaseToGraphStage("wrapup"), "wrapup");
});

test("stripYamlInlineComment ignores # inside quotes", () => {
  assert.equal(stripYamlInlineComment('"foo # bar"'), '"foo # bar"');
  assert.equal(stripYamlInlineComment("plain # comment"), "plain");
});

test("parseGraphYaml strips quotes and inline comments", () => {
  const yaml = `version: 1
nodes:
  plan:
    executor: "agy"
    agent: planner # role
`;
  const graph = parseGraphYaml(yaml);
  assert.equal(graph.nodes.plan.executor, "agy");
  assert.equal(graph.nodes.plan.agent, "planner");
});
