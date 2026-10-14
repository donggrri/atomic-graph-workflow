import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEffectiveExecutorSettings,
  resolveExecutorTimeoutMin,
} from "../scripts/lib/effective-settings.mjs";

test("applyEffectiveExecutorSettings maps agy policy to stage executors", () => {
  const out = applyEffectiveExecutorSettings({
    agy: { plan: "agy", implement: "agy", review: "sdk" },
    executors: { plan: "codex" },
  });
  assert.equal(out.executors.plan, "codex");
  assert.equal(out.executors["plan-review"], "agy");
  assert.equal(out.executors.execute, "agy");
  assert.equal(out.executors.review, undefined);
});

test("resolveExecutorTimeoutMin reads per-stage minutes", () => {
  assert.equal(resolveExecutorTimeoutMin({ memory: 10 }, "memory", 45), 10);
  assert.equal(resolveExecutorTimeoutMin({}, "memory", 45), 45);
});
