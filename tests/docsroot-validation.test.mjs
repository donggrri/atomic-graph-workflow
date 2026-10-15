import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  getWorkflowPaths,
  getShortRepo,
  PROJECT_DOCSROOT_ABSOLUTE_WARNING,
} from "../scripts/work-status.mjs";
import { loadWorkflowSettings } from "../scripts/lib/workflow-settings.mjs";

function withHome(fn) {
  const wfHome = mkdtempSync(join(tmpdir(), "wf-docroot-"));
  const orig = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  process.env.CURSOR_ATOMIC_WORKFLOW_HOME = wfHome;
  try {
    return fn(wfHome);
  } finally {
    rmSync(wfHome, { recursive: true, force: true });
    if (orig !== undefined) process.env.CURSOR_ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  }
}

function writeProject(repo, data) {
  writeFileSync(join(repo, ".cursor-atomic-workflow.json"), JSON.stringify(data), "utf8");
}

test("project docsRoot with '..' falls back to global with a warning", () => {
  const repo = mkdtempSync(join(tmpdir(), "repo-docroot-"));
  try {
    writeProject(repo, { docsRoot: "../evil" });
    withHome((wfHome) => {
      const paths = getWorkflowPaths(repo, "s1");
      assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s1"));
      const warning = paths.docsRootWarning ?? paths.artifactsWarning;
      assert.ok(warning.includes("relative path inside the repository"), String(warning));
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("project docsRoot absolute and ~ values are ignored with the exact warning", () => {
  for (const docsRoot of ["/tmp/abs-docs", "~/docs"]) {
    const repo = mkdtempSync(join(tmpdir(), "repo-docroot-"));
    try {
      writeProject(repo, { docsRoot });
      withHome((wfHome) => {
        const paths = getWorkflowPaths(repo, "s1");
        assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s1"));
        assert.equal(paths.docsRootWarning, PROJECT_DOCSROOT_ABSOLUTE_WARNING);
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("legacy artifacts custom:/abs from project file is warned and ignored", () => {
  const repo = mkdtempSync(join(tmpdir(), "repo-docroot-"));
  try {
    writeProject(repo, { artifacts: { location: "custom", dir: "/data/docs" } });
    withHome((wfHome) => {
      const paths = getWorkflowPaths(repo, "s1");
      assert.equal(paths.docsDir, join(wfHome, "docs", getShortRepo(repo), "s1"));
      const warning = paths.docsRootWarning ?? paths.artifactsWarning;
      assert.ok(typeof warning === "string" && warning.length > 0, String(warning));
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("project docsRoot stays repo-relative when valid", () => {
  const repo = mkdtempSync(join(tmpdir(), "repo-docroot-"));
  try {
    writeProject(repo, { docsRoot: "specs" });
    withHome(() => {
      const paths = getWorkflowPaths(repo, "s1");
      assert.equal(paths.docsDir, join(resolve(repo), "specs", "s1"));
      assert.ok(!("docsRootWarning" in paths));
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("loadWorkflowSettings rejects project '..' but warns on absolute and honors global absolute", () => {
  const home = mkdtempSync(join(tmpdir(), "caw-home-"));
  const repo = mkdtempSync(join(tmpdir(), "caw-repo-"));
  try {
    // Relative '..' from the project file is rejected.
    writeFileSync(join(home, "settings.json"), JSON.stringify({}), "utf8");
    writeProject(repo, { docsRoot: "a/../evil" });
    assert.equal(loadWorkflowSettings({ repoRoot: repo, workflowHome: home }).ok, false);

    // Absolute from the project file is ignored with a warning.
    writeProject(repo, { docsRoot: "/tmp/abs-docs" });
    const ignored = loadWorkflowSettings({ repoRoot: repo, workflowHome: home });
    assert.equal(ignored.ok, true);
    assert.equal(ignored.docsRoot, null);
    assert.ok(ignored.warnings.includes(PROJECT_DOCSROOT_ABSOLUTE_WARNING));

    // Absolute remains allowed from the global settings file.
    writeFileSync(join(home, "settings.json"), JSON.stringify({ docsRoot: "/tmp/g-docs" }), "utf8");
    const fromGlobal = loadWorkflowSettings({ repoRoot: repo, workflowHome: home });
    assert.equal(fromGlobal.ok, true);
    assert.equal(fromGlobal.docsRoot, "/tmp/g-docs");

    // A valid project value wins over the global one.
    writeProject(repo, { docsRoot: "specs" });
    const projectWins = loadWorkflowSettings({ repoRoot: repo, workflowHome: home });
    assert.equal(projectWins.ok, true);
    assert.equal(projectWins.docsRoot, "specs");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("install --artifacts refuses absolute docsRoot pointing to global settings", async () => {
  const { install } = await import("../scripts/install.mjs");
  const target = mkdtempSync(join(tmpdir(), "install-abs-"));
  try {
    await assert.rejects(
      install({ root: ".", target, harness: "cursor", force: true, artifacts: "custom:/tmp/abs-docs" }),
      /global settings/,
    );
    const raw = existsSync(join(target, ".cursor-atomic-workflow.json"))
      ? readFileSync(join(target, ".cursor-atomic-workflow.json"), "utf8")
      : "{}";
    assert.ok(!String(JSON.parse(raw).docsRoot ?? "").startsWith("/tmp/abs-docs"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
