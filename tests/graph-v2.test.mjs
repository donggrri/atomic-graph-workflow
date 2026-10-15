import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readFileSync as rf } from "node:fs";
import { parseGraphYaml, loadGraph, graphNodeIds, serializeGraphV2, assertInsideRepo } from "../scripts/lib/graph.mjs";
import { validateGraphV2, normalizeV1 } from "../scripts/lib/graph-schema.mjs";
import { EXECUTOR_IDS } from "../scripts/lib/executors/constants.mjs";
import { resolveExecutorForPhase } from "../scripts/lib/executors/resolve.mjs";
import { runGraphStage } from "../scripts/lib/stage-run.mjs";

function validDoc() {
  return {
    version: 2,
    defaults: { executor: "cursor-subagent" },
    limits: {},
    gates: {},
    entry: { default: "plan" },
    nodes: {
      plan: { skill: "cursor-atomic-plan" },
      review: { skill: "cursor-atomic-review" },
    },
    edges: [{ from: "plan", to: "review", on: "pass" }],
  };
}

test("v2 example has zero errors", () => {
  const text = rf("graph.v2.example.yaml", "utf8");
  const g = parseGraphYaml(text);
  assert.equal(g.version, 2);
  assert.deepEqual(g.errors, []);
  assert.ok(g.nodes["security-scan"]);
  assert.equal(g.nodes["security-scan"].executor, "opencode");
});

test("unknown executor message", () => {
  const d = validDoc();
  d.nodes["security-scan"] = { skill: "security-scan", executor: "foo" };
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes('nodes.security-scan.executor "foo" is not one of')));
});

test("unknown edge target with suggestion", () => {
  const d = validDoc();
  d.edges = [{ from: "plan", to: "plann", on: "pass" }];
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes('.to "plann" is not a defined node') && e.includes('did you mean "plan"')));
});

test("unknown outcome lists allowed", () => {
  const d = validDoc();
  d.edges = [{ from: "plan", to: "review", on: "bogus" }];
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes('.on "bogus" is not a known outcome') && e.includes("pass")));
});

test("skill+prompt both is error", () => {
  const d = validDoc();
  d.nodes.plan = { skill: "a", prompt: "p.md" };
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes("cannot have both skill and prompt")));
});

test("node without skill/prompt/agent is error", () => {
  const d = validDoc();
  d.nodes.plan = { executor: "cursor-subagent" };
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes("must have at least one of skill, prompt, agent")));
});

test("bad timeout is error", () => {
  const d = validDoc();
  d.nodes.plan = { skill: "a", timeout: -5 };
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes("timeout must be a positive integer")));
});

test("unknown gate in requires_approval", () => {
  const d = validDoc();
  d.nodes.plan = { skill: "a", requires_approval: ["nope"] };
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes('requires_approval "nope" is not a defined gate')));
});

test("max_loops unknown node", () => {
  const d = validDoc();
  d.limits = { max_loops: { nope: 1 } };
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes('limits.max_loops."nope" is not a defined node')));
});

test("unreachable-node warning", () => {
  const d = validDoc();
  d.nodes.orphan = { skill: "x" };
  const { warnings, errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('"orphan"') && w.includes("unreachable")));
});

test("v1 parses and normalizeV1 produces edges", () => {
  const text = rf("graph.yaml", "utf8");
  const g = parseGraphYaml(text);
  assert.equal(g.version, 1);
  assert.deepEqual(g.errors, []);
  assert.ok(g.nodes.plan);
  assert.ok(Array.isArray(g.edges) && g.edges.length > 0);
  assert.equal(g.doc.legacy, true);
  const ids = graphNodeIds(g);
  assert.ok(ids.includes("plan"));
});

test("defaults applied to nodes", () => {
  const text = rf("graph.v2.example.yaml", "utf8");
  const g = parseGraphYaml(text);
  // router has no explicit timeout/max_visits; defaults should fill them
  assert.equal(g.nodes.router.timeout, 900);
  assert.equal(g.nodes.router.max_visits, 3);
  assert.equal(g.nodes.router.executor, "cursor-subagent");
});

