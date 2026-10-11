import assert from "node:assert/strict";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runDone } from "../scripts/run-done.mjs";

const SKILLS = ".cursor/skills";
const skillFile = (name) => join(SKILLS, name, "SKILL.md");

const COMMAND_SKILLS = [
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

const requiredSkills = [
  "codebase-design",
  "domain-modeling",
  "grilling",
  "wayfinder",
  "to-tickets",
  "tdd",
  "code-review"
];

const workflowAgents = {
  explorer: ["cursor-atomic-workflow"],
  planner: ["cursor-atomic-workflow", "codebase-design", "domain-modeling", "grilling", "wayfinder"],
  "plan-reviewer": ["cursor-atomic-workflow", "codebase-design", "tdd"],
  tasker: ["cursor-atomic-workflow", "to-tickets"],
  worker: ["cursor-atomic-workflow", "tdd"],
  reviewer: ["cursor-atomic-workflow", "code-review"],
  tester: ["cursor-atomic-workflow", "tdd", "codebase-design"],
  "cli-delegate": ["cursor-atomic-workflow"]
};

const oldAgentIds = ["g-explorer", "g-planner", "g-tasker", "g-worker", "g-reviewer"];

function parseFrontmatter(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${file} must have YAML frontmatter`);
  const map = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return map;
}

async function walkFiles(dir, files = []) {
  for (const name of await readdir(dir)) {
    if (name === ".git" || name === "node_modules" || name === "tests") continue;
    const path = join(dir, name);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      await walkFiles(path, files);
    } else if (/\.(md|json|mjs|js|ps1)$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

function isAllowedOldAgentMention(line) {
  return /g-\*\.md/.test(line)
    || /still use `g-/.test(line)
    || /기존 설정에 `g-/.test(line);
}

test("package.json includes .cursor directory", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.name, "cursor-atomic-workflow");
  assert.ok(pkg.files.includes(".cursor/"), "package.json files must ship .cursor/");
  assert.equal(pkg.engines?.node, ">=22.13");
  assert.ok(pkg.optionalDependencies?.["@cursor/sdk"]);
  assert.equal(pkg.pi, undefined, "Cursor package must not declare pi manifest");
});

test("package.json meets public publish metadata contract", async () => {
  const pkgStr = await readFile("package.json", "utf8");
  const pkg = JSON.parse(pkgStr);
  const expectedKeywords = [
    "cursor",
    "cursor-sdk",
    "workflow",
    "atomic-workflow",
    "skills",
    "agents"
  ];
  const expectedFiles = [
    ".cursor/",
    "scripts/",
    "profiles/",
    "README.md",
    "README.kr.md",
    "THIRD_PARTY_LICENSES/",
    "LICENSE"
  ];

  assert.equal(pkg.name, "cursor-atomic-workflow");
  assert.equal(pkg.version, "0.1.0");
  assert.ok(!Object.hasOwn(pkg, "private"), "package.json must not declare private");
  assert.equal(typeof pkg.description, "string");
  assert.ok(pkg.description.trim().length > 0, "description must be non-empty");
  assert.equal(pkg.license, "MIT");
  assert.deepEqual(pkg.repository, {
    type: "git",
    url: "git+https://github.com/donggrri/cursor-atomic-workflow.git"
  });
  assert.equal(pkg.homepage, "https://github.com/donggrri/cursor-atomic-workflow#readme");
  assert.equal(pkg.bugs?.url, "https://github.com/donggrri/cursor-atomic-workflow/issues");
  for (const keyword of expectedKeywords) {
    assert.ok(pkg.keywords?.includes(keyword), `keywords must include ${keyword}`);
  }
  assert.deepEqual(pkg.files, expectedFiles);
  assert.equal(pkg.optionalDependencies?.["@cursor/sdk"], "^1.0.32");

  const licenseStats = await stat("LICENSE").catch(() => null);
  assert.ok(licenseStats && licenseStats.isFile(), "root LICENSE file must exist");
});

test("bundled skills are present", async () => {
  for (const skill of requiredSkills) {
    const stats = await stat(skillFile(skill)).catch(() => null);
    assert.ok(stats && stats.isFile(), `skill ${skill} must exist under ${SKILLS}`);
  }
});

test("planning preflight is defined in the plan command skill", async () => {
  const plan = await readFile(skillFile("cursor-atomic-plan"), "utf8");
  assert.match(plan, /grilling/, "cursor-atomic-plan.md must reference grilling");
  assert.match(plan, /wayfinder/, "cursor-atomic-plan.md must reference wayfinder");
  assert.doesNotMatch(plan, /way-finder/, "cursor-atomic-plan.md must not reference old way-finder typo");
});

test("artifact writers use slug folders under .docs and harness docs", async () => {
  const files = [
    skillFile("cursor-atomic-workflow"),
    join(".cursor", "agents", "explorer.md"),
    join(".cursor", "agents", "planner.md"),
    skillFile("cursor-atomic-explore"),
    skillFile("cursor-atomic-plan"),
    skillFile("cursor-atomic-status"),
  ];
  for (const file of files) {
    const body = await readFile(file, "utf8");
    assert.match(body, /\.docs\/<slug>\//, `${file} must mention .docs/<slug>/`);
    assert.match(body, /docs\/<slug>\//, `${file} must mention docs/<slug>/`);
    assert.doesNotMatch(
      body,
      /워크스페이스 루트에 `(?:PLAN|EXPLORE)-<slug>\.md`/,
      `${file} must not tell agents to write PLAN/EXPLORE at workspace root`
    );
    assert.doesNotMatch(
      body,
      /Write `(?:PLAN|EXPLORE)-<slug>\.md` in the current workspace root/,
      `${file} must not tell agents to write PLAN/EXPLORE at workspace root`
    );
  }
});

test("workflow agents are registered without g- prefix", async () => {
  const { ROLES, AUXILIARY_ROLES, agentFileName, getRole } = await import("../scripts/lib/roles.mjs");
  const agentsDir = join(".cursor", "agents");
  const files = (await readdir(agentsDir)).sort();
  const expected = [
    ...Object.keys(ROLES).map((role) => agentFileName(role)),
    ...Object.values(AUXILIARY_ROLES).map((role) => `${role.subagentType}.md`),
  ].sort();
  assert.deepEqual(files, expected);

  for (const [name, skills] of Object.entries(workflowAgents)) {
    const file = join(agentsDir, agentFileName(name));
    const body = await readFile(file, "utf8");
    const meta = parseFrontmatter(body, file);
    assert.equal(meta.model, getRole(name).taskModel, `${file} model must match roles.mjs`);
    assert.ok(meta.description, `${file} must have description`);
    for (const skill of skills) {
      assert.match(body, new RegExp(skill), `${name} must reference skill ${skill}`);
    }
    assert.doesNotMatch(body, /^name: g-/m, `${file} must not use a g- name`);
  }
});

test("planner contract uses correct skills", async () => {
  const planner = await readFile(join(".cursor", "agents", "planner.md"), "utf8");
  assert.match(planner, /grilling/, "planner must use grilling");
  assert.match(planner, /wayfinder/, "planner must use wayfinder");
  assert.doesNotMatch(planner, /grill-me/, "planner must not rely on grill-me directly");
  assert.match(planner, /brief/, "planner must require planning refinement brief");
});

test("planner contract supports plan-review revise mode", async () => {
  const planner = await readFile(join(".cursor", "agents", "planner.md"), "utf8");
  assert.match(planner, /Revise PLAN/, "planner must document plan-review revise entry prompt");
  assert.match(planner, /계획 결함/, "planner revise mode must fix only plan defects section");
  assert.match(planner, /계획 정제/, "planner revise mode must keep settled decisions in 계획 정제");
  assert.match(planner, /자동 수정 기록/, "planner revise mode must append auto-revision log section");
});

test("command skills spawn the renamed agents", async () => {
  const prompts = {
    [skillFile("cursor-atomic-agy")]: ["cli-delegate"],
    [skillFile("cursor-atomic-explore")]: ["explorer"],
    [skillFile("cursor-atomic-plan")]: ["planner", "tasker", "worker", "reviewer"],
    [skillFile("cursor-atomic-task")]: ["tasker"],
    [skillFile("cursor-atomic-execute")]: ["worker", "reviewer"],
    [skillFile("cursor-atomic-review")]: ["reviewer"],
    [skillFile("cursor-atomic-delegate")]: ["worker"],
  };
  for (const [file, agents] of Object.entries(prompts)) {
    const body = await readFile(file, "utf8");
    for (const agent of agents) {
      assert.match(body, new RegExp(`\\b${agent}\\b`), `${file} must spawn ${agent}`);
    }
    for (const oldId of oldAgentIds) {
      assert.doesNotMatch(body, new RegExp(`\\b${oldId}\\b`), `${file} must not spawn ${oldId}`);
    }
  }
});

test("documentation matches bundled behavior", async () => {
  const readme = await readFile("README.md", "utf8");
  assert.doesNotMatch(readme, /npx skills add mattpocock/, "README must not instruct to run npx skills add in installation instructions (except as historical context)");
  assert.match(readme, /THIRD_PARTY_LICENSES/, "README must mention THIRD_PARTY_LICENSES");
});

test("command skill directories use package-prefixed slash names", async () => {
  const dirs = (await readdir(SKILLS))
    .filter((name) => name.startsWith("cursor-atomic-") && name !== "cursor-atomic-workflow")
    .sort();
  assert.deepEqual(dirs, COMMAND_SKILLS);
});

test("lite command skill is single-session without subagents", async () => {
  const file = skillFile("cursor-atomic-lite");
  const body = await readFile(file, "utf8");
  const meta = parseFrontmatter(body, file);
  assert.equal(meta.name, "cursor-atomic-lite");
  assert.notEqual(meta["disable-model-invocation"], "true", `${file} must be model-invocable for router`);
  assert.match(meta.description ?? "", /메인 채팅|라우터/, `${file} description must mention router`);
  assert.match(body, /서브에이전트/, `${file} must forbid subagents`);
  assert.match(body, /CURSOR_ATOMIC_WORKFLOW_HOME/, `${file} must respect workflow home`);
  assert.match(body, /memory\.mjs/, `${file} must use memory.mjs`);
  assert.match(body, /propose --auto/, `${file} must auto-save memory`);
  assert.match(body, /5개 이상|5\+/, `${file} must escalate on many files`);
  assert.match(body, /cursor-atomic-plan/, `${file} must recommend full workflow`);
  assert.doesNotMatch(body, /\bplanner\b.*백그라운드/, `${file} must not spawn planner`);
  const { validateSkillFrontmatter } = await import("../scripts/doctor.mjs");
  assert.equal(validateSkillFrontmatter(body, file).valid, true);
});

test("agy command skill keeps headless delegate contract", async () => {
  const file = skillFile("cursor-atomic-agy");
  const body = await readFile(file, "utf8");
  const meta = parseFrontmatter(body, file);
  assert.equal(meta.name, "cursor-atomic-agy");
  assert.equal(meta["disable-model-invocation"], "true");

  const description = meta.description ?? "";
  assert.match(description, /agy/, `${file} description must mention agy`);
  assert.match(description, /headless|헤드리스/, `${file} description must mention headless or 헤드리스`);
  assert.match(description, /plan/, `${file} description must mention plan`);
  assert.match(description, /delegate/, `${file} description must mention delegate`);

  const requiredPhrases = [
    "invoke-worker",
    "--worker agy",
    "cli-delegate",
    "plan",
    "implement",
    ".cursor/plans/agy-",
    "git status --porcelain",
    "git diff",
    "run-done",
    "다음 진행해",
    "work-status.mjs",
    "위임할까요",
  ];
  for (const phrase of requiredPhrases) {
    assert.ok(body.includes(phrase), `${file} must mention ${phrase}`);
  }

  const forbidsCommitPush = body.includes("커밋·푸시하지 않는다")
    || (/git commit/.test(body) && /git push/.test(body) && /금지/.test(body));
  assert.ok(forbidsCommitPush, `${file} must forbid commit and push`);
  assert.match(body, /bare/, `${file} must forbid a bare agy invocation`);
  assert.doesNotMatch(body, /^\s*agy\s*$/m, `${file} must not contain a line that is only agy`);

  const { validateSkillFrontmatter } = await import("../scripts/doctor.mjs");
  const result = validateSkillFrontmatter(body, file);
  assert.equal(result.valid, true, `${file} frontmatter must be valid: ${JSON.stringify(result.issues)}`);
});

test("bundled skills have valid frontmatter without unquoted colon mapping errors", async () => {
  const { validateSkillFrontmatter } = await import("../scripts/doctor.mjs");
  for (const skill of requiredSkills) {
    const file = skillFile(skill);
    const content = await readFile(file, "utf8");
    const result = validateSkillFrontmatter(content, file);
    assert.equal(result.valid, true, `${file} must not have YAML parse risks: ${JSON.stringify(result.issues)}`);
  }
});

test("doctor module correctly detects and fixes unquoted description syntax", async () => {
  const { validateSkillFrontmatter } = await import("../scripts/doctor.mjs");
  const badContent = `---\nname: test-skill\ndescription: Some text. After tag: details here\n---\n# Body`;
  const badResult = validateSkillFrontmatter(badContent, "test.md");
  assert.equal(badResult.valid, false, "Should detect unquoted colon in description");
  assert.equal(badResult.issues.length, 1);
  assert.equal(badResult.issues[0].suggestedFix, 'description: "Some text. After tag: details here"');

  const goodContent = `---\nname: test-skill\ndescription: "Some text. After tag: details here"\n---\n# Body`;
  const goodResult = validateSkillFrontmatter(goodContent, "test.md");
  assert.equal(goodResult.valid, true, "Should accept quoted description");
});

