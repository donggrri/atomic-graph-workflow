import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { normalizeV1, validateGraphV2 } from "../scripts/lib/graph-schema.mjs";
import { parseGraphYaml, loadGraph } from "../scripts/lib/graph.mjs";
import { artifactsRepoNote } from "../scripts/lib/artifacts.mjs";
import { runGraphStage, READONLY_ROLE_KEY } from "../scripts/lib/stage-run.mjs";

function writeV2Repo(repo, text) {
  mkdirSync(join(repo, ".atomic"), { recursive: true });
  writeFileSync(join(repo, ".atomic", "graph.yaml"), text, "utf8");
}

// #1: router-only-next migrates to valid v2 node
test("#1 normalizeV1 gives router-like nodes a router skill and drops next", () => {
  const doc = normalizeV1({
    router: { next: ["lite", "explore"] },
    lite: { skill: "atomic-lite" },
    explore: { skill: "atomic-explore" },
    execute: { skill: "atomic-execute" },
  });
  assert.equal(doc.nodes.router.skill, "atomic-router");
  assert.ok(!("next" in doc.nodes.router));
  const { errors } = validateGraphV2(doc);
  assert.ok(!errors.some((e) => e.includes("nodes.router")), errors.join("\n"));
});

test("#1 add-node on default v1 graph with bare router succeeds", () => {
  const repo = mkdtempSync(join(tmpdir(), "rv4-router-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    const original = "version: 1\nnodes:\n  router:\n    next: [lite, explore]\n  lite:\n    skill: atomic-lite\n  explore:\n    skill: atomic-explore\n";
    writeFileSync(join(repo, ".atomic", "graph.yaml"), original, "utf8");
    const r = spawnSync(
      process.execPath,
      ["scripts/lib/graph.mjs", "add-node", "scan", "--after", "lite", "--repo", repo],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    assert.equal(g.nodes.router.skill, "atomic-router");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// #2: no .v1.bak and no migration log on validation failure
test("#2 failed add-node on v1 writes no .v1.bak and logs no migration", () => {
  const repo = mkdtempSync(join(tmpdir(), "rv4-nobak-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    const original = "version: 1\nnodes:\n  review:\n    skill: x\n";
    writeFileSync(join(repo, ".atomic", "graph.yaml"), original, "utf8");
    const r = spawnSync(
      process.execPath,
      ["scripts/lib/graph.mjs", "add-node", "scan", "--after", "nope", "--repo", repo],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.ok(!existsSync(join(repo, ".atomic", "graph.yaml.v1.bak")));
    assert.ok(!(r.stdout + r.stderr).includes("migrated graph.yaml v1 -> v2"));
    assert.equal(readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8"), original);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("#2 v1 --dry-run failure writes nothing and logs no migration", () => {
  const repo = mkdtempSync(join(tmpdir(), "rv4-dryfail-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    const original = "version: 1\nnodes:\n  review:\n    skill: x\n";
    writeFileSync(join(repo, ".atomic", "graph.yaml"), original, "utf8");
    const r = spawnSync(
      process.execPath,
      ["scripts/lib/graph.mjs", "add-node", "scan", "--after", "nope", "--repo", repo, "--dry-run"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.ok(!existsSync(join(repo, ".atomic", "graph.yaml.v1.bak")));
    assert.ok(!(r.stdout + r.stderr).includes("migrated graph.yaml v1 -> v2"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// #3: typed scalar coercion during normalization
test("#3 normalizeV1 coerces timeout/terminal_hook/readonly strings", () => {
  const doc = normalizeV1({
    plan: { skill: "x", timeout: "600", terminal_hook: "false", readonly: "true" },
  });
  assert.equal(doc.nodes.plan.timeout, 600);
  assert.equal(doc.nodes.plan.terminal_hook, false);
  assert.equal(doc.nodes.plan.readonly, true);
  const { errors } = validateGraphV2({
    version: 2,
    defaults: {},
    limits: {},
    gates: {},
    entry: {},
    nodes: { plan: doc.nodes.plan },
    edges: [],
  });
  assert.deepEqual(errors, []);
});

test("#3 v1 text with typed scalars migrates cleanly", () => {
  const g = parseGraphYaml(
    "version: 1\nnodes:\n  plan:\n    skill: x\n    timeout: 600\n    readonly: true\n",
  );
  assert.equal(g.doc.nodes.plan.timeout, 600);
  assert.equal(g.doc.nodes.plan.readonly, true);
});

// #4: readonly enforced even with agent
test("#4 readonly custom node with agent uses reviewer role and mode line", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.ATOMIC_WORKFLOW_HOME;
  process.env.ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "rv4-roagent-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  audit: { skill: audit, agent: worker, readonly: true }
edges:
  - { from: audit, to: $end, on: pass }
`,
    );
    let gotRole = "";
    let gotPrompt = "";
    const res = await runGraphStage({
      repoRoot: repo,
      stage: "audit",
      prompt: "check this",
      slug: "s1",
      adapter: {
        mode: "sdk",
        async runRole(params) {
          gotRole = params.role;
          gotPrompt = params.prompt;
          return { ok: true, summary: "ok" };
        },
      },
    });
    assert.equal(res.ok, true);
    assert.equal(gotRole, READONLY_ROLE_KEY);
    assert.ok(gotPrompt.includes("Mode: read-only. Do not modify files; report findings only."));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.ATOMIC_WORKFLOW_HOME;
    else process.env.ATOMIC_WORKFLOW_HOME = prevHome;
  }
});

test("#4 readonly built-in stage with agent enforces reviewer role", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.ATOMIC_WORKFLOW_HOME;
  process.env.ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "rv4-robuiltin-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  plan: { skill: atomic-plan, agent: planner, readonly: true }
  review: { skill: atomic-review }
edges:
  - { from: plan, to: review, on: pass }
`,
    );
    let gotRole = "";
    let gotPrompt = "";
    const res = await runGraphStage({
      repoRoot: repo,
      stage: "plan",
      prompt: "hello",
      slug: "s1",
      adapter: {
        mode: "sdk",
        async runRole(params) {
          gotRole = params.role;
          gotPrompt = params.prompt;
          return { ok: true, summary: "ok" };
        },
      },
    });
    assert.equal(res.ok, true);
    assert.equal(gotRole, "reviewer");
    assert.ok(gotPrompt.includes("Mode: read-only"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.ATOMIC_WORKFLOW_HOME;
    else process.env.ATOMIC_WORKFLOW_HOME = prevHome;
  }
});

// #5: single kept target collapses to scalar
test("#5 normalizeV1 collapses single kept target to scalar", () => {
  const doc = normalizeV1({
    router: { next: ["lite", "explore"] },
    lite: { skill: "l" },
  });
  const edge = doc.edges.find((e) => e.from === "router");
  assert.ok(edge);
  assert.equal(edge.to, "lite");
});

// #6: trailing slash
test("#6 artifactsRepoNote strips trailing slash", () => {
  assert.equal(
    artifactsRepoNote("specs/"),
    "artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)",
  );
  assert.equal(
    artifactsRepoNote("docs/specs/"),
    "artifacts: docs/specs/ is inside the repo; commit it with your code (do not add it to .gitignore)",
  );
});

// #7: effective artifacts note when already configured
test("#7 runProjectSetup shows repo note when already configured", async () => {
  const { runProjectSetup } = await import("../scripts/project-setup.mjs");
  const repo = mkdtempSync(join(tmpdir(), "rv4-setup-"));
  const wfHome = mkdtempSync(join(tmpdir(), "rv4-wf-"));
  const prevHome = process.env.ATOMIC_WORKFLOW_HOME;
  const prevTrust = process.env.ATOMIC_TRUST_COMMANDS;
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    process.env.ATOMIC_WORKFLOW_HOME = wfHome;
    process.env.ATOMIC_TRUST_COMMANDS = "1";
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "x" } }), "utf8");
    writeFileSync(
      join(repo, ".atomic-workflow.json"),
      JSON.stringify({ artifacts: { location: "repo", dir: "specs" } }),
      "utf8",
    );
    await runProjectSetup(repo, { interactive: false, skipDoctor: true });
  } finally {
    console.log = origLog;
    if (prevHome !== undefined) process.env.ATOMIC_WORKFLOW_HOME = prevHome;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
    if (prevTrust !== undefined) process.env.ATOMIC_TRUST_COMMANDS = prevTrust;
    else delete process.env.ATOMIC_TRUST_COMMANDS;
  }
  try {
    assert.ok(
      lines.join("\n").includes("artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)"),
      lines.join("\n"),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wfHome, { recursive: true, force: true });
  }
});

// #8: single artifacts note (install prints once; install-cli delegates)
test("#8 install with repo artifacts prints note exactly once", async () => {
  const { install } = await import("../scripts/install.mjs");
  const target = mkdtempSync(join(tmpdir(), "rv4-install-note-"));
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    await install({ root: ".", target, harness: "cursor", force: true, artifacts: "repo:specs" });
  } finally {
    console.log = origLog;
  }
  try {
    const count = lines.filter((l) => l.includes("artifacts: specs/ is inside the repo")).length;
    assert.equal(count, 1, lines.join("\n"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("#8 install-cli consumes --artifacts flag after persisting (no double note)", () => {
  const text = readFileSync("scripts/install-cli.mjs", "utf8");
  assert.ok(text.includes("delete opts.artifacts"), "install-cli must clear opts.artifacts after writing pending settings");
});