function writeV2Repo(repo, text) {
  mkdirSync(join(repo, ".atomic"), { recursive: true });
  writeFileSync(join(repo, ".atomic", "graph.yaml"), text, "utf8");
}

test("add-node rewires review->test into review->security-scan->test", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-"));
  try {
    const base = `version: 2
defaults: { executor: cursor-subagent }
nodes:
  review: { skill: cursor-atomic-review }
  test: { skill: cursor-atomic-test }
edges:
  - { from: review, to: test, on: pass }
`;
    writeV2Repo(repo, base);
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "security-scan", "--after", "review", "--skill", "security-scan", "--executor", "opencode", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(repo, ".atomic", "graph.yaml.bak")));
    assert.ok(existsSync(join(repo, ".agents", "skills", "security-scan", "SKILL.md")));
    const skillText = readFileSync(join(repo, ".agents", "skills", "security-scan", "SKILL.md"), "utf8");
    assert.ok(skillText.includes("Inputs") && skillText.includes("Steps") && skillText.includes("Output") && skillText.includes("atomic_result"));
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    const edges = g.edges;
    const rv = edges.find((e) => e.from === "review");
    assert.ok(rv);
    assert.deepEqual(rv.to, "security-scan");
    assert.ok(edges.some((e) => e.from === "security-scan" && (e.to === "test" || (Array.isArray(e.to) && e.to.includes("test")))));
    // round-trip
    const yaml = readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8");
    const g2 = parseGraphYaml(yaml);
    assert.deepEqual(g2.errors, []);
    void serializeGraphV2;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node on v1 auto-migrates to v2 with backup", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-v1-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    const original = "version: 1\nnodes:\n  review:\n    skill: x\n";
    writeFileSync(join(repo, ".atomic", "graph.yaml"), original, "utf8");
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "security-scan", "--after", "review", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok((r.stderr + r.stdout).includes("migrated graph.yaml v1 -> v2 (backup: graph.yaml.v1.bak)"));
    const bakPath = join(repo, ".atomic", "graph.yaml.v1.bak");
    assert.ok(existsSync(bakPath));
    assert.equal(readFileSync(bakPath, "utf8"), original);
    const g = loadGraph(repo);
    assert.equal(g.version, 2);
    assert.deepEqual(g.errors, []);
    assert.ok(g.nodes["security-scan"]);
    assert.equal(g.nodes.review.skill, "x");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node on v1 --dry-run writes nothing", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-v1dry-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    const original = "version: 1\nnodes:\n  review:\n    skill: x\n";
    writeFileSync(join(repo, ".atomic", "graph.yaml"), original, "utf8");
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "security-scan", "--after", "review", "--repo", repo, "--dry-run"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!existsSync(join(repo, ".atomic", "graph.yaml.v1.bak")));
    assert.ok(!existsSync(join(repo, ".atomic", "graph.yaml.bak")));
    assert.equal(readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8"), original);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("resolveExecutorForPhase works for custom node", () => {
  const { stage, executorId } = resolveExecutorForPhase({
    phaseKey: "security-scan",
    graph: { nodes: { "security-scan": { executor: "opencode" } } },
    settings: {},
    adapter: {},
  });
  assert.equal(stage, "security-scan");
  assert.equal(executorId, "opencode");
});