test("old g- agent ids remain only as migration/cleanup notes", async () => {
  const files = await walkFiles(".");
  const leftover = [];
  for (const file of files) {
    const body = await readFile(file, "utf8");
    for (const [i, line] of body.split("\n").entries()) {
      if (!oldAgentIds.some((id) => line.includes(id))) continue;
      if (isAllowedOldAgentMention(line)) continue;
      leftover.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(leftover, [], leftover.join("\n"));
});

test("run-done returns ok:true for successful command", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-run-done-"));
  try {
    const result = await runDone({
      cwd: tmpDir,
      command: "echo hello",
      logPath: join(tmpDir, "output.log"),
      timeoutMs: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    const summary = JSON.parse(await readFile(`${result.outputPath}`, "utf8"));
    assert.equal(summary.ok, true);
    assert.equal(summary.exitCode, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("run-done returns ok:false for failing command", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-run-done-"));
  try {
    const result = await runDone({
      cwd: tmpDir,
      command: "exit 1",
      logPath: join(tmpDir, "output.log"),
      timeoutMs: 5000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    const summary = JSON.parse(await readFile(`${result.outputPath}`, "utf8"));
    assert.equal(summary.ok, false);
    assert.equal(summary.exitCode, 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("run-done handles timeout with ok:false and exitCode -1", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-run-done-"));
  try {
    const result = await runDone({
      cwd: tmpDir,
      command: "sleep 10",
      logPath: join(tmpDir, "output.log"),
      timeoutMs: 50,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, -1);
    const summary = JSON.parse(await readFile(`${result.outputPath}`, "utf8"));
    assert.equal(summary.ok, false);
    assert.equal(summary.exitCode, -1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("run-done creates .done.json at logPath", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-run-done-"));
  try {
    const logPath = join(tmpDir, "build.log");
    await runDone({
      cwd: tmpDir,
      command: "echo test",
      logPath,
      timeoutMs: 5000,
    });
    const donePath = join(tmpDir, "build.done.json");
    const exists = statSync(donePath).isFile();
    assert.ok(exists, ".done.json should exist");
    const content = await readFile(logPath, "utf8");
    assert.ok(content.includes("test"), "logPath should contain command output");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("run-done extracts errorTail of last 20 lines on command failure", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-run-done-"));
  try {
    const logPath = join(tmpDir, "output.log");
    const result = await runDone({
      cwd: tmpDir,
      command: `node -e "for (let i = 1; i <= 25; i++) console.log('line ' + i); process.exit(1);"`,
      logPath,
      timeoutMs: 5000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.ok(typeof result.errorTail === "string", "result.errorTail must be a string");
    const tailLines = result.errorTail.trim().split("\n");
    assert.equal(tailLines.length, 20);
    assert.equal(tailLines[0].trim(), "line 6");
    assert.equal(tailLines[tailLines.length - 1].trim(), "line 25");

    const summary = JSON.parse(await readFile(`${result.outputPath}`, "utf8"));
    assert.equal(summary.errorTail, result.errorTail);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("run-done extracts errorTail on command timeout", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "test-run-done-"));
  try {
    const logPath = join(tmpDir, "output.log");
    const result = await runDone({
      cwd: tmpDir,
      command: `node -e "console.log('timeout log line'); setTimeout(() => {}, 5000);"`,
      logPath,
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, -1);
    assert.ok(typeof result.errorTail === "string", "result.errorTail must be a string");
    assert.ok(result.errorTail.includes("timeout log line"));

    const summary = JSON.parse(await readFile(`${result.outputPath}`, "utf8"));
    assert.equal(summary.errorTail, result.errorTail);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("pipeline recovery CONTEXT glossary", async () => {
  const context = await readFile(join(SKILLS, "cursor-atomic-workflow", "CONTEXT.md"), "utf8");

  // 리뷰 재작업
  assert.match(context, /## 리뷰 재작업/, "CONTEXT.md must have section '## 리뷰 재작업'");
  assert.match(context, /REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤/, "CONTEXT.md must specify review defect task handling");
  assert.match(context, /worker→reviewer를 최대 1회 자동 재실행/, "CONTEXT.md must specify worker→reviewer retry limit (max 1)");
  assert.match(context, /한 바퀴 후에도 결함이면 멈추고 보고/, "CONTEXT.md must specify stop and report if defect persists after 1 retry");

  // 막힘 재개
  assert.match(context, /## 막힘 재개/, "CONTEXT.md must have section '## 막힘 재개'");
  assert.match(context, /실패한 항목만 재시도/, "CONTEXT.md must specify retrying only failed items");
  assert.match(context, /이미 \[x\]는 유지/, "CONTEXT.md must specify keeping already checked items");
  assert.match(context, /재시도 시작 때 그 항목의 `막힘:`만 지운다/, "CONTEXT.md must specify clearing 막힘: before retry");
  assert.match(context, /입구는 `?\/cursor-atomic-execute`?/, "CONTEXT.md must specify entrypoint as /cursor-atomic-execute");

  // 사람 게이트
  assert.match(context, /## 사람 게이트/, "CONTEXT.md must have section '## 사람 게이트'");
  assert.match(context, /PLAN\(Phase 1\)만/, "CONTEXT.md must specify human gate is PLAN(Phase 1) only");
  assert.match(context, /리뷰 재작업 1회·막힘 재개는 정책으로 자동/, "CONTEXT.md must specify review rework and retry are automated by policy");

  // 용어 요약 테이블 검증
  assert.match(context, /\|\s*리뷰 재작업\s*\|/, "CONTEXT.md summary table must contain 리뷰 재작업");
  assert.match(context, /\|\s*막힘 재개\s*\|/, "CONTEXT.md summary table must contain 막힘 재개");
  assert.match(context, /\|\s*사람 게이트\s*\|/, "CONTEXT.md summary table must contain 사람 게이트");
});

test("pipeline recovery reference bash", async () => {
  const reference = await readFile(join(SKILLS, "cursor-atomic-workflow", "reference.md"), "utf8");

  // Cursor / PowerShell 블록 유지 및 분리 라벨
  assert.match(reference, /Cursor.*PowerShell/i, "reference.md must separate and label Cursor/PowerShell");
  assert.match(reference, /\$repoRoot = git rev-parse --show-toplevel/, "reference.md must retain PowerShell worktree snippet");
  assert.match(reference, /Get-Date -Format "yyyy-MM-dd"/, "reference.md must retain PowerShell evidence snippet");

  assert.match(reference, /### bash/, "reference.md must have a bash worktree section");
  assert.match(reference, /git rev-parse --show-toplevel/, "reference.md bash must use git rev-parse");
  assert.match(reference, /\.\.\/\$repoName-\$slug/, "reference.md bash must use ../$repoName-$slug");
  assert.match(reference, /feat\/\$slug/, "reference.md bash must use feat/$slug");
  assert.match(reference, /이미 있으면.*재사용/, "reference.md bash must state reusing worktree if already exists");

  assert.match(reference, /date \+%Y-%m-%d/, "reference.md bash must use date +%Y-%m-%d");
  assert.match(reference, /\$HOME\/\.cursor-atomic-workflow\/evidence\//, "reference.md bash must archive to evidence directory");
  assert.match(reference, /\.docs\/<slug>/, "reference.md bash must mention .docs/<slug>");
  assert.match(reference, /원본은.*남긴다/, "reference.md bash must state original is kept");
});

test("pipeline recovery SKILL orchestration", async () => {
  const skill = await readFile(skillFile("cursor-atomic-workflow"), "utf8");

  // 사람 게이트 불변
  assert.match(skill, /사람 게이트는.*PLAN.*Phase 1.*만|사람 게이트는 \*\*PLAN뿐\*\*이다/, "SKILL.md must state human gate is PLAN(Phase 1) only");
  assert.match(skill, /리뷰 재작업 1회·막힘 재개는 정책으로 자동/, "SKILL.md must state review rework and block resume are automated by policy");

  // 리뷰 재작업
  assert.match(skill, /REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤/, "SKILL.md must specify resetting or appending task on review defect");
  assert.match(skill, /worker\s*→\s*reviewer를 한 번만 자동 재실행/, "SKILL.md must specify running worker->reviewer automatically once");
  assert.match(skill, /한 바퀴 후에도 결함이면 멈추고 보고/, "SKILL.md must specify stopping and reporting if defect persists");

  // 막힘 재개
  assert.match(skill, /실패한 항목만 재시도/, "SKILL.md must specify retrying only failed items");
  assert.match(skill, /이미 \[x\]는 유지/, "SKILL.md must specify keeping already checked items");
  assert.match(skill, /재시도 시작 때 그 항목의 `막힘:`만 지운다/, "SKILL.md must specify clearing 막힘: at start of retry");
  assert.match(skill, /입구는 `?\/cursor-atomic-execute`?/, "SKILL.md must specify entrypoint as /cursor-atomic-execute");

  // Status 다음 커맨드 execute 안내
  assert.match(skill, /막힘.*\/cursor-atomic-execute/, "SKILL.md Status must guide to /cursor-atomic-execute when blocked");

  // 멈추는 경우에 회복 명시
  assert.match(skill, /멈추는 경우:[\s\S]*?막힘 재개[\s\S]*?리뷰 재작업/, "SKILL.md 멈추는 경우 must reference recovery policies");
});

test("pipeline recovery workers and testing", async () => {
  const workers = await readFile(join(SKILLS, "cursor-atomic-workflow", "workers.md"), "utf8");
  const testing = await readFile(join(SKILLS, "cursor-atomic-workflow", "testing.md"), "utf8");

  for (const [file, content] of [["workers.md", workers], ["testing.md", testing]]) {
    // 1회 / 한 번
    assert.match(content, /(?:1회|한 번)/, `${file} must mention 1회 or 한 번 for review rework`);
    // 막힘 재개
    assert.match(content, /막힘 재개/, `${file} must mention 막힘 재개`);
    // execute 재입구
    assert.match(content, /\/cursor-atomic-execute/, `${file} must mention /cursor-atomic-execute`);
    // flake retry 없음
    assert.match(content, /flake retry 없음/, `${file} must mention flake retry 없음`);
    // 사람 게이트
    assert.match(content, /사람 게이트.*PLAN.*Phase 1.*만|사람 게이트는.*PLAN.*만/, `${file} must mention human gate is PLAN(Phase 1) only`);
  }
});

test("pipeline recovery command skills", async () => {
  const execute = await readFile(skillFile("cursor-atomic-execute"), "utf8");
  const review = await readFile(skillFile("cursor-atomic-review"), "utf8");
  const status = await readFile(skillFile("cursor-atomic-status"), "utf8");
  const commit = await readFile(skillFile("cursor-atomic-wrapup"), "utf8");

  // execute prompt recovery policy
  assert.match(execute, /막힘 재개/, "execute.md must mention 막힘 재개");
  assert.match(execute, /실패한 항목만 재시도/, "execute.md must specify retrying only failed items");
  assert.match(execute, /이미 \[x\]는 유지/, "execute.md must specify keeping already checked items");
  assert.match(execute, /재시도 시작 때 그 항목의 `?막힘:`?만 지운다/, "execute.md must specify clearing 막힘: at start of retry");
  assert.match(execute, /\/cursor-atomic-execute/, "execute.md must mention entrypoint /cursor-atomic-execute");
  assert.match(execute, /사람 게이트.*PLAN.*Phase 1.*만|사람 게이트는.*PLAN.*만/, "execute.md must state human gate is PLAN(Phase 1) only");
  assert.match(execute, /막힘 재개는 정책으로 자동/, "execute.md must state block resume is automated by policy");

  // review prompt recovery policy
  assert.match(review, /리뷰 재작업/, "review.md must mention 리뷰 재작업");
  assert.match(review, /REVIEW 결함/, "review.md must mention REVIEW 결함");
  assert.match(review, /worker\s*→\s*reviewer를 (?:1회|한 번만) 자동 재실행/, "review.md must specify running worker->reviewer automatically once (1회/한 번만)");
  assert.match(review, /한 바퀴 후에도 결함이면 멈추고 보고/, "review.md must specify stopping and reporting if defect persists");
  assert.match(review, /flake retry 없음/, "review.md must specify no flake retry");
  assert.match(review, /사람 게이트.*PLAN.*Phase 1.*만|사람 게이트는.*PLAN.*만/, "review.md must state human gate is PLAN(Phase 1) only");

  // status prompt recovery policy and bash paths
  assert.match(status, /막힘.*\/cursor-atomic-execute/, "status.md must guide to /cursor-atomic-execute when blocked");
  assert.match(status, /~\/\.cursor-atomic-workflow\/runs\//, "status.md must guide global runs path");
  assert.match(status, /PowerShell|%USERPROFILE%/, "status.md must retain Cursor PowerShell block/path");

  assert.match(commit, /~\/\.cursor-atomic-workflow\/evidence\//, "commit.md must guide global evidence path");
  assert.match(commit, /PowerShell|%USERPROFILE%/, "commit.md must retain Cursor PowerShell block/path");
});

test("pipeline recovery reviewer agent", async () => {
  const reviewer = await readFile(join(".cursor", "agents", "cursor-atomic-reviewer.md"), "utf8");

  // 직접 리뷰어 및 CLI 디스패치 금지
  assert.match(reviewer, /직접 리뷰어/, "reviewer.md must state package reviewer is direct reviewer");
  assert.match(reviewer, /(?:agy|codex).*디스패치하지 말 것|디스패치.*금지/, "reviewer.md must forbid CLI dispatch");
  assert.match(reviewer, /invoke-worker 금지/, "reviewer.md must forbid invoke-worker");

  // Fresh 검증
  assert.match(reviewer, /Fresh 검증/, "reviewer.md must mention Fresh 검증");
  assert.match(reviewer, /작업자 대화 맥락을 상속받지 않는 독립 컨텍스트로 검증/, "reviewer.md must specify verifying in independent context without worker conversation history");

  // 리뷰 재작업 및 결함 1회 / 한 번
  assert.match(reviewer, /리뷰 재작업/, "reviewer.md must mention 리뷰 재작업");
  assert.match(reviewer, /REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤/, "reviewer.md must specify resetting or appending task on review defect");
  assert.match(reviewer, /worker\s*→\s*reviewer를 (?:1회|한 번만) 자동 재실행/, "reviewer.md must specify running worker->reviewer automatically once (1회/한 번만)");
  assert.match(reviewer, /한 바퀴 후에도 결함이면 멈추고 보고/, "reviewer.md must specify stopping and reporting if defect persists");
  assert.match(reviewer, /flake retry 없음/, "reviewer.md must specify no flake retry");

  // 사람 게이트 PLAN-only
  assert.match(reviewer, /사람 게이트.*PLAN.*Phase 1.*만|사람 게이트는.*PLAN.*만/, "reviewer.md must state human gate is PLAN(Phase 1) only");
  assert.match(reviewer, /리뷰 재작업 1회는 정책으로 자동/, "reviewer.md must state review rework is automated by policy");
});

test("bugbot review parent contract docs", async () => {
  const routing = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "references", "routing.md"),
    "utf8"
  );
  const harness = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "references", "harness.md"),
    "utf8"
  );
  const context = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "CONTEXT.md"),
    "utf8"
  );
  const reference = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "reference.md"),
    "utf8"
  );
  const reviewer = await readFile(
    join(".cursor", "agents", "cursor-atomic-reviewer.md"),
    "utf8"
  );

  assert.match(routing, /bugbot/, "routing.md must document bugbot hand-off");
  assert.match(routing, /BUGBOT_FAILED/, "routing.md must document BUGBOT_FAILED marker");
  assert.match(routing, /bugbot-findings\.md/, "routing.md must mention bugbot-findings.md");

  assert.match(
    harness,
    /Bugbot 선행 검토 카드|subagent_type:\s*"?bugbot"?/,
    "harness.md must document bugbot pre-review card"
  );
  assert.match(
    harness,
    /subagent_type:\s*bugbot/,
    "harness.md must show subagent_type: bugbot example"
  );

  assert.match(context, /Bugbot 선행 검토/, "CONTEXT.md must define Bugbot 선행 검토");

  assert.match(reviewer, /Bugbot findings/, "reviewer agent must reference Bugbot findings path");
  assert.match(reviewer, /## Bugbot 트리아지/, "reviewer agent must have ## Bugbot 트리아지 section");

  assert.match(reference, /## Bugbot 트리아지/, "reference.md REVIEW template must include ## Bugbot 트리아지");
});

test("plan-review parent contract docs", async () => {
  const routing = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "references", "routing.md"),
    "utf8"
  );
  const harness = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "references", "harness.md"),
    "utf8"
  );
  const context = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "CONTEXT.md"),
    "utf8"
  );
  const reference = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "reference.md"),
    "utf8"
  );
  const skill = await readFile(skillFile("cursor-atomic-workflow"), "utf8");
  const models = await readFile(
    join(SKILLS, "cursor-atomic-workflow", "models.md"),
    "utf8"
  );
  const doctor = await readFile(skillFile("cursor-atomic-doctor"), "utf8");
  const config = await readFile(skillFile("cursor-atomic-config"), "utf8");
  const modelsCmd = await readFile(skillFile("cursor-atomic-models"), "utf8");
  const readme = await readFile("README.md", "utf8");
  const readmeKr = await readFile("README.kr.md", "utf8");

  assert.match(routing, /plan-review/, "routing.md must document plan-review flow");
  assert.match(routing, /PLAN 비판 검토/, "routing.md must have PLAN 비판 검토 section");
  assert.match(routing, /## 계획 결함/, "routing.md must reference blocking defects heading");
  assert.match(routing, /plan-reviewer/, "routing.md must name plan-reviewer for task-card roles");

  assert.match(harness, /plan-reviewer/, "harness.md must document plan-reviewer");
  assert.match(harness, /grok-4\.7-high/, "harness.md must document plan-reviewer model");

  assert.match(context, /## PLAN 비판 검토/, "CONTEXT.md must define PLAN 비판 검토");
  assert.match(context, /## PLAN 자동 수정/, "CONTEXT.md must define PLAN 자동 수정");
  assert.match(context, /\|\s*PLAN 비판 검토\s*\|/, "CONTEXT summary table must contain PLAN 비판 검토");

  assert.match(reference, /PLAN-REVIEW/, "reference.md must include PLAN-REVIEW template");
  assert.match(reference, /## 계획 결함/, "reference.md PLAN-REVIEW template must include ## 계획 결함");

  assert.match(skill, /Phase 1\.5/, "SKILL.md must document Phase 1.5");
  assert.match(skill, /plan-reviewer/, "SKILL.md must mention plan-reviewer in pipeline");

  assert.match(models, /plan-reviewer.*grok-4\.7-high/s, "models.md must list plan-reviewer Task model");

  assert.match(doctor, /plan-reviewer/, "doctor skill must check plan-reviewer session type");
  assert.match(config, /plan-reviewer/, "config skill must list plan-reviewer agent");
  assert.match(modelsCmd, /plan-reviewer/, "models command skill must list plan-review stage");

  assert.match(readme, /plan-reviewer/, "README.md must mention plan-reviewer");
  assert.match(readme, /8 agents/, "README.md must count eight agents");
  assert.match(readmeKr, /plan-reviewer/, "README.kr.md must mention plan-reviewer");
  assert.match(readmeKr, /8종/, "README.kr.md must count eight agents");
});



