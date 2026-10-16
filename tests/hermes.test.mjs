import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import test from "node:test";
import { install } from "../scripts/install.mjs";
import { checkSingleHarness, runDoctor } from "../scripts/doctor.mjs";
import {
  HERMES_SKILLS_DIR,
  HERMES_ORCHESTRATOR_CONFIG_HINT,
} from "../scripts/lib/install-hermes.mjs";
import { runHermesCli } from "../scripts/lib/executors/hermes-cli.mjs";
import {
  resolveHermesRoute,
  rejectFastModel,
  loadHermesRoutingOverrides,
  normalizeCursorAgentModel,
  CURSOR_AGENT_ALLOWED_MODELS,
  OPENCODE_MODEL_DEEPSEEK,
  OPENCODE_MODEL_GLM,
} from "../scripts/lib/hermes-routing.mjs";
import {
  routeStage,
  runDelegatedStage,
  runRunnerCli,
  detectDelegatedFailure,
  truncateStderr,
  acquireOpencodeLock,
  atomicHermesLogPath,
} from "../scripts/hermes-delegate.mjs";
import { AGENTS_SKILLS_DIR } from "../scripts/install.mjs";
import { existsSync } from "node:fs";

const WORKFLOW = "atomic-workflow";

async function mockHermesBin(dir) {
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const script = join(binDir, "hermes");
  await writeFile(
    script,
    `#!/bin/sh
case "$1" in
  --version) exit 0 ;;
  status) echo "ok"; exit 0 ;;
  chat) exit 0 ;;
  *) exit 1 ;;
esac
`,
    "utf8",
  );
  await chmod(script, 0o755);
  return binDir;
}

async function writeFakeCli(binDir, name, body) {
  const path = join(binDir, name);
  await writeFile(path, body, "utf8");
  await chmod(path, 0o755);
  return path;
}

test("hermes install layout: .hermes/skills, role skills, no .agents or .hermes.md", async () => {
  const target = await mkdtemp(join(tmpdir(), "hermes-install-"));
  const pathDir = await mockHermesBin(target);
  const env = { ...process.env, PATH: `${pathDir}:${process.env.PATH ?? ""}` };
  const prevPath = process.env.PATH;
  process.env.PATH = env.PATH;
  try {
    await install({ root: ".", target, harness: "hermes", force: true });
    assert.equal(existsSync(join(target, ".hermes.md")), false);
    assert.equal(existsSync(join(target, AGENTS_SKILLS_DIR, WORKFLOW, "SKILL.md")), false);
    assert.ok(existsSync(join(target, HERMES_SKILLS_DIR, WORKFLOW, "SKILL.md")));
    assert.ok(existsSync(join(target, HERMES_SKILLS_DIR, "atomic-hermes-delegate", "SKILL.md")));
    assert.ok(existsSync(join(target, HERMES_SKILLS_DIR, "atomic-role-explorer", "SKILL.md")));
    const plan = await readFile(join(target, HERMES_SKILLS_DIR, "atomic-plan", "SKILL.md"), "utf8");
    assert.match(plan, /name: atomic-plan/);
    assert.match(plan, /^---\r?\nname: atomic-plan/m);
    assert.doesNotMatch(plan, /\.agents\/skills/);

    const delegateSkill = await readFile(
      join(target, HERMES_SKILLS_DIR, "atomic-hermes-delegate", "SKILL.md"),
      "utf8",
    );
    assert.match(delegateSkill, /grok-4\.7-medium/);
    assert.match(delegateSkill, /파일 쓰기/);

    const report = await checkSingleHarness("hermes", target, ".");
    assert.equal(report.ok, true, report.problems.join("; "));
    assert.ok(report.warnings.some((w) => w.includes("hermes skills trust")));
    assert.match(HERMES_ORCHESTRATOR_CONFIG_HINT, /grok-4\.7-medium/);
    assert.match(HERMES_ORCHESTRATOR_CONFIG_HINT, /hermes-cursor-provider/);
  } finally {
    process.env.PATH = prevPath;
    await rm(target, { recursive: true, force: true });
  }
});