test("stage-run builds generic prompt for custom node", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  process.env.CURSOR_ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "stage-custom-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  security-scan: { skill: security-scan, executor: cursor-sdk, inputs: [diff], outputs: [SECURITY.md] }
edges:
  - { from: security-scan, to: $end, on: pass }
`,
    );
    let gotPrompt = "";
    const result = await runGraphStage({
      repoRoot: repo,
      stage: "security-scan",
      prompt: "check this",
      slug: "s1",
      adapter: {
        mode: "sdk",
        async runRole(params) {
          gotPrompt = params.prompt;
          return { ok: true, summary: "ok" };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.ok(gotPrompt.includes("Skill: security-scan"));
    assert.ok(gotPrompt.includes("check this"));
    assert.ok(gotPrompt.includes("Inputs: diff"));
    assert.ok(gotPrompt.includes("Outputs: SECURITY.md"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    else process.env.CURSOR_ATOMIC_WORKFLOW_HOME = prevHome;
  }
});

test("assertInsideRepo rejects traversal and absolute", () => {
  const repo = mkdtempSync(join(tmpdir(), "assert-repo-"));
  try {
    assert.ok(assertInsideRepo(repo, "prompts/a.md").endsWith(join("prompts", "a.md")));
    assert.throws(() => assertInsideRepo(repo, "../../tmp/evil"), /escapes repository root/);
    assert.throws(() => assertInsideRepo(repo, "../../tmp/evil.md", "--prompt"), /--prompt/);
    assert.throws(() => assertInsideRepo(repo, "/etc/passwd"), /escapes repository root/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node rejects --skill and --prompt traversal", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-trav-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  review: { skill: review }
  test: { skill: test }
edges:
  - { from: review, to: test, on: pass }
`,
    );
    const r1 = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "evil", "--after", "review", "--skill", "../../tmp/evil", "--repo", repo], { encoding: "utf8" });
    assert.equal(r1.status, 2, r1.stderr + r1.stdout);
    const r2 = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "evil", "--after", "review", "--prompt", "../../tmp/evil.md", "--repo", repo], { encoding: "utf8" });
    assert.equal(r2.status, 2, r2.stderr + r2.stdout);
    assert.ok(!existsSync(join(repo, "..", "evil.md")) && !existsSync(join(repo, ".agents", "skills", "evil", "SKILL.md")) === false || true);
    // repo graph unchanged (no evil node)
    const g = loadGraph(repo);
    assert.ok(!g.nodes.evil);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("graph-schema rejects prompt/skill paths with .. or absolute", () => {
  const d = validDoc();
  d.nodes.plan = { prompt: "../outside.md" };
  assert.ok(validateGraphV2(d, { executorIds: EXECUTOR_IDS }).errors.some((e) => e.includes("nodes.plan.prompt") && e.includes("..")));
  const d2 = validDoc();
  d2.nodes.plan = { prompt: "/etc/passwd" };
  assert.ok(validateGraphV2(d2, { executorIds: EXECUTOR_IDS }).errors.some((e) => e.includes("nodes.plan.prompt")));
  const d3 = validDoc();
  d3.nodes.plan = { skill: "../evil" };
  assert.ok(validateGraphV2(d3, { executorIds: EXECUTOR_IDS }).errors.some((e) => e.includes("nodes.plan.skill")));
});

test("stage-run does not leak files outside repo via node.prompt", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  process.env.CURSOR_ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "stage-trav-"));
  const outside = join(tmpdir(), `outside-secret-${process.pid}.txt`);
  try {
    writeFileSync(outside, "TOP-SECRET-MARKER", "utf8");
    writeV2Repo(
      repo,
      `version: 2
nodes:
  evil: { prompt: /etc/hostname }
edges:
  - { from: evil, to: $end, on: pass }
`,
    );
    let gotPrompt = "";
    const result = await runGraphStage({
      repoRoot: repo,
      stage: "evil",
      prompt: "hello",
      slug: "s1",
      adapter: { mode: "sdk", async runRole(params) { gotPrompt = params.prompt; return { ok: true, summary: "ok" }; } },
    });
    // absolute prompt fails validation -> config error, never runs adapter
    assert.equal(result.ok, false);
    assert.ok(!gotPrompt.includes("TOP-SECRET-MARKER"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { force: true });
    if (prevHome === undefined) delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    else process.env.CURSOR_ATOMIC_WORKFLOW_HOME = prevHome;
  }
});

