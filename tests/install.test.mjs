import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  checkHarnessSync,
  checkSingleHarness,
  validateSkillFrontmatter,
  runDoctor,
} from "../scripts/doctor.mjs";
import {
  install,
  parseInstallArgs,
  findLegacyCursorCommands,
  RULES_DIR,
  ATOMIC_ROUTER_RULE,
  AGENTS_SKILLS_DIR,
} from "../scripts/install.mjs";
import { checkAgents } from "../scripts/check-agents.mjs";
import { resolveHarnesses } from "../scripts/lib/harnesses.mjs";
import { ROUTER_DISPATCH_COMMANDS } from "./workflow-constants.mjs";

const SKILLS = "skills";
const WORKFLOW = "atomic-workflow";

const COMMANDS = [
  "atomic-agy",
  "atomic-config",
  "atomic-delegate",
  "atomic-doctor",
  "atomic-execute",
  "atomic-explore",
  "atomic-lite",
  "atomic-models",
  "atomic-plan",
  "atomic-review",
  "atomic-run",
  "atomic-settings",
  "atomic-setup",
  "atomic-status",
  "atomic-task",
  "atomic-wrapup",
];

const HARNESS_TARGETS = ["cursor", "opencode", "codex", "pi", "agy"];

async function read(rel) {
  return readFile(rel, "utf8");
}

test("bundled workflow scripts match the root scripts", async () => {
  const sync = await checkHarnessSync({ cwd: "." });
  assert.equal(sync.skipped, false);
  assert.equal(sync.inSync, true, `drift: ${sync.mismatches.join(", ")}`);
});

test("check-agents.mjs is bundled under .atomic/scripts", () => {
  assert.equal(existsSync(".atomic/scripts/check-agents.mjs"), true);
});

test("legacy .cursor/commands is gone from the package", async () => {
  assert.equal(existsSync(".cursor/commands"), false);
});