test("hermes-cli maps exit codes and reports startup when missing", async () => {
  const prevPath = process.env.PATH;
  process.env.PATH = "";
  const missing = await runHermesCli({
    repoRoot: process.cwd(),
    prompt: "hi",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.kind, "startup");

  const tmp = await mkdtemp(join(tmpdir(), "hermes-cli-"));
  try {
    const binDir = await mockHermesBin(tmp);
    process.env.PATH = binDir;
    const ok = await runHermesCli({ repoRoot: tmp, prompt: "ok" });
    assert.equal(ok.ok, true);

    const failScript = join(binDir, "hermes");
    await writeFile(
      failScript,
      `#!/bin/sh
if [ "$1" = "chat" ]; then exit 3; fi
case "$1" in --version|status) exit 0 ;; *) exit 1 ;; esac
`,
      "utf8",
    );
    const fail = await runHermesCli({ repoRoot: tmp, prompt: "x" });
    assert.equal(fail.ok, false);
    assert.equal(fail.exitCode, 3);

    const timeout = await runHermesCli({
      repoRoot: tmp,
      prompt: "t",
      timeoutSec: 1,
      spawnFn: (file, args, opts) =>
        spawn(process.execPath, ["-e", "setTimeout(()=>{}, 8000)"], opts),
    });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.exitCode, 124);
  } finally {
    process.env.PATH = prevPath;
    await rm(tmp, { recursive: true, force: true });
  }
});

test("detectDelegatedFailure treats empty stdout and permission stderr as failure", () => {
  assert.equal(detectDelegatedFailure({ exitCode: 0, stdout: "ok" }).failed, false);
  assert.equal(detectDelegatedFailure({ exitCode: 0, stdout: "" }).failed, true);
  assert.match(detectDelegatedFailure({ exitCode: 0, stdout: "x", stderr: "permission denied" }).message, /pattern/);
  assert.match(detectDelegatedFailure({ exitCode: 0, stdout: "x", stderr: "auto-denied" }).message, /pattern/);
  assert.match(detectDelegatedFailure({ exitCode: 0, stdout: "x", stderr: "no-output" }).message, /pattern/);
  const tail = truncateStderr("a".repeat(5000), 100);
  assert.equal(tail.length, 100);
});

