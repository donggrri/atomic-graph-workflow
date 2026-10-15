import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { graphAgentToRoleKey, runGraphStage } from "../scripts/lib/stage-run.mjs";

test("graphAgentToRoleKey maps reviewer agent file", () => {
  assert.equal(graphAgentToRoleKey("atomic-reviewer"), "reviewer");
  assert.equal(graphAgentToRoleKey("memory-curator"), "memory-curator");
});

test("runGraphStage explore uses injected adapter", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
  process.env.CURSOR_ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "stage-run-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    writeFileSync(
      join(repo, ".atomic", "graph.yaml"),
      `version: 1
nodes:
  explore:
    executor: cursor-sdk
    agent: explorer
`,
      "utf8",
    );
    let called = false;
    const result = await runGraphStage({
      repoRoot: repo,
      stage: "explore",
      prompt: "brief",
      slug: "s1",
      adapter: {
        mode: "sdk",
        async runRole() {
          called = true;
          return { ok: true, summary: "ok" };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(called, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.CURSOR_ATOMIC_WORKFLOW_HOME;
    else process.env.CURSOR_ATOMIC_WORKFLOW_HOME = prevHome;
  }
});
