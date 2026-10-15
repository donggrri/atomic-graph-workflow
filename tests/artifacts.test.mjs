import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveArtifactsDocsDir,
  parseArtifactsFlag,
} from "../scripts/lib/artifacts.mjs";
import { getWorkflowPaths, getShortRepo } from "../scripts/work-status.mjs";

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("home default resolves under workflow home", () => {
  const wf = join(tmpdir(), "wf-home-default");
  const res = resolveArtifactsDocsDir({
    repoRoot: "/repo/my-repo",
    slug: "s1",
    shortRepo: "my-repo",
    workflowRoot: wf,
    settings: null,
    env: {},
  });
  assert.equal(res.ok, true);
  assert.equal(res.location, "home");
  assert.equal(res.docsDir, join(wf, "docs", "my-repo", "s1"));
});

test("missing artifacts block falls back to home", () => {
  const wf = "/tmp/wf-x";
  for (const settings of [null, undefined, {}, { artifacts: null }, { profile: "atomic" }]) {
    const res = resolveArtifactsDocsDir({
      repoRoot: "/r/proj",
      slug: "a",
      shortRepo: "proj",
      workflowRoot: wf,
      settings,
      env: {},
    });
    assert.equal(res.ok, true, JSON.stringify(settings));
    assert.equal(res.location, "home");
  }
});

test("repo location uses dir or specs default", () => {
  const repo = resolve(join(tmpdir(), "repo-pick"));
  const wf = join(tmpdir(), "wf-pick");
  const dflt = resolveArtifactsDocsDir({
    repoRoot: repo,
    slug: "s",
    shortRepo: "short",
    workflowRoot: wf,
    settings: { artifacts: { location: "repo" } },
    env: {},
  });
  assert.equal(dflt.ok, true);
  assert.equal(dflt.docsDir, join(repo, "specs", "s"));

  const custom = resolveArtifactsDocsDir({
    repoRoot: repo,
    slug: "s",
    shortRepo: "short",
    workflowRoot: wf,
    settings: { artifacts: { location: "repo", dir: "docs/specs" } },
    env: {},
  });
  assert.equal(custom.ok, true);
  assert.equal(custom.docsDir, join(repo, "docs/specs", "s"));
});

test("repo traversal and absolute dir are rejected", () => {
  const repo = "/repo/base";
  const wf = "/wf";
  for (const dir of ["../evil", "a/../../b", "/abs/path"]) {
    const res = resolveArtifactsDocsDir({
      repoRoot: repo,
      slug: "s",
      shortRepo: "base",
      workflowRoot: wf,
      settings: { artifacts: { location: "repo", dir } },
      env: {},
    });
    assert.equal(res.ok, false, dir);
    assert.match(res.reason, /relative path inside the repository/);
    assert.match(res.reason, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("custom location requires absolute dir", () => {
  const ok = resolveArtifactsDocsDir({
    repoRoot: "/r",
    slug: "s",
    shortRepo: "sr",
    workflowRoot: "/wf",
    settings: { artifacts: { location: "custom", dir: "/data/docs" } },
    env: {},
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.docsDir, join("/data/docs", "sr", "s"));

  for (const dir of ["relative/path", "", null, undefined]) {
    const res = resolveArtifactsDocsDir({
      repoRoot: "/r",
      slug: "s",
      shortRepo: "sr",
      workflowRoot: "/wf",
      settings: { artifacts: { location: "custom", dir } },
      env: {},
    });
    assert.equal(res.ok, false, String(dir));
    assert.equal(res.reason, `artifacts.dir must be an absolute path when artifacts.location is "custom"`);
  }
});

test("unknown location lists allowed values", () => {
  const res = resolveArtifactsDocsDir({
    repoRoot: "/r",
    slug: "s",
    shortRepo: "sr",
    workflowRoot: "/wf",
    settings: { artifacts: { location: "cloud" } },
    env: {},
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /home/);
  assert.match(res.reason, /repo/);
  assert.match(res.reason, /custom/);
});

test("CURSOR_ATOMIC_ARTIFACTS_DIR override acts as custom", () => {
  const res = resolveArtifactsDocsDir({
    repoRoot: "/repo/a",
    slug: "s",
    shortRepo: "a",
    workflowRoot: "/wf",
    settings: { artifacts: { location: "repo", dir: "specs" } },
    env: { CURSOR_ATOMIC_ARTIFACTS_DIR: "/override/docs" },
  });
  assert.equal(res.ok, true);
  assert.equal(res.location, "custom");
  assert.equal(res.docsDir, join("/override/docs", "a", "s"));
});

test("parseArtifactsFlag supports home, repo[:dir], custom:/abs", () => {
  assert.deepEqual(parseArtifactsFlag("home"), { ok: true, artifacts: { location: "home" } });
  const repo = parseArtifactsFlag("repo");
  assert.equal(repo.ok, true);
  assert.equal(repo.artifacts.location, "repo");
  const repoDir = parseArtifactsFlag("repo:docs/specs");
  assert.equal(repoDir.ok, true);
  assert.deepEqual(repoDir.artifacts, { location: "repo", dir: "docs/specs" });
  const custom = parseArtifactsFlag("custom:/abs/path");
  assert.equal(custom.ok, true);
  assert.deepEqual(custom.artifacts, { location: "custom", dir: "/abs/path" });
  assert.equal(parseArtifactsFlag("custom:relative").ok, false);
  assert.equal(parseArtifactsFlag("repo:../evil").ok, false);
  assert.equal(parseArtifactsFlag("bogus").ok, false);
});

test("getWorkflowPaths integration honors repo setting, keeps runsDir in home", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-art-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-art-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  const origOverride = process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ artifacts: { location: "repo", dir: "specs" } }),
      "utf8",
    );
    const slug = "demo";
    const paths = getWorkflowPaths(repo, slug);
    assert.equal(paths.docsDir, join(resolve(repo), "specs", slug));
    assert.equal(paths.statusJson, join(resolve(repo), "specs", slug, "STATUS.json"));
    assert.equal(paths.runsDir, join(wfHome, "runs", getShortRepo(repo), slug));
    assert.ok(paths.runsDir.startsWith(wfHome));
    assert.ok(!("artifactsWarning" in paths));
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    if (origOverride !== undefined) process.env.CURSOR_ATOMIC_ARTIFACTS_DIR = origOverride;
    else delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  }
});

test("getWorkflowPaths falls back to home on invalid JSON with no throw", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-art2-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-art2-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  const origOverride = process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
    writeFileSync(join(repo, ".cursor-atomic-workflow.json"), "{invalid", "utf8");
    const paths = getWorkflowPaths(repo, "s9");
    assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s9"));
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    if (origOverride !== undefined) process.env.CURSOR_ATOMIC_ARTIFACTS_DIR = origOverride;
    else delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  }
});

