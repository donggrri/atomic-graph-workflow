import test from "node:test";
import assert from "node:assert/strict";
import { resolveExecutorForPhase, defaultExecutorForAdapter } from "../scripts/lib/executors/resolve.mjs";
import { resolveExecutorWithFallback } from "../scripts/lib/executors/availability.mjs";
import { createCompositeRoleRunner } from "../scripts/lib/executors/composite.mjs";
import { createTaskCardAdapter } from "../scripts/lib/adapters/task-card.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const graph = {
  nodes: {
    task: { executor: "cursor-subagent", agent: "tasker" },
    plan: { executor: "agy", agent: "planner" },
  },
};

test("defaultExecutorForAdapter follows adapter mode", () => {
  assert.equal(defaultExecutorForAdapter({ mode: "sdk" }), "cursor-sdk");
  assert.equal(defaultExecutorForAdapter({ mode: "task-card" }), "cursor-subagent");
});

test("resolveExecutorForPhase prefers project settings over graph", () => {
  const a = resolveExecutorForPhase({
    phaseKey: "plan",
    graph,
    settings: { executors: { plan: "codex" } },
    adapter: { mode: "sdk" },
  });
  assert.equal(a.executorId, "codex");
  const b = resolveExecutorForPhase({
    phaseKey: "tasker",
    graph,
    settings: {},
    adapter: { mode: "sdk" },
  });
  assert.equal(b.executorId, "cursor-subagent");
});

test("resolveExecutorWithFallback returns an executor id", () => {
  const res = resolveExecutorWithFallback("agy");
  assert.equal(typeof res.executor, "string");
  assert.ok(res.executor.length > 0);
});

test("resolveExecutorWithFallback keeps pi only when allowPi", () => {
  const blocked = resolveExecutorWithFallback("pi");
  assert.notEqual(blocked.executor, "pi");
  const allowed = resolveExecutorWithFallback("pi", { allowPi: true });
  if (allowed.executor === "pi") {
    assert.equal(allowed.fallbackFrom, null);
  } else {
    assert.equal(allowed.fallbackFrom, "pi");
  }
});

test("composite runner delegates cursor-subagent to task-card", async () => {
  let called = false;
  const adapter = {
    mode: "task-card",
    async runRole() {
      called = true;
      return { ok: true, summary: "card" };
    },
  };
  const runner = createCompositeRoleRunner({
    adapter,
    repoRoot: process.cwd(),
    slug: "t",
    runsDir: "/tmp/atomic-exec-test",
    graph,
    settings: {},
  });
  const result = await runner.runRole({
    role: "tasker",
    prompt: "hi",
    phaseKey: "tasker",
    model: "composer-2.5",
  });
  assert.equal(result.ok, true);
  assert.equal(called, true);
});

test("task-card adapter honors model override", async () => {
  const runs = mkdtempSync(join(tmpdir(), "task-card-model-"));
  const repo = process.cwd();
  try {
    const adapter = createTaskCardAdapter({ runsDir: runs, slug: "s", repoRoot: repo });
    const result = await adapter.runRole({
      role: "worker",
      prompt: "brief",
      model: "custom-override-model",
    });
    assert.equal(result.card.model, "custom-override-model");
  } finally {
    rmSync(runs, { recursive: true, force: true });
  }
});
