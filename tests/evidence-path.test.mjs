import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evidencePath, runDone } from "../scripts/run-done.mjs";
import { taskLogPath } from "../scripts/run-pipeline.mjs";

const EVIDENCE = "<runsDir>/<id>.done.json";

test("pipeline evidence sits beside <id>.log as <id>.done.json", () => {
  const runsDir = join(
    "/home/me/.cursor-atomic-workflow/runs/repo",
    "slug",
  );
  const logPath = taskLogPath(runsDir, "T1");
  assert.equal(logPath, join(runsDir, "T1.log"));
  assert.equal(evidencePath(logPath), join(runsDir, "T1.done.json"));
});

test("runDone writes <id>.done.json for a .log path", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "evidence-path-"));
  try {
    const logPath = join(tmp, "T1.log");
    const result = await runDone({
      skipTrust: true,
      cwd: tmp,
      command: "echo ok",
      logPath,
      timeoutMs: 5000,
    });
    assert.equal(result.outputPath, join(tmp, "T1.done.json"));
    const summary = JSON.parse(await readFile(result.outputPath, "utf8"));
    assert.equal(summary.ok, true);
    assert.equal(summary.outputPath, join(tmp, "T1.done.json"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CONTEXT.md documents the run-done evidence path", async () => {
  const context = await readFile(
    "skills/atomic-workflow/CONTEXT.md",
    "utf8",
  );
  assert.match(context, new RegExp(EVIDENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(context, /<id>\.log/);
  assert.match(
    context,
    /로그 경로가 `\.log`로 끝나면 그 접미사를 `\.done\.json`으로 바꿔/,
  );
  assert.doesNotMatch(context, /runs\/<slug>\/<id>\.done\.json/);
});