test("hermes routing defaults, overrides, fast-model rejection, fallback disable", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hermes-route-"));
  try {
    const explore = resolveHermesRoute("explore", { repoRoot: repo });
    assert.equal(explore.runner, "cursor-agent");
    assert.equal(explore.model, "claude-haiku-5-5-high");
    assert.equal(explore.fallback.runner, "opencode");
    assert.equal(explore.fallback.model, OPENCODE_MODEL_GLM);

    const testStage = resolveHermesRoute("test", { repoRoot: repo });
    assert.equal(testStage.runner, "cursor-agent");
    assert.equal(testStage.model, "claude-haiku-5-5-high");

    const execute = resolveHermesRoute("execute", { repoRoot: repo });
    assert.equal(execute.runner, "cursor-agent");
    assert.equal(execute.model, "composer-2.5");
    assert.equal(execute.fallback.runner, "opencode");
    assert.equal(execute.fallback.model, OPENCODE_MODEL_DEEPSEEK);

    const planReview = resolveHermesRoute("plan-review", { repoRoot: repo });
    assert.equal(planReview.runner, "cursor-agent");
    assert.equal(planReview.model, "grok-4.7-high");
    assert.equal(planReview.fallback.runner, "opencode");

    const plan = resolveHermesRoute("plan", { repoRoot: repo });
    assert.equal(plan.runner, "cursor-agent");
    assert.equal(plan.model, "claude-sonnet-5-5-high");
    assert.equal(plan.fallback.runner, "opencode");

    const review = resolveHermesRoute("review", { repoRoot: repo });
    assert.equal(review.runner, "cursor-agent");
    assert.equal(review.model, "claude-sonnet-5-5-high");
    assert.equal(review.fallback.runner, "opencode");

    const wrapup = resolveHermesRoute("wrapup", { repoRoot: repo });
    assert.equal(wrapup.runner, "cursor-agent");
    assert.equal(wrapup.model, "composer-2.5");

    assert.throws(() => rejectFastModel("grok-fast"), /fast models/);
    assert.throws(() => rejectFastModel("composer-2.5-fast"), /fast models/);

    const alias = normalizeCursorAgentModel("haiku-5.5-high");
    assert.equal(alias.model, "claude-haiku-5-5-high");
    assert.equal(alias.warning, undefined);

    const unknown = normalizeCursorAgentModel("not-a-real-model");
    assert.equal(unknown.model, "composer-2.5");
    assert.match(unknown.warning, /allowed:/);
    for (const id of CURSOR_AGENT_ALLOWED_MODELS) {
      assert.match(unknown.warning, new RegExp(id));
    }

    const badOverride = resolveHermesRoute("task", {
      repoRoot: repo,
      overrides: { task: { runner: "cursor-agent", model: "bogus-model" } },
    });
    assert.equal(badOverride.model, "composer-2.5");
    assert.ok(badOverride.warning);

    await mkdir(join(repo, ".atomic"), { recursive: true });
    const prev = process.env.ATOMIC_HERMES_ROUTING;
    process.env.ATOMIC_HERMES_ROUTING = JSON.stringify({
      task: { runner: "agy", model: "gemini-3.8-flash-high" },
    });
    const task = resolveHermesRoute("task", { repoRoot: repo });
    assert.equal(task.runner, "agy");
    assert.equal(task.fallback.runner, "cursor-agent");
    assert.equal(task.fallback.model, "composer-2.5");
    if (prev === undefined) delete process.env.ATOMIC_HERMES_ROUTING;
    else process.env.ATOMIC_HERMES_ROUTING = prev;

    await writeFile(
      join(repo, ".atomic", "graph.yaml"),
      `version: 2
hermes:
  fallback: false
  routing:
    plan:
      runner: cursor-agent
      model: composer-2.5
nodes:
  plan: { skill: atomic-plan, executor: agy, model: gemini-3.8-flash-high }
`,
      "utf8",
    );
    const overrides = loadHermesRoutingOverrides(repo);
    const planRouted = resolveHermesRoute("plan", { repoRoot: repo, routingConfig: overrides });
    assert.equal(planRouted.runner, "cursor-agent");
    assert.equal(planRouted.model, "composer-2.5");
    assert.equal(planRouted.fallback, null);
    assert.equal(planRouted.fallbackEnabled, false);

    process.env.ATOMIC_HERMES_ROUTING = JSON.stringify({
      execute: { fallback: false, runner: "cursor-agent", model: "composer-2.5" },
    });
    const executeNoFb = resolveHermesRoute("execute", {
      repoRoot: repo,
      routingConfig: loadHermesRoutingOverrides(repo),
    });
    assert.equal(executeNoFb.fallbackEnabled, false);
    delete process.env.ATOMIC_HERMES_ROUTING;

    const brief = join(repo, "brief.md");
    await writeFile(brief, "do work", "utf8");
    const dry = await runDelegatedStage({
      stage: "execute",
      workspace: repo,
      promptFile: brief,
      dryRun: true,
    });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.runner, "cursor-agent");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("runRunnerCli: cursor-agent trust/force, empty stdout failure, opencode lock and fallback", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hermes-run-"));
  const binDir = join(repo, "bin");
  await mkdir(binDir, { recursive: true });
  const brief = join(repo, "brief.md");
  await writeFile(brief, "prompt text", "utf8");
  const prevPath = process.env.PATH;

  try {
    await writeFakeCli(
      binDir,
      "cursor-agent",
      `#!/bin/sh
echo "$@" >> "$CURSOR_AGENT_LOG"
exit 0
`,
    );
    process.env.CURSOR_AGENT_LOG = join(repo, "cursor-agent-args.log");
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const empty = await runRunnerCli({
      runner: "cursor-agent",
      model: "composer-2.5",
      workspace: repo,
      promptFile: brief,
      stage: "plan",
    });
    assert.equal(empty.ok, false);
    assert.match(empty.message, /empty stdout/);

    await writeFakeCli(
      binDir,
      "cursor-agent",
      `#!/bin/sh
echo "done"
echo "permission denied" >&2
exit 0
`,
    );
    const denied = await runRunnerCli({
      runner: "cursor-agent",
      model: "composer-2.5",
      workspace: repo,
      promptFile: brief,
      stage: "plan-review",
    });
    assert.equal(denied.ok, false);
    assert.match(denied.message, /pattern/);

    await writeFakeCli(
      binDir,
      "cursor-agent",
      `#!/bin/sh
echo "$@" >> "$CURSOR_AGENT_LOG"
echo "ok-out"
exit 0
`,
    );
    const ok = await runRunnerCli({
      runner: "cursor-agent",
      model: "composer-2.5",
      workspace: repo,
      promptFile: brief,
    });
    assert.equal(ok.ok, true);
    const argsLog = await readFile(join(repo, "cursor-agent-args.log"), "utf8");
    assert.match(argsLog, /--trust/);
    assert.match(argsLog, /--force/);

    const lockPath = join(repo, ".atomic", "opencode-run.lock");
    await mkdir(join(repo, ".atomic"), { recursive: true });
    await writeFile(lockPath, "held", "utf8");

    await writeFakeCli(
      binDir,
      "opencode",
      `#!/bin/sh
echo "$@" >> "$OPENCODE_LOG"
echo "opencode-out"
exit 0
`,
    );
    process.env.OPENCODE_LOG = join(repo, "opencode-args.log");

    const locked = await runRunnerCli({
      runner: "opencode",
      model: OPENCODE_MODEL_GLM,
      workspace: repo,
      promptFile: brief,
      timeoutSec: 2,
    });
    assert.equal(locked.ok, false);
    assert.match(locked.message, /lock timeout/);

    await rm(lockPath);
    const opencodeOk = await runRunnerCli({
      runner: "opencode",
      model: OPENCODE_MODEL_GLM,
      workspace: repo,
      promptFile: brief,
      stage: "plan",
    });
    assert.equal(opencodeOk.ok, true);
    const ocLog = await readFile(join(repo, "opencode-args.log"), "utf8");
    assert.match(ocLog, /run -m opencode\/glm-5\.3-flash-free/);
    assert.ok(existsSync(join(repo, ".atomic", "hermes-opencode-run.json")));

    await writeFakeCli(
      binDir,
      "cursor-agent",
      `#!/bin/sh
exit 1
`,
    );
    await writeFakeCli(
      binDir,
      "opencode",
      `#!/bin/sh
echo "fallback-ok"
exit 0
`,
    );

    const delegated = await runDelegatedStage({
      stage: "execute",
      workspace: repo,
      promptFile: brief,
    });
    assert.equal(delegated.ok, true);
    assert.equal(delegated.fallbackUsed, true);
    assert.equal(delegated.runner, "opencode");
    const atomicLog = await readFile(atomicHermesLogPath(repo), "utf8");
    assert.match(atomicLog, /"fallbackUsed":true/);

    await writeFakeCli(
      binDir,
      "cursor-agent",
      `#!/bin/sh
echo "out"
echo "permission denied" >&2
exit 0
`,
    );
    process.env.ATOMIC_HERMES_ROUTING = JSON.stringify({ fallback: false });
    const deniedRun = await runDelegatedStage({
      stage: "execute",
      workspace: repo,
      promptFile: brief,
    });
    delete process.env.ATOMIC_HERMES_ROUTING;
    assert.equal(deniedRun.ok, false);
    assert.match(deniedRun.message, /pattern/);
    assert.ok(deniedRun.stderrTail);
  } finally {
    process.env.PATH = prevPath;
    delete process.env.CURSOR_AGENT_LOG;
    delete process.env.OPENCODE_LOG;
    await rm(repo, { recursive: true, force: true });
  }
});

test("acquireOpencodeLock releases file", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hermes-lock-"));
  const lockPath = join(repo, "lock");
  try {
    const release = await acquireOpencodeLock(lockPath, 2000);
    assert.ok(release);
    assert.ok(existsSync(lockPath));
    await release();
    assert.equal(existsSync(lockPath), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("resolveExecutorWithFallback skips missing hermes", async () => {
  const { resolveExecutorWithFallback } = await import("../scripts/lib/executors/availability.mjs");
  const prev = process.env.PATH;
  process.env.PATH = "";
  const res = resolveExecutorWithFallback("hermes");
  assert.notEqual(res.executor, "hermes");
  assert.equal(res.fallbackFrom, "hermes");
  process.env.PATH = prev;
});