test("getWorkflowPaths falls back to home with artifactsWarning on invalid values", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-art3-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-art3-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  const origOverride = process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ artifacts: { location: "nope" } }),
      "utf8",
    );
    const paths = getWorkflowPaths(repo, "s8");
    assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s8"));
    assert.ok(typeof paths.artifactsWarning === "string" && paths.artifactsWarning.length > 0);
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    if (origOverride !== undefined) process.env.CURSOR_ATOMIC_ARTIFACTS_DIR = origOverride;
    else delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  }
});

test("install --artifacts flag parses and writes JSON merged with other keys", async () => {
  const { parseInstallArgs, install } = await import("../scripts/install.mjs");
  const opts = parseInstallArgs(["--harness", "cursor", "--artifacts", "repo:specs"]);
  assert.equal(opts.artifacts, "repo:specs");
  const target = mkdtempSync(join(tmpdir(), "install-art-"));
  try {
    writeFileSync(join(target, ".cursor-atomic-workflow.json"), JSON.stringify({ profile: "atomic" }), "utf8");
    await install({ root: ".", target, harness: "cursor", force: true, artifacts: opts.artifacts });
    const data = JSON.parse(readFileSync(join(target, ".cursor-atomic-workflow.json"), "utf8"));
    assert.equal(data.profile, "atomic");
    assert.equal(data.artifacts.location, "repo");
    assert.ok(existsSync(join(target, ".atomic", "scripts", "work-status.mjs")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("project-setup --artifacts writes JSON merged with other keys", async () => {
  const { runProjectSetup } = await import("../scripts/project-setup.mjs");
  const repo = mkdtempSync(join(tmpdir(), "setup-art-"));
  const wfHome = mkdtempSync(join(tmpdir(), "wf-setup-art-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  const origTrust = process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
  const origOverride = process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    process.env.CURSOR_ATOMIC_TRUST_COMMANDS = "1";
    delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    const res = await runProjectSetup(repo, { interactive: false, artifacts: "custom:/tmp/abs-docs", skipDoctor: true });
    assert.equal(res.settings.artifacts.location, "custom");
    assert.equal(res.settings.artifacts.dir, "/tmp/abs-docs");
    const data = JSON.parse(readFileSync(join(repo, ".cursor-atomic-workflow.json"), "utf8"));
    assert.equal(data.artifacts.location, "custom");
    assert.equal(data.artifacts.dir, "/tmp/abs-docs");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wfHome, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    if (origTrust !== undefined) process.env.CURSOR_ATOMIC_TRUST_COMMANDS = origTrust;
    else delete process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
    if (origOverride !== undefined) process.env.CURSOR_ATOMIC_ARTIFACTS_DIR = origOverride;
    else delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  }
});

test("global settings artifacts is used when project has none", async () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-g-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-g-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  const origOverride = process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
    writeFileSync(
      join(wfHome, "settings.json"),
      JSON.stringify({ artifacts: { location: "custom", dir: join(wfHome, "shared-docs") } }),
      "utf8",
    );
    const paths = getWorkflowPaths(repo, "gslug");
    assert.equal(paths.docsDir, join(wfHome, "shared-docs", getShortRepo(repo), "gslug"));

    const { loadWorkflowSettings } = await import("../scripts/lib/workflow-settings.mjs");
    const loaded = loadWorkflowSettings({ repoRoot: repo, workflowHome: wfHome });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.artifacts.location, "custom");
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    if (origOverride !== undefined) process.env.CURSOR_ATOMIC_ARTIFACTS_DIR = origOverride;
    else delete process.env.CURSOR_ATOMIC_ARTIFACTS_DIR;
  }
});

void withEnv;
