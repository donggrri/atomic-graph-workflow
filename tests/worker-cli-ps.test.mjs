import test from "node:test";
import assert from "node:assert/strict";
import { buildWindowsInvokeWorkerArgv } from "../scripts/lib/executors/worker-cli.mjs";

test("buildWindowsInvokeWorkerArgv uses PowerShell parameter names", () => {
  const argv = buildWindowsInvokeWorkerArgv({
    worker: "agy",
    repoRoot: "C:\\proj",
    promptFile: "C:\\runs\\brief.md",
    logFile: "C:\\runs\\out.log",
    timeoutMin: 30,
    model: "gpt-test",
  });
  assert.ok(argv.includes("-NoProfile"));
  assert.ok(argv.includes("-File"));
  assert.ok(argv.includes("-Worker"));
  assert.ok(argv.includes("-Workspace"));
  assert.ok(argv.includes("-PromptFile"));
  assert.ok(argv.includes("-LogFile"));
  assert.ok(argv.includes("-TimeoutMin"));
  assert.ok(argv.includes("-Model"));
  const fileIdx = argv.indexOf("-File");
  assert.ok(fileIdx >= 0 && argv[fileIdx + 1]?.endsWith("invoke-worker.ps1"));
  const workerIdx = argv.indexOf("-Worker");
  assert.equal(argv[workerIdx + 1], "agy");
  assert.equal(argv[argv.indexOf("-Workspace") + 1], "C:\\proj");
  assert.equal(argv[argv.indexOf("-PromptFile") + 1], "C:\\runs\\brief.md");
  assert.equal(argv[argv.indexOf("-TimeoutMin") + 1], "30");
  assert.equal(argv[argv.indexOf("-Model") + 1], "gpt-test");
  assert.ok(!argv.includes("--worker"));
  assert.ok(!argv.includes("--prompt-file"));
});
