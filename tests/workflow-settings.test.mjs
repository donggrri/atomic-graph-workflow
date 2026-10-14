import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadWorkflowSettings,
  resolveAgyDecision,
} from "../scripts/lib/workflow-settings.mjs";

test("resolveAgyDecision respects auto, state, then defaults", () => {
  const state = { agyChoice: { plan: "agy" } };
  assert.equal(resolveAgyDecision(state, "plan", { auto: true }, {}), "sdk");
  assert.equal(resolveAgyDecision(state, "plan", {}, {}), "agy");
  assert.equal(
    resolveAgyDecision({}, "implement", {}, { implement: "agy" }),
    "agy",
  );
  assert.equal(resolveAgyDecision({}, "review", {}, { review: "ask" }), null);
});

test("loadWorkflowSettings merges global and project agy", () => {
  const home = mkdtempSync(join(tmpdir(), "caw-settings-"));
  const repo = mkdtempSync(join(tmpdir(), "caw-repo-"));
  try {
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({ agy: { plan: "sdk", implement: "agy" } }),
      "utf8",
    );
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ profile: "atomic", agy: { plan: "agy" } }),
      "utf8",
    );
    const loaded = loadWorkflowSettings({ repoRoot: repo, workflowHome: home });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.agy.plan, "agy");
    assert.equal(loaded.agy.implement, "agy");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("loadWorkflowSettings project agyModel null overrides global", () => {
  const home = mkdtempSync(join(tmpdir(), "caw-home-null-"));
  const repo = mkdtempSync(join(tmpdir(), "caw-repo-null-"));
  try {
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({ agyModel: "global-model" }),
      "utf8",
    );
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ agyModel: null }),
      "utf8",
    );
    const loaded = loadWorkflowSettings({ repoRoot: repo, workflowHome: home });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.agyModel, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("loadWorkflowSettings reads agyModel and testDone from project", () => {
  const repo = mkdtempSync(join(tmpdir(), "caw-repo2-"));
  try {
    writeFileSync(
      join(repo, ".cursor-atomic-workflow.json"),
      JSON.stringify({ agyModel: "gemini-3.8-flash", testDone: "pnpm test" }),
      "utf8",
    );
    const loaded = loadWorkflowSettings({ repoRoot: repo, workflowHome: repo });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.agyModel, "gemini-3.8-flash");
    assert.equal(loaded.testDone, "pnpm test");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