test("command skills use minimal frontmatter and reference harness.md", async () => {
  for (const name of COMMANDS) {
    const rel = join(SKILLS, name, "SKILL.md");
    const text = await read(rel);
    assert.doesNotMatch(text, /disable-model-invocation\s*:/, `${rel} must not use disable-model-invocation`);
    assert.equal(validateSkillFrontmatter(text, rel).valid, true, `${rel} frontmatter`);
    assert.match(text, /# \//, `${rel} must title the slash command`);
    if (!["atomic-settings", "atomic-doctor"].includes(name)) {
      assert.match(text, /harness\.md|references\/harness\.md/, `${name} must defer harness details`);
    }
    if (ROUTER_DISPATCH_COMMANDS.includes(name)) {
      assert.match(text, /메인 채팅|라우터/, `${rel} description must mention router`);
    }
  }
  const harness = await read(join(SKILLS, WORKFLOW, "references", "harness.md"));
  for (const section of ["## 서브에이전트 띄우기", "## 커맨드 입력", "## 스크립트 경로"]) {
    assert.ok(harness.includes(section), `harness.md must define ${section}`);
  }
  assert.match(harness, /\.atomic\/scripts/);
  const workflow = await read(join(SKILLS, WORKFLOW, "SKILL.md"));
  assert.match(workflow, /references\/harness\.md/);
});

test("repository agents/ passes checkAgents", () => {
  const { ok, problems } = checkAgents({ dir: join("agents") });
  assert.equal(ok, true, problems.join("; "));
});

test("installer copies skills, atomic runtime, and cursor adapters", async () => {
  const target = await mkdtemp(join(tmpdir(), "atomic-install-"));
  try {
    const res = await install({ root: ".", target, harness: "cursor", force: false });
    assert.ok(res.copied.length > 0 || res.skipped.length > 0);
    assert.ok(existsSync(join(target, AGENTS_SKILLS_DIR, WORKFLOW, "SKILL.md")));
    assert.ok(existsSync(join(target, ".atomic", "scripts", "work-status.mjs")));
    assert.ok(existsSync(join(target, ".cursor", "agents", "worker.md")));
    assert.ok(existsSync(join(target, ".cursor", "agents", "atomic-reviewer.md")));
    assert.ok(existsSync(join(target, RULES_DIR, ATOMIC_ROUTER_RULE)));

    const doctor = await checkSingleHarness("cursor", target, ".");
    assert.equal(doctor.ok, true, doctor.problems.join("; "));

    await mkdir(join(target, ".cursor", "commands"), { recursive: true });
    await writeFile(join(target, ".cursor", "commands", "cursor-atomic-plan.md"), "# /old\n");
    const legacy = await findLegacyCursorCommands(target);
    assert.equal(legacy.length, 1);

    await mkdir(join(target, ".cursor", "skills", "cursor-atomic-plan"), { recursive: true });
    await writeFile(join(target, ".cursor", "skills", "cursor-atomic-plan", "SKILL.md"), "---\nname: x\n---\n");

    const migrated = await install({ root: ".", target, harness: "cursor", migrate: true, force: true });
    assert.ok(migrated.removed.some((p) => p.includes(".cursor/skills/cursor-atomic-")));
    assert.equal(existsSync(join(target, ".cursor", "skills", "cursor-atomic-plan")), false);

    const workerAgent = join(target, ".cursor", "agents", "worker.md");
    assert.doesNotMatch(await read(workerAgent), /^(model|readonly|is_background):/m);

    // A pinned model from an older install is dropped, not preserved, when --force regenerates it.
    const pinned = (await read(workerAgent)).replace(/^---\n/, "---\nmodel: legacy-pin\n");
    await writeFile(workerAgent, pinned, "utf8");
    await install({ root: ".", target, harness: "cursor" });
    assert.match(await read(workerAgent), /^model: legacy-pin$/m, "no --force keeps the user's file");
    await install({ root: ".", target, harness: "cursor", force: true });
    assert.doesNotMatch(await read(workerAgent), /^model:/m, "--force regenerates without a pin");

    await assert.rejects(
      install({ root: ".", target, harness: "cursor", force: true, setModel: { worker: "x" } }),
      /--set-model is no longer supported/,
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("parseInstallArgs rejects the removed --set-model before anything is written", () => {
  assert.throws(
    () => parseInstallArgs(["--set-model", "worker=x", "--target", "/tmp/x"]),
    /--set-model is no longer supported/,
  );
});

test("parseInstallArgs accepts --harness and rejects unknown flags", () => {
  const opts = parseInstallArgs(["--harness", "cursor", "--target", "/tmp/x"]);
  assert.equal(opts.harness, "cursor");
  assert.throws(() => parseInstallArgs(["--bogus"]), /알 수 없는 옵션/);
});

test("resolveHarnesses excludes claude from all unless --with-claude", () => {
  const without = resolveHarnesses(["all"], "/tmp", { withClaude: false });
  assert.equal(without.has("claude"), false);
  assert.equal(without.has("cursor"), true);
  const withClaude = resolveHarnesses(["all"], "/tmp", { withClaude: true });
  assert.equal(withClaude.has("claude"), true);
});

test("doctor skips bundle sync check outside the package repo", async () => {
  const outside = await mkdtemp(join(tmpdir(), "atomic-outside-"));
  try {
    const res = await checkHarnessSync({ cwd: outside });
    assert.equal(res.skipped, true);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("all atomic command skill directories exist", async () => {
  const names = (await readdir(SKILLS))
    .filter((n) => n.startsWith("atomic-") && n !== WORKFLOW)
    .sort();
  assert.deepEqual(names, COMMANDS);
});

for (const harness of HARNESS_TARGETS) {
  test(`install + doctor for harness ${harness}`, async () => {
    const target = await mkdtemp(join(tmpdir(), `harness-${harness}-`));
    try {
      if (harness === "cursor") {
        await mkdir(join(target, ".cursor"), { recursive: true });
      }
      if (harness === "opencode") {
        await mkdir(join(target, ".opencode"), { recursive: true });
      }
      if (harness === "pi") {
        await mkdir(join(target, ".pi"), { recursive: true });
      }
      await install({ root: ".", target, harness, force: true });
      if (harness === "agy" || harness === "codex") {
        const settings = JSON.parse(await read(join(target, ".atomic-workflow.json")));
        assert.ok(settings.installedHarnesses.includes(harness));
      }
      const report = await runDoctor({
        cwd: target,
        harness: "auto",
        root: ".",
        nodeVersion: "v22.13.0",
      });
      assert.equal(report.ok, true, report.problems.join("\n"));
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
}

test("claude harness is optional and requires explicit harness", async () => {
  const target = await mkdtemp(join(tmpdir(), "harness-claude-"));
  try {
    await install({ root: ".", target, harness: "all", force: true });
    assert.equal(existsSync(join(target, ".claude", "skills", WORKFLOW, "SKILL.md")), false);

    await install({ root: ".", target, harness: "claude", withClaude: true, force: true });
    assert.ok(existsSync(join(target, ".claude", "skills", WORKFLOW, "SKILL.md")));
    const claudeMd = await read(join(target, "CLAUDE.md"));
    assert.match(claudeMd, /@AGENTS\.md/);

    const report = await runDoctor({
      cwd: target,
      harness: "claude",
      root: ".",
      nodeVersion: "v22.13.0",
    });
    assert.equal(report.ok, true, report.problems.join("\n"));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("installed .atomic/scripts/doctor.mjs runs standalone in target", async () => {
  const { execFileSync } = await import("node:child_process");
  for (const harness of ["cursor", "opencode", "agy", "codex", "pi", "claude"]) {
    const dir = await mkdtemp(join(tmpdir(), `atomic-standalone-${harness}-`));
    try {
      await install({ target: dir, harness, force: true, quiet: true });
      execFileSync(
        process.execPath,
        [
          join(dir, ".atomic", "scripts", "doctor.mjs"),
          "--harness",
          harness,
          "--target",
          ".",
          "--node-version",
          "v22.13.0",
        ],
        { cwd: dir, stdio: "pipe" },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("doctor checkNodeVersion enforces >=22.13", async () => {
  const { checkNodeVersion } = await import("../scripts/doctor.mjs");
  assert.equal(checkNodeVersion("v20.19.2").ok, false);
  assert.equal(checkNodeVersion("v22.12.0").ok, false);
  assert.equal(checkNodeVersion("v22.13.0").ok, true);
  assert.equal(checkNodeVersion("v24.1.0").ok, true);
  assert.match(checkNodeVersion("v20.0.0").message, />=22\.13/);
});

test("runDoctor --harness fails on old Node", async () => {
  const { runDoctor } = await import("../scripts/doctor.mjs");
  const dir = await mkdtemp(join(tmpdir(), "atomic-oldnode-"));
  try {
    await install({ target: dir, harness: "cursor", force: true, quiet: true });
    const res = await runDoctor({ cwd: dir, harness: "cursor", nodeVersion: "v20.19.2" });
    assert.equal(res.ok, false);
    assert.ok(res.problems.some((p) => /22\.13/.test(p)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
