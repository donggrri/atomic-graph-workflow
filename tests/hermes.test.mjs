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
} from "../scripts/lib/hermes-routing.mjs";
import { routeStage, runDelegatedStage } from "../scripts/hermes-delegate.mjs";
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

    const report = await checkSingleHarness("hermes", target, ".");
    assert.equal(report.ok, true, report.problems.join("; "));
    assert.ok(report.warnings.some((w) => w.includes("hermes skills trust")));
    assert.match(HERMES_ORCHESTRATOR_CONFIG_HINT, /grok-4\.7-high/);
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

test("hermes routing defaults, overrides, fast-model rejection, dry-run fallback", async () => {
  const repo = await mkdtemp(join(tmpdir(), "hermes-route-"));
  try {
    const explore = resolveHermesRoute("explore", { repoRoot: repo });
    assert.equal(explore.runner, "cursor-agent");
    assert.equal(explore.model, "claude-haiku-5-5-high");

    const testStage = resolveHermesRoute("test", { repoRoot: repo });
    assert.equal(testStage.runner, "cursor-agent");
    assert.equal(testStage.model, "claude-haiku-5-5-high");

    const execute = resolveHermesRoute("execute", { repoRoot: repo });
    assert.equal(execute.runner, "cursor-agent");
    assert.equal(execute.model, "composer-2.5");
    assert.equal(execute.fallback.runner, "agy");
    assert.equal(execute.fallback.model, "gemini-3.8-flash-high");

    const planReview = resolveHermesRoute("plan-review", { repoRoot: repo });
    assert.equal(planReview.runner, "agy");
    assert.equal(planReview.model, "gemini-3.8-flash-high");
    assert.equal(planReview.fallback.runner, "cursor-agent");
    assert.equal(planReview.fallback.model, "grok-4.7-high");

    const plan = resolveHermesRoute("plan", { repoRoot: repo });
    assert.equal(plan.runner, "agy");
    assert.equal(plan.model, "gemini-3.8-flash-high");
    assert.equal(plan.fallback.runner, "cursor-agent");
    assert.equal(plan.fallback.model, "claude-sonnet-5-5-high");

    const review = resolveHermesRoute("review", {
      repoRoot: repo,
      lastImplementRunner: "cursor-agent",
    });
    assert.equal(review.runner, "agy");
    assert.equal(review.fallback.runner, "cursor-agent");
    assert.equal(review.fallback.model, "claude-sonnet-5-5-high");

    const reviewAfterAgy = resolveHermesRoute("review", {
      repoRoot: repo,
      lastImplementRunner: "agy",
    });
    assert.equal(reviewAfterAgy.runner, "cursor-agent");
    assert.equal(reviewAfterAgy.model, "claude-sonnet-5-5-high");

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
    await writeFile(
      join(repo, ".atomic", "graph.yaml"),
      `version: 2
hermes:
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
    const planRouted = resolveHermesRoute("plan", { repoRoot: repo, overrides });
    assert.equal(planRouted.runner, "cursor-agent");
    assert.equal(planRouted.model, "composer-2.5");

    const prev = process.env.ATOMIC_HERMES_ROUTING;
    process.env.ATOMIC_HERMES_ROUTING = JSON.stringify({
      task: { runner: "agy", model: "gemini-3.8-flash-high" },
    });
    const task = resolveHermesRoute("task", { repoRoot: repo });
    assert.equal(task.runner, "agy");
    if (prev === undefined) delete process.env.ATOMIC_HERMES_ROUTING;
    else process.env.ATOMIC_HERMES_ROUTING = prev;

    const brief = join(repo, "brief.md");
    await writeFile(brief, "do work", "utf8");
    const fakeBin = await mockHermesBin(repo);
    const binDir = join(repo, "fake-cli");
    await mkdir(binDir, { recursive: true });
    const agy = join(binDir, "agy");
    await writeFile(agy, "#!/bin/sh\nexit 1\n", "utf8");
    await chmod(agy, 0o755);
    const cursorAgent = join(binDir, "cursor-agent");
    await writeFile(cursorAgent, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(cursorAgent, 0o755);

    const dry = await runDelegatedStage({
      stage: "execute",
      workspace: repo,
      promptFile: brief,
      dryRun: true,
    });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.runner, "cursor-agent");

    const routed = await routeStage("wrapup", { repoRoot: repo });
    assert.equal(routed.runner, "agy");
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