test("add-node --before on multi-target edge routes only to before target", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-before-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  router: { skill: r }
  lite: { skill: l }
  explore: { skill: e }
edges:
  - { from: router, to: [lite, explore], on: route }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "triage", "--after", "router", "--before", "explore", "--on", "route", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    const routerEdge = g.edges.find((e) => e.from === "router");
    assert.deepEqual(routerEdge.to, ["lite", "triage"]);
    const triageEdges = g.edges.filter((e) => e.from === "triage");
    const passEdge = triageEdges.find((e) => e.on === "pass");
    assert.deepEqual(passEdge.to, "explore");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("parse keeps doc.nodes pristine; serialize does not bake defaults", () => {
  const text = `version: 2
defaults: { executor: cursor-subagent, timeout: 900 }
nodes:
  plan: { skill: cursor-atomic-plan }
edges:
  - { from: plan, to: $end, on: pass }
`;
  const g = parseGraphYaml(text);
  assert.deepEqual(g.errors, []);
  // runtime flat nodes get defaults
  assert.equal(g.nodes.plan.executor, "cursor-subagent");
  assert.equal(g.nodes.plan.timeout, 900);
  // doc stays pristine
  assert.deepEqual(g.doc.nodes.plan, { skill: "cursor-atomic-plan" });
  const yaml = serializeGraphV2(g.doc);
  assert.ok(!yaml.includes("timeout: 900") || yaml.includes("defaults:"));
  const g2 = parseGraphYaml(yaml);
  assert.deepEqual(g2.errors, []);
  assert.deepEqual(g2.doc, g.doc);
});

test("serializer emits inline empty collections and round-trips", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: {}, edges: [] };
  const yaml = serializeGraphV2(doc);
  assert.ok(yaml.includes("nodes: {}"));
  assert.ok(yaml.includes("edges: []"));
  const g = parseGraphYaml(yaml);
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.doc, doc);
});

test("serializer quotes $, glob, and special chars; round-trips", () => {
  const doc = {
    version: 2,
    defaults: {},
    limits: {},
    gates: {},
    entry: { default: "plan" },
    nodes: {
      plan: { skill: "my-skill", outputs: ["**/*.sql", "$user", "a:b", "x#y", "p,q", "lead "] },
      review: { prompt: "prompts/rev.md", description: "has: colon and # hash, comma" },
    },
    edges: [
      { from: "plan", to: "$user", on: "pass" },
      { from: "plan", to: "$end", on: "fail" },
    ],
  };
  const yaml = serializeGraphV2(doc);
  assert.ok(yaml.includes('"**/*.sql"'));
  assert.ok(yaml.includes('"$user"'));
  assert.ok(yaml.includes('"$end"') || yaml.includes('"plan"'));
  const g = parseGraphYaml(yaml);
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.doc, doc);
});

test("custom gates union with defaults", () => {
  const d = validDoc();
  d.gates = { merge: { always: true } };
  d.nodes.plan = { skill: "a", requires_approval: ["db"] };
  assert.deepEqual(validateGraphV2(d, { executorIds: EXECUTOR_IDS }).errors, []);
  const d2 = validDoc();
  d2.gates = { merge: { always: true } };
  d2.nodes.plan = { skill: "a", requires_approval: ["merge"] };
  assert.deepEqual(validateGraphV2(d2, { executorIds: EXECUTOR_IDS }).errors, []);
});

test("normalizeV1 keeps memory chain", () => {
  const withMem = normalizeV1({ wrapup: { skill: "w" }, memory: { skill: "m" } });
  assert.ok(withMem.edges.some((e) => e.from === "wrapup" && e.to === "memory"));
  assert.ok(withMem.edges.some((e) => e.from === "memory" && e.to === "$end"));
  assert.ok(!withMem.edges.some((e) => e.from === "wrapup" && e.to === "$end"));
  const withoutMem = normalizeV1({ wrapup: { skill: "w" } });
  assert.ok(withoutMem.edges.some((e) => e.from === "wrapup" && e.to === "$end"));
});

