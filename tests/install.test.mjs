import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  checkHarnessSync,
  checkHarnessInstall,
  validateSkillFrontmatter,
} from "../scripts/doctor.mjs";
import {
  install,
  parseInstallArgs,
  findLegacyCursorCommands,
  RULES_DIR,
  ATOMIC_ROUTER_RULE,
} from "../scripts/install.mjs";
import { checkAgents } from "../scripts/check-agents.mjs";

const SKILLS = ".cursor/skills";
const WORKFLOW = "cursor-atomic-workflow";

/** 메인 채팅 라우터가 모델 스킬 호출로 불러올 수 있는 커맨드 스킬 */
export const ROUTER_DISPATCH_COMMANDS = ["cursor-atomic-lite", "cursor-atomic-plan"];

const COMMANDS = [
  "cursor-atomic-agy",
  "cursor-atomic-config",
  "cursor-atomic-delegate",
  "cursor-atomic-doctor",
  "cursor-atomic-execute",
  "cursor-atomic-explore",
  "cursor-atomic-lite",
  "cursor-atomic-models",
  "cursor-atomic-plan",
  "cursor-atomic-review",
  "cursor-atomic-run",
  "cursor-atomic-settings",
  "cursor-atomic-status",
  "cursor-atomic-task",
  "cursor-atomic-wrapup",
];

async function read(rel) {
  return readFile(rel, "utf8");
}

test("bundled workflow scripts match the root scripts", async () => {
  const sync = await checkHarnessSync({ cwd: "." });
  assert.equal(sync.skipped, false);
  assert.equal(sync.inSync, true, `drift: ${sync.mismatches.join(", ")}`);
});

test("legacy .cursor/commands is gone from the package", async () => {
  assert.equal(existsSync(".cursor/commands"), false);
});

test("command skills gate model invocation and reference harness.md", async () => {
  for (const name of COMMANDS) {
    const rel = join(SKILLS, name, "SKILL.md");
    const text = await read(rel);
    if (ROUTER_DISPATCH_COMMANDS.includes(name)) {
      assert.doesNotMatch(
        text,
        /disable-model-invocation:\s*true/,
        `${rel} must be model-invocable for main-chat router`,
      );
      assert.match(text, /메인 채팅|라우터/, `${rel} description must mention main-chat router`);
    } else {
      assert.match(text, /disable-model-invocation:\s*true/, `${rel} must set disable-model-invocation`);
    }
    assert.equal(validateSkillFrontmatter(text, rel).valid, true, `${rel} frontmatter must be YAML safe`);
    assert.match(text, /# \//, `${rel} must title the slash command`);
    if (!["cursor-atomic-settings", "cursor-atomic-doctor"].includes(name)) {
      assert.match(text, /harness\.md|references\/harness\.md/, `${name} must defer harness details`);
    }
  }
  const harness = await read(join(SKILLS, WORKFLOW, "references", "harness.md"));
  for (const section of ["## 서브에이전트 띄우기", "## 커맨드 입력", "## 스크립트 경로"]) {
    assert.ok(harness.includes(section), `harness.md must define ${section}`);
  }
  assert.match(harness, /Cursor 전용|Cursor\)/);
  const workflow = await read(join(SKILLS, WORKFLOW, "SKILL.md"));
  assert.match(workflow, /references\/harness\.md/);
});

test("repository .cursor/agents passes checkAgents", () => {
  const { ok, problems } = checkAgents({ dir: join(".cursor", "agents") });
  assert.equal(ok, true, problems.join("; "));
});

test("installer copies skills and agents into a target project", async () => {
  const target = await mkdtemp(join(tmpdir(), "cursor-install-"));
  try {
    await mkdir(join(target, ".cursor", "commands"), { recursive: true });
    await writeFile(join(target, ".cursor", "commands", "cursor-atomic-plan.md"), "# /old\n");

    const res = await install({ root: ".", target, force: false });
    assert.ok(res.copied.length > 0 || res.skipped.length > 0);
    assert.ok(
      existsSync(join(target, ".cursor", "skills", WORKFLOW, "SKILL.md")),
      "workflow skill must be installed",
    );
    assert.ok(
      existsSync(join(target, ".cursor", "agents", "worker.md")),
      "agents must be installed",
    );
    assert.equal(existsSync(join(target, ".cursor", "agents", "reviewer.md")), false);
    assert.ok(existsSync(join(target, ".cursor", "agents", "cursor-atomic-reviewer.md")));
    assert.ok(
      existsSync(join(target, RULES_DIR, ATOMIC_ROUTER_RULE)),
      "atomic-router rule must be installed",
    );

    const legacy = await findLegacyCursorCommands(target);
    assert.equal(legacy.length, 1);

    const doctor = await checkHarnessInstall({ cwd: target, root: "." });
    assert.equal(doctor.skillsInstalled, true);
    assert.equal(doctor.commandSkills.length, COMMANDS.length);
    assert.equal(doctor.routerRuleInstalled, true);
    assert.deepEqual(doctor.harnesses.cursor.agents.missing, []);

    const second = await install({ root: ".", target });
    assert.equal(second.copied.length, 0);
    assert.ok(second.skipped.length > 0);

    await install({ root: ".", target, force: true, setModel: { worker: "composer-2.5-fast" } });
    assert.match(await read(join(target, ".cursor", "agents", "worker.md")), /^model: composer-2\.5-fast$/m);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("parseInstallArgs rejects unknown flags", () => {
  assert.throws(() => parseInstallArgs(["--harness", "cursor"]), /--harness|알 수 없는 옵션/);
});

test("doctor skips bundle sync check outside the package repo", async () => {
  const outside = await mkdtemp(join(tmpdir(), "cursor-outside-"));
  try {
    const res = await checkHarnessSync({ cwd: outside });
    assert.equal(res.skipped, true);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("all cursor-atomic command skill directories exist", async () => {
  const names = (await readdir(SKILLS))
    .filter((n) => n.startsWith("cursor-atomic-") && n !== WORKFLOW)
    .sort();
  assert.deepEqual(names, COMMANDS);
});
