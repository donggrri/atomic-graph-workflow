import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  parseArtifactsFlag,
  docsRootFromLegacyArtifacts,
  artifactsRepoNote,
  DEFAULT_REPO_ARTIFACTS_DIR,
} from "../scripts/lib/artifacts.mjs";
import { getWorkflowPaths, getShortRepo } from "../scripts/work-status.mjs";

test("artifactsRepoNote recommends committing the in-repo dir", () => {
  assert.equal(
    artifactsRepoNote("specs"),
    "artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)",
  );
  assert.equal(
    artifactsRepoNote("specs/"),
    "artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore)",
  );
  assert.equal(
    artifactsRepoNote(),
    `artifacts: ${DEFAULT_REPO_ARTIFACTS_DIR}/ is inside the repo; commit it with your code (do not add it to .gitignore)`,
  );
});

test("parseArtifactsFlag maps to docsRoot values", () => {
  assert.deepEqual(parseArtifactsFlag("home"), { ok: true, docsRoot: null });
  assert.deepEqual(parseArtifactsFlag("repo"), { ok: true, docsRoot: "specs" });
  assert.deepEqual(parseArtifactsFlag("repo:docs/specs"), { ok: true, docsRoot: "docs/specs" });
  assert.deepEqual(parseArtifactsFlag("repo:specs"), { ok: true, docsRoot: "specs" });
  assert.deepEqual(parseArtifactsFlag("custom:/abs/path"), { ok: true, docsRoot: "/abs/path" });
  assert.equal(parseArtifactsFlag("custom:relative").ok, false);
  assert.equal(parseArtifactsFlag("repo:../evil").ok, false);
  assert.equal(parseArtifactsFlag("repo:/abs").ok, false);
  assert.equal(parseArtifactsFlag("bogus").ok, false);
  assert.equal(parseArtifactsFlag("").ok, false);
});

test("docsRootFromLegacyArtifacts maps deprecated blocks", () => {
  assert.equal(docsRootFromLegacyArtifacts(null), null);
  assert.equal(docsRootFromLegacyArtifacts(undefined), null);
  assert.equal(docsRootFromLegacyArtifacts({ location: "home" }), null);
  assert.equal(docsRootFromLegacyArtifacts({}), null);
  assert.equal(docsRootFromLegacyArtifacts({ location: "repo" }), "specs");
  assert.equal(docsRootFromLegacyArtifacts({ location: "repo", dir: "docs/specs" }), "docs/specs");
  assert.equal(docsRootFromLegacyArtifacts({ location: "custom", dir: "/data/docs" }), "/data/docs");
  assert.equal(docsRootFromLegacyArtifacts({ location: "custom", dir: "relative" }), null);
  assert.equal(docsRootFromLegacyArtifacts({ location: "repo", dir: "../evil" }), null);
  assert.equal(docsRootFromLegacyArtifacts({ location: "nope" }), null);
});

test("getWorkflowPaths honors docsRoot, keeps runsDir in home", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-art-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-art-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ docsRoot: "specs" }),
      "utf8",
    );
    const slug = "demo";
    const paths = getWorkflowPaths(repo, slug);
    assert.equal(paths.docsDir, join(resolve(repo), "specs", slug));
    assert.equal(paths.statusJson, join(resolve(repo), "specs", slug, "STATUS.json"));
    assert.equal(paths.runsDir, join(wfHome, "runs", getShortRepo(repo), slug));
    assert.ok(paths.runsDir.startsWith(wfHome));
    assert.ok(!("docsRootWarning" in paths));
    assert.ok(!("artifactsWarning" in paths));
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  }
});

test("getWorkflowPaths honors legacy artifacts with deprecation warning, no throw", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-leg-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-leg-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ artifacts: { location: "repo", dir: "specs" } }),
      "utf8",
    );
    const paths = getWorkflowPaths(repo, "demo");
    assert.equal(paths.docsDir, join(resolve(repo), "specs", "demo"));
    assert.equal(paths.runsDir, join(wfHome, "runs", getShortRepo(repo), "demo"));
    const warning = paths.docsRootWarning ?? paths.artifactsWarning;
    assert.ok(typeof warning === "string" && warning.includes("deprecated"), String(warning));
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  }
});