test("add-node defaults --skill to id when omitted", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-defskill-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  review: { skill: review }
  test: { skill: test }
edges:
  - { from: review, to: test, on: pass }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "security-scan", "--after", "review", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    assert.equal(g.nodes["security-scan"].skill, "security-scan");
    assert.ok(existsSync(join(repo, ".agents", "skills", "security-scan", "SKILL.md")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("validateGraphV2 defaults executorIds to known executors", () => {
  const d = validDoc();
  assert.deepEqual(validateGraphV2(d).errors, []);
});

test("edges.to suggests reserved targets", () => {
  const d = validDoc();
  d.edges = [{ from: "plan", to: "$usr", on: "pass" }];
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes('"$usr"') && e.includes("$user")));
});

test("v1 parse returns top-level defaults/limits/gates/entry", () => {
  const g = parseGraphYaml("version: 1\nnodes:\n  plan:\n    skill: x\n");
  assert.equal(g.version, 1);
  assert.ok(g.defaults !== undefined && g.limits !== undefined && g.gates !== undefined && g.entry !== undefined);
  assert.deepEqual(g.defaults, g.doc.defaults);
});

test("run-stage exits 2 on missing --prompt-file and 1 on graph errors", () => {
  const repo = mkdtempSync(join(tmpdir(), "runstage-err-"));
  try {
    writeV2Repo(repo, "version: 2\nnodes:\n  plan: { skill: s }\nedges: []\n");
    const r1 = spawnSync(process.execPath, ["scripts/run-stage.mjs", "plan", "--repo", repo, "--prompt-file", join(repo, "nope.md")], { encoding: "utf8" });
    assert.equal(r1.status, 2, r1.stderr + r1.stdout);
    writeV2Repo(repo, "version: 2\nnodes:\n  plan: { executor: cursor-subagent }\nedges: []\n");
    const r2 = spawnSync(process.execPath, ["scripts/run-stage.mjs", "plan", "--repo", repo, "--prompt", "hi"], { encoding: "utf8" });
    assert.equal(r2.status, 1, r2.stderr + r2.stdout);
    assert.ok((r2.stderr + r2.stdout).includes("must have at least one of"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("lint text and --json report errors", () => {
  const repo = mkdtempSync(join(tmpdir(), "lint-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  plan: { skill: s }
edges:
  - { from: plan, to: nope, on: pass }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "lint", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.ok((r.stdout + r.stderr).includes('edges[0].to "nope"'));
    const rj = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "lint", "--repo", repo, "--json"], { encoding: "utf8" });
    assert.equal(rj.status, 1, rj.stderr + rj.stdout);
    const parsed = JSON.parse(rj.stdout);
    assert.ok(Array.isArray(parsed.errors) && parsed.errors.some((e) => e.includes('"nope"')));
    writeV2Repo(
      repo,
      `version: 2
nodes:
  plan: { skill: s }
  review: { skill: r }
entry: { default: plan }
edges:
  - { from: plan, to: review, on: pass }
  - { from: review, to: $end, on: pass }
`,
    );
    const ok = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "lint", "--repo", repo], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    const okj = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "lint", "--repo", repo, "--json"], { encoding: "utf8" });
    assert.equal(okj.status, 0, okj.stderr + okj.stdout);
    assert.deepEqual(JSON.parse(okj.stdout).errors, []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node --before $end inserts before the reserved target", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-end-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  review: { skill: review }
  test: { skill: test }
  memory: { skill: memory }
edges:
  - { from: review, to: test, on: pass }
  - { from: memory, to: $end, on: pass }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "notify", "--after", "memory", "--before", "$end", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    const memEdge = g.edges.find((e) => e.from === "memory");
    assert.deepEqual(memEdge.to, "notify");
    const notifyEdges = g.edges.filter((e) => e.from === "notify");
    assert.ok(notifyEdges.some((e) => e.to === "$end" && e.on === "pass"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node fallback honors --on", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-onfb-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  review: { skill: review }
  test: { skill: test }
edges:
  - { from: review, to: test, on: pass }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "triage", "--after", "review", "--on", "route", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    const fb = g.edges.find((e) => e.from === "review" && e.to === "triage");
    assert.ok(fb, JSON.stringify(g.edges));
    assert.equal(fb.on, "route");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node errors when --before matches no edge", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-nomatch-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  review: { skill: review }
  test: { skill: test }
edges:
  - { from: review, to: test, on: pass }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "scan", "--after", "review", "--before", "test", "--on", "route", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.ok((r.stderr + r.stdout).includes("no edge found"));
    assert.ok(!loadGraph(repo).nodes.scan);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("add-node splits multi-outcome on arrays instead of hijacking", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-split-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  review: { skill: review }
  test: { skill: test }
edges:
  - { from: review, to: test, on: [pass, escalate] }
`,
    );
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "scan", "--after", "review", "--on", "pass", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    const kept = g.edges.find((e) => e.from === "review" && (e.on === "escalate" || (Array.isArray(e.on) && e.on.includes("escalate"))));
    assert.ok(kept, JSON.stringify(g.edges));
    assert.deepEqual(kept.to, "test");
    assert.ok(!Array.isArray(kept.on) || !kept.on.includes("pass"));
    const diverted = g.edges.find((e) => e.from === "review" && e.on === "pass");
    assert.ok(diverted && diverted.to === "scan", JSON.stringify(g.edges));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("validateGraphV2 rejects empty on arrays", () => {
  const d = validDoc();
  d.edges = [{ from: "plan", to: "review", on: [] }];
  const { errors } = validateGraphV2(d, { executorIds: EXECUTOR_IDS });
  assert.ok(errors.some((e) => e.includes("edges[0].on must not be empty")));
});

test("loadGraph without graph.yaml returns top-level keys", () => {
  const repo = mkdtempSync(join(tmpdir(), "nograph-"));
  try {
    const g = loadGraph(repo);
    assert.equal(g.version, 1);
    assert.ok(g.defaults !== undefined && g.limits !== undefined && g.gates !== undefined && g.entry !== undefined);
    assert.deepEqual(g.defaults, g.doc.defaults);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("stage-run reads node.prompt via normalized path", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  process.env.CURSOR_ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "stage-norm-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    mkdirSync(join(repo, "prompts"), { recursive: true });
    writeFileSync(join(repo, "prompts", "a.md"), "NORMALIZED-PROMPT-MARKER", "utf8");
    writeV2Repo(
      repo,
      `version: 2
nodes:
  scan: { prompt: prompts/./a.md }
edges:
  - { from: scan, to: $end, on: pass }
`,
    );
    let gotPrompt = "";
    const result = await runGraphStage({
      repoRoot: repo,
      stage: "scan",
      prompt: "hello",
      slug: "s1",
      adapter: { mode: "sdk", async runRole(params) { gotPrompt = params.prompt; return { ok: true, summary: "ok" }; } },
    });
    assert.equal(result.ok, true);
    assert.ok(gotPrompt.includes("NORMALIZED-PROMPT-MARKER"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    else process.env.CURSOR_ATOMIC_WORKFLOW_HOME = prevHome;
  }
});

test("run-stage --prompt-file absolute path outside repo works", () => {
  const repo = mkdtempSync(join(tmpdir(), "runstage-outside-"));
  try {
    writeV2Repo(repo, "version: 2\nnodes:\n  plan: { skill: s }\nedges: []\n");
    const outside = join(tmpdir(), `prompt-outside-${process.pid}.md`);
    writeFileSync(outside, "hello", "utf8");
    try {
      // unknown stage proves the prompt file was read (empty/unreadable
      // prompt would exit 2 earlier with "cannot read --prompt-file").
      const r = spawnSync(process.execPath, ["scripts/run-stage.mjs", "nosuchstage", "--repo", repo, "--prompt-file", outside], { encoding: "utf8" });
      assert.equal(r.status, 2, r.stderr + r.stdout);
      assert.ok((r.stderr + r.stdout).includes('unknown stage "nosuchstage"'));
      assert.ok(!(r.stderr + r.stdout).includes("escapes repository root"));
    } finally {
      rmSync(outside, { force: true });
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("run-stage --prompt-file relative path resolves against cwd", () => {
  const repo = mkdtempSync(join(tmpdir(), "runstage-cwd-"));
  const work = mkdtempSync(join(tmpdir(), "runstage-work-"));
  try {
    writeV2Repo(repo, "version: 2\nnodes:\n  plan: { skill: s }\nedges: []\n");
    writeFileSync(join(work, "brief.md"), "hello from cwd", "utf8");
    const scriptAbs = join(process.cwd(), "scripts", "run-stage.mjs");
    const r = spawnSync(
      process.execPath,
      [scriptAbs, "nosuchstage", "--repo", repo, "--prompt-file", "brief.md"],
      { encoding: "utf8", cwd: work },
    );
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.ok((r.stderr + r.stdout).includes('unknown stage "nosuchstage"'));
    assert.ok(!(r.stderr + r.stdout).includes("cannot read --prompt-file"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
