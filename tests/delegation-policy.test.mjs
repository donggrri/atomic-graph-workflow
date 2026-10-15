import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStagePolicy,
  stageEditsCode,
  EDIT_STAGES,
  FORBID_MARKER,
} from "../scripts/lib/executors/delegation-policy.mjs";
import { GRAPH_STAGE_IDS } from "../scripts/lib/graph.mjs";

test("only lite and execute edit code", () => {
  assert.deepEqual([...EDIT_STAGES].sort(), ["execute", "lite"]);
  assert.equal(stageEditsCode("execute"), true);
  assert.equal(stageEditsCode("lite"), true);
  for (const stage of GRAPH_STAGE_IDS.filter((s) => s !== "execute" && s !== "lite")) {
    assert.equal(stageEditsCode(stage), false, stage);
  }
  assert.equal(stageEditsCode(null), false);
  assert.equal(stageEditsCode(undefined), false);
});

test("applyStagePolicy leaves editing stages unchanged", () => {
  assert.equal(applyStagePolicy("execute", "implement T1"), "implement T1");
  assert.equal(applyStagePolicy("lite", "fix typo"), "fix typo");
});

test("applyStagePolicy prepends FORBID for stages that must not edit code", () => {
  for (const stage of ["explore", "plan", "plan-review", "task", "review", "wrapup", "memory"]) {
    const out = applyStagePolicy(stage, "do the stage");
    assert.ok(out.startsWith(FORBID_MARKER), stage);
    assert.ok(out.endsWith("do the stage"), stage);
    assert.match(out, /git commit/);
    assert.match(out, /산출물 문서뿐/);
  }
});

test("applyStagePolicy treats an unknown stage as non-editing and never doubles the block", () => {
  const once = applyStagePolicy(null, "x");
  assert.ok(once.startsWith(FORBID_MARKER));
  assert.equal(applyStagePolicy(null, once), once);
  assert.equal(applyStagePolicy("review", undefined).includes(FORBID_MARKER), true);
});

import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { createCompositeRoleRunner } from "../scripts/lib/executors/composite.mjs";

/** Fake `agy` that records the prompt it receives (`-p <prompt>`) and exits 0. */
function fakeAgyEnv() {
  const bin = mkdtempSync(join(tmpdir(), "fake-agy-bin-"));
  const out = mkdtempSync(join(tmpdir(), "fake-agy-out-"));
  const script = join(bin, "agy");
  writeFileSync(
    script,
    `#!/usr/bin/env bash\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == "-p" ]]; then printf '%s' "$2" > "${out}/prompt.txt"; fi; shift; done\nexit 0\n`,
  );
  chmodSync(script, 0o755);
  return { bin, out };
}

async function runStageViaAgy(stage, role) {
  const { bin, out } = fakeAgyEnv();
  const repo = mkdtempSync(join(tmpdir(), "policy-repo-"));
  const runs = join(repo, "runs");
  mkdirSync(runs, { recursive: true });
  const prevPath = process.env.PATH;
  const prevTrust = process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
  process.env.PATH = `${bin}${delimiter}${prevPath}`;
  process.env.CURSOR_ATOMIC_TRUST_COMMANDS = "1";
  try {
    const runner = createCompositeRoleRunner({
      adapter: null,
      repoRoot: repo,
      slug: "policy",
      runsDir: runs,
      graph: { nodes: {} },
      settings: { executors: { [stage]: "agy" } },
      crossExecutorStartupFallback: false,
    });
    const result = await runner.runRole({ role, prompt: "STAGE-BRIEF", phaseKey: stage });
    return { result, prompt: readFileSync(join(out, "prompt.txt"), "utf8") };
  } finally {
    process.env.PATH = prevPath;
    if (prevTrust === undefined) delete process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
    else process.env.CURSOR_ATOMIC_TRUST_COMMANDS = prevTrust;
    for (const dir of [bin, out, repo]) rmSync(dir, { recursive: true, force: true });
  }
}

test("agy review stage receives the FORBID block, execute does not", { skip: process.platform === "win32" }, async () => {
  const review = await runStageViaAgy("review", "reviewer");
  assert.equal(review.result.ok, true, JSON.stringify(review.result));
  assert.ok(review.prompt.includes(FORBID_MARKER), "review prompt must carry FORBID");
  assert.ok(review.prompt.includes("STAGE-BRIEF"));

  const execute = await runStageViaAgy("execute", "worker");
  assert.equal(execute.result.ok, true, JSON.stringify(execute.result));
  assert.ok(!execute.prompt.includes(FORBID_MARKER), "execute prompt must stay unrestricted");
  assert.ok(execute.prompt.includes("STAGE-BRIEF"));
});

/** Fake `cursor-agent` that records the prompt read from stdin. */
async function runStageViaCursorAgent(stage, role, settings = {}) {
  const bin = mkdtempSync(join(tmpdir(), "fake-cursor-bin-"));
  const out = mkdtempSync(join(tmpdir(), "fake-cursor-out-"));
  writeFileSync(join(bin, "cursor-agent"), `#!/usr/bin/env bash\ncat > "${out}/prompt.txt"\nexit 0\n`);
  chmodSync(join(bin, "cursor-agent"), 0o755);
  const repo = mkdtempSync(join(tmpdir(), "policy-repo-"));
  const runs = join(repo, "runs");
  mkdirSync(runs, { recursive: true });
  const prevPath = process.env.PATH;
  const prevTrust = process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
  process.env.PATH = `${bin}${delimiter}${prevPath}`;
  delete process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
  try {
    const runner = createCompositeRoleRunner({
      adapter: null,
      repoRoot: repo,
      slug: "policy",
      runsDir: runs,
      graph: { nodes: {} },
      settings: { executors: { [stage]: "cursor-agent" }, ...settings },
      crossExecutorStartupFallback: false,
    });
    const result = await runner.runRole({ role, prompt: "STAGE-BRIEF", phaseKey: stage });
    let prompt = null;
    try {
      prompt = readFileSync(join(out, "prompt.txt"), "utf8");
    } catch {
      // never launched
    }
    return { result, prompt };
  } finally {
    process.env.PATH = prevPath;
    if (prevTrust === undefined) delete process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
    else process.env.CURSOR_ATOMIC_TRUST_COMMANDS = prevTrust;
    for (const dir of [bin, out, repo]) rmSync(dir, { recursive: true, force: true });
  }
}

test("cursor-agent gets the same stage policy and now needs trust before --force", { skip: process.platform === "win32" }, async () => {
  const trusted = { trustedExecutors: { "cursor-agent": true } };

  const review = await runStageViaCursorAgent("review", "reviewer", trusted);
  assert.equal(review.result.ok, true, JSON.stringify(review.result));
  assert.ok(review.prompt.startsWith(FORBID_MARKER));

  const execute = await runStageViaCursorAgent("execute", "worker", trusted);
  assert.equal(execute.result.ok, true, JSON.stringify(execute.result));
  assert.ok(!execute.prompt.includes(FORBID_MARKER));

  // Without trust the CLI must not be launched at all (non-interactive run).
  const untrusted = await runStageViaCursorAgent("execute", "worker");
  assert.equal(untrusted.result.ok, false);
  assert.match(untrusted.result.message, /신뢰되지 않은/);
  assert.equal(untrusted.prompt, null);
});
