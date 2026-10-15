import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { artifactsRepoNote, DEFAULT_REPO_ARTIFACTS_DIR } from "../scripts/lib/artifacts.mjs";
import { validateGraphV2 } from "../scripts/lib/graph-schema.mjs";
import { loadGraph } from "../scripts/lib/graph.mjs";
import { runGraphStage, READONLY_ROLE_KEY } from "../scripts/lib/stage-run.mjs";
import { ROLES } from "../scripts/lib/roles.mjs";

function writeV2Repo(repo, text) {
  mkdirSync(join(repo, ".atomic"), { recursive: true });
  writeFileSync(join(repo, ".atomic", "graph.yaml"), text, "utf8");
}

// (a) artifacts in-repo guidance
test("artifactsRepoNote recommends committing specs dir", () => {
  assert.equal(
    artifactsRepoNote("specs"),
    "artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)",
  );
  assert.equal(
    artifactsRepoNote("docs/specs"),
    "artifacts: docs/specs/ is inside the repo; commit it with your code (do not add it to .gitignore)",
  );
  assert.equal(artifactsRepoNote(), `artifacts: ${DEFAULT_REPO_ARTIFACTS_DIR}/ is inside the repo; commit it with your code (do not add it to .gitignore)`);
});

test("docs recommend committing the in-repo specs dir", () => {
  for (const f of ["README.md", "README.kr.md", "skills/atomic-setup/SKILL.md"]) {
    const text = readFileSync(f, "utf8");
    assert.ok(text.includes("commit"), `${f} should mention commit`);
    assert.ok(text.includes(".gitignore"), `${f} should mention .gitignore`);
    assert.ok(
      text.includes("commit it with your code (do not add it to .gitignore)"),
      `${f} should include the in-repo note`,
    );
  }
});

test("install with repo artifacts prints the one-line note and never touches .gitignore", async () => {
  const { install } = await import("../scripts/install.mjs");
  const target = mkdtempSync(join(tmpdir(), "install-note-"));
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    writeFileSync(join(target, ".gitignore"), "node_modules/\n", "utf8");
    await install({ root: ".", target, harness: "cursor", force: true, artifacts: "repo:specs" });
  } finally {
    console.log = origLog;
  }
  try {
    const out = lines.join("\n");
    assert.ok(out.includes("artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)"), out);
    const gi = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(!gi.includes("specs"), `.gitignore must not mention specs: ${gi}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("project-setup with repo artifacts prints the one-line note", async () => {
  const { runProjectSetup } = await import("../scripts/project-setup.mjs");
  const repo = mkdtempSync(join(tmpdir(), "setup-note-"));
  const wfHome = mkdtempSync(join(tmpdir(), "wf-note-"));
  const prevHome = process.env.ATOMIC_WORKFLOW_HOME;
  const prevTrust = process.env.ATOMIC_TRUST_COMMANDS;
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    process.env.ATOMIC_WORKFLOW_HOME = wfHome;
    process.env.ATOMIC_TRUST_COMMANDS = "1";
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    await runProjectSetup(repo, { interactive: false, artifacts: "repo:specs", skipDoctor: true });
  } finally {
    console.log = origLog;
    if (prevHome !== undefined) process.env.ATOMIC_WORKFLOW_HOME = prevHome;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
    if (prevTrust !== undefined) process.env.ATOMIC_TRUST_COMMANDS = prevTrust;
    else delete process.env.ATOMIC_TRUST_COMMANDS;
  }
  try {
    const out = lines.join("\n");
    assert.ok(out.includes("artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)"), out);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wfHome, { recursive: true, force: true });
  }
});

// (b) readonly nodes
test("validateGraphV2: readonly must be boolean", () => {
  const base = () => ({
    version: 2,
    defaults: {},
    limits: {},
    gates: {},
    entry: { default: "plan" },
    nodes: { plan: { skill: "a" }, review: { skill: "r" } },
    edges: [{ from: "plan", to: "review", on: "pass" }],
  });
  const okMissing = validateGraphV2(base());
  assert.deepEqual(okMissing.errors, []);
  const okTrue = validateGraphV2({ ...base(), nodes: { ...base().nodes, plan: { skill: "a", readonly: true } } });
  assert.deepEqual(okTrue.errors, []);
  const okFalse = validateGraphV2({ ...base(), nodes: { ...base().nodes, plan: { skill: "a", readonly: false } } });
  assert.deepEqual(okFalse.errors, []);
  for (const bad of ["yes", 1, 0, null, {}]) {
    const d = base();
    d.nodes.plan = { skill: "a", readonly: bad };
    const { errors } = validateGraphV2(d);
    assert.ok(errors.some((e) => e.includes("nodes.plan.readonly must be a boolean")), JSON.stringify({ bad, errors }));
  }
});

test("readonly role key uses existing reviewer-like role", () => {
  assert.ok(ROLES["reviewer"], "reviewer role should exist");
  assert.equal(READONLY_ROLE_KEY, "reviewer");
});

test("add-node --readonly sets readonly flag", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-ro-"));
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
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "audit", "--after", "review", "--readonly", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const g = loadGraph(repo);
    assert.deepEqual(g.errors, []);
    assert.equal(g.nodes.audit.readonly, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("stage-run readonly custom node uses read-only role and mode line", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.ATOMIC_WORKFLOW_HOME;
  process.env.ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "stage-ro-"));
  try {
    writeV2Repo(
      repo,
      `version: 2
nodes:
  audit: { skill: audit, readonly: true }
  plain: { skill: plain }
edges:
  - { from: audit, to: $end, on: pass }
  - { from: plain, to: $end, on: pass }
`,
    );
    let gotRole = "";
    let gotPrompt = "";
    const ro = await runGraphStage({
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
    assert.equal(ro.ok, true);
    assert.equal(gotRole, "reviewer");
    assert.ok(gotPrompt.includes("Mode: read-only. Do not modify files; report findings only."));
    let gotRole2 = "";
    let gotPrompt2 = "";
    const normal = await runGraphStage({
      repoRoot: repo,
      stage: "plain",
      prompt: "check this",
      slug: "s1",
      adapter: {
        mode: "sdk",
        async runRole(params) {
          gotRole2 = params.role;
          gotPrompt2 = params.prompt;
          return { ok: true, summary: "ok" };
        },
      },
    });
    assert.equal(normal.ok, true);
    assert.equal(gotRole2, "worker");
    assert.ok(!gotPrompt2.includes("Mode: read-only"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.ATOMIC_WORKFLOW_HOME;
    else process.env.ATOMIC_WORKFLOW_HOME = prevHome;
  }
});

// (c) v1 auto-migrate keeps node fields
test("add-node v1 migration keeps node fields", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-v1keep-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    const original = "version: 1\nnodes:\n  review:\n    skill: x\n    description: keeps-me\n";
    writeFileSync(join(repo, ".atomic", "graph.yaml"), original, "utf8");
    const r = spawnSync(process.execPath, ["scripts/lib/graph.mjs", "add-node", "scan", "--after", "review", "--repo", repo], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok((r.stdout + r.stderr).includes("migrated graph.yaml v1 -> v2 (backup: graph.yaml.v1.bak)"));
    const g = loadGraph(repo);
    assert.equal(g.version, 2);
    assert.ok(g.nodes.scan);
    assert.equal(String(g.nodes.review.skill), "x");
    assert.equal(String(g.nodes.review.description), "keeps-me");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