test("getWorkflowPaths falls back to home on invalid JSON with no throw", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-art2-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-art2-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    writeFileSync(join(repo, ".cursor-atomic-workflow.json"), "{invalid", "utf8");
    const paths = getWorkflowPaths(repo, "s9");
    assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s9"));
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  }
});

test("getWorkflowPaths falls back to home with warning on invalid legacy values", () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-art3-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-art3-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ artifacts: { location: "nope" } }),
      "utf8",
    );
    const paths = getWorkflowPaths(repo, "s8");
    assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s8"));
    const warning = paths.docsRootWarning ?? paths.artifactsWarning;
    assert.ok(typeof warning === "string" && warning.length > 0);
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  }
});

test("install --artifacts flag parses and writes docsRoot only", async () => {
  const { parseInstallArgs, install } = await import("../scripts/install.mjs");
  const opts = parseInstallArgs(["--harness", "cursor", "--artifacts", "repo:specs"]);
  assert.equal(opts.artifacts, "repo:specs");
  const target = mkdtempSync(join(tmpdir(), "install-art-"));
  try {
    writeFileSync(join(target, ".cursor-atomic-workflow.json"), JSON.stringify({ profile: "atomic" }), "utf8");
    await install({ root: ".", target, harness: "cursor", force: true, artifacts: opts.artifacts });
    const data = JSON.parse(readFileSync(join(target, ".cursor-atomic-workflow.json"), "utf8"));
    assert.equal(data.profile, "atomic");
    assert.equal(data.docsRoot, "specs");
    assert.ok(!("artifacts" in data));
    assert.ok(existsSync(join(target, ".atomic", "scripts", "work-status.mjs")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("install --artifacts home clears docsRoot", async () => {
  const { install } = await import("../scripts/install.mjs");
  const target = mkdtempSync(join(tmpdir(), "install-home-"));
  try {
    writeFileSync(
      join(target, ".cursor-atomic-workflow.json"),
      JSON.stringify({ docsRoot: "specs" }),
      "utf8",
    );
    await install({ root: ".", target, harness: "cursor", force: true, artifacts: "home" });
    const data = JSON.parse(readFileSync(join(target, ".cursor-atomic-workflow.json"), "utf8"));
    assert.ok(!("docsRoot" in data));
    assert.ok(!("artifacts" in data));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("project-setup --artifacts writes docsRoot only", async () => {
  const { runProjectSetup } = await import("../scripts/project-setup.mjs");
  const repo = mkdtempSync(join(tmpdir(), "setup-art-"));
  const wfHome = mkdtempSync(join(tmpdir(), "wf-setup-art-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  const origTrust = process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    process.env.CURSOR_ATOMIC_TRUST_COMMANDS = "1";
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
    const res = await runProjectSetup(repo, { interactive: false, artifacts: "custom:/tmp/abs-docs", skipDoctor: true });
    assert.equal(res.settings.docsRoot, "/tmp/abs-docs");
    assert.ok(!("artifacts" in res.settings));
    const data = JSON.parse(readFileSync(join(repo, ".cursor-atomic-workflow.json"), "utf8"));
    assert.equal(data.docsRoot, "/tmp/abs-docs");
    assert.ok(!("artifacts" in data));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wfHome, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    if (origTrust !== undefined) process.env.CURSOR_ATOMIC_TRUST_COMMANDS = origTrust;
    else delete process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
  }
});

test("legacy artifacts in settings warns instead of failing", async () => {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-warn-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-warn-"));
  const origHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  try {
    process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ artifacts: { location: "repo", dir: "specs" } }),
      "utf8",
    );
    const { loadWorkflowSettings } = await import("../scripts/lib/workflow-settings.mjs");
    const loaded = loadWorkflowSettings({ repoRoot: repo, workflowHome: wfHome });
    assert.equal(loaded.ok, true);
    assert.ok(loaded.warnings.some((w) => w.includes("artifacts") && w.includes("deprecated")));
    assert.ok(!("artifacts" in loaded));
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  }
});
