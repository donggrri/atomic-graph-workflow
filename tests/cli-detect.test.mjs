import test from "node:test";
import assert from "node:assert/strict";
import { detectHarnessClis, detectGitRepo } from "../scripts/lib/cli-detect.mjs";

test("detectHarnessClis returns harness list without throwing", () => {
  const clis = detectHarnessClis();
  assert.ok(clis.length >= 5);
  assert.ok(clis.some((c) => c.id === "cursor"));
  for (const c of clis) {
    assert.equal(typeof c.installed, "boolean");
  }
});

test("detectGitRepo works in package root", () => {
  assert.equal(detectGitRepo(process.cwd()), true);
});
