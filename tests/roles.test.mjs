import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  ROLES,
  roleNames,
  getRole,
  agentFileName,
  modelFamily,
} from "../scripts/lib/roles.mjs";
import { checkAgents } from "../scripts/check-agents.mjs";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const agentsDir = join(repoRoot, "agents");
const skillDir = join(repoRoot, "skills", "cursor-atomic-workflow");
const harnessPath = join(skillDir, "references", "harness.md");
const skillPath = join(skillDir, "SKILL.md");

const FORBIDDEN_HARNESS_PHRASES = [
  "PI_CODING_AGENT",
  ".opencode/agents",
  ".claude/agents",
  "spawn_agent",
  "agentOverrides",
  "sync-harness.mjs",
  "async: true",
];

const EXPECTED_ROLE_KEYS = [
  "explorer",
  "planner",
  "plan-reviewer",
  "tasker",
  "worker",
  "reviewer",
  "tester",
  "cli-delegate",
];

/** @param {string} markdown */
function parseCursorCallCardTable(markdown) {
  const rows = [];
  const lines = markdown.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if (line.includes("| 역할 | subagent_type | model |")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("|")) break;
    if (/^\|\s*---/.test(line)) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 3) continue;
    const stripTicks = (s) => s.replace(/`/g, "").trim();
    rows.push({
      role: stripTicks(cells[0]),
      subagentType: stripTicks(cells[1]),
      model: stripTicks(cells[2]),
    });
  }
  return rows;
}

/** @returns {{ tmp: string, dir: string }} */
function copyAgentsDirToTemp() {
  const tmp = mkdtempSync(join(tmpdir(), "roles-agents-"));
  const dir = join(tmp, "agents");
  cpSync(agentsDir, dir, { recursive: true });
  return { tmp, dir };
}

/** @param {string} filePath @param {string} model */
function setAgentFrontmatterModel(filePath, model) {
  const content = readFileSync(filePath, "utf8");
  const next = content.replace(/^model: .+$/m, `model: ${model}`);
  writeFileSync(filePath, next, "utf8");
}

test("getRole returns all eight pipeline roles and throws for unknown keys", () => {
  assert.deepEqual(roleNames().sort(), [...EXPECTED_ROLE_KEYS].sort());
  for (const name of EXPECTED_ROLE_KEYS) {
    const role = getRole(name);
    assert.equal(typeof role.subagentType, "string");
    assert.equal(typeof role.taskModel, "string");
    assert.ok(role.subagentType.length > 0);
    assert.ok(role.taskModel.length > 0);
  }
  assert.throws(() => getRole("not-a-role"), /Unknown role: not-a-role/);
  assert.equal(getRole("memory-curator").subagentType, "memory-curator");
});

test("agentFileName maps reviewer to cursor-atomic-reviewer.md", () => {
  assert.equal(agentFileName("reviewer"), "cursor-atomic-reviewer.md");
  assert.equal(agentFileName("worker"), "worker.md");
});

test("modelFamily maps task model id prefixes to families", () => {
  assert.equal(modelFamily("composer-2.5"), "composer");
  assert.equal(modelFamily("composer-2.5-fast"), "composer");
  assert.equal(modelFamily("muse-spark-1.3-max"), "muse-spark");
  assert.equal(modelFamily("claude-opus-5-5-high"), "claude");
  assert.equal(modelFamily("gpt-5.6-luna-max"), "gpt");
});

test("reviewer and worker task models use different model families", () => {
  assert.notEqual(
    modelFamily(ROLES.reviewer.taskModel),
    modelFamily(ROLES.worker.taskModel),
  );
});

test("plan-reviewer and planner task models use different model families", () => {
  assert.notEqual(
    modelFamily(ROLES["plan-reviewer"].taskModel),
    modelFamily(ROLES.planner.taskModel),
  );
});

test("checkAgents accepts the repository .cursor/agents directory", () => {
  assert.ok(existsSync(agentsDir));
  const { ok, problems } = checkAgents({ dir: agentsDir });
  assert.equal(ok, true, problems.join("; "));
  assert.deepEqual(problems, []);
});

test("checkAgents reports frontmatter model drift for a role", () => {
  const { tmp, dir } = copyAgentsDirToTemp();
  try {
    setAgentFrontmatterModel(join(dir, "explorer.md"), "composer-2.5-fast");
    const { ok, problems } = checkAgents({ dir });
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.startsWith("explorer:")));
    assert.ok(problems.some((p) => /frontmatter model/.test(p)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkAgents rejects reviewer frontmatter in worker model family", () => {
  const { tmp, dir } = copyAgentsDirToTemp();
  try {
    const reviewerFile = join(dir, agentFileName("reviewer"));
    const workerModel = getRole("worker").taskModel;
    setAgentFrontmatterModel(reviewerFile, workerModel);
    assert.equal(modelFamily(workerModel), modelFamily(getRole("worker").taskModel));
    const { ok, problems } = checkAgents({ dir });
    assert.equal(ok, false);
    assert.ok(
      problems.some(
        (p) => p.startsWith("reviewer:") && /frontmatter model/.test(p),
      ),
      `expected reviewer model problem, got: ${problems.join("; ")}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("checkAgents reports missing agent files", () => {
  const { tmp, dir } = copyAgentsDirToTemp();
  try {
    rmSync(join(dir, "worker.md"));
    const { ok, problems } = checkAgents({ dir });
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.startsWith("worker:") && /missing agent file/.test(p)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("harness Cursor call card matches ROLES and docs are Cursor-only harness wording", () => {
  const harnessMd = readFileSync(harnessPath, "utf8");
  const skillMd = readFileSync(skillPath, "utf8");

  const table = parseCursorCallCardTable(harnessMd);
  assert.equal(table.length, EXPECTED_ROLE_KEYS.length);
  for (const row of table) {
    const role = getRole(row.role);
    assert.equal(
      role.subagentType,
      row.subagentType,
      `subagentType mismatch for ${row.role}`,
    );
    assert.equal(role.taskModel, row.model, `taskModel mismatch for ${row.role}`);
  }

  const offenders = [];
  for (const phrase of FORBIDDEN_HARNESS_PHRASES) {
    if (harnessMd.includes(phrase)) offenders.push(`harness.md: ${phrase}`);
    if (skillMd.includes(phrase)) offenders.push(`SKILL.md: ${phrase}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `non-Cursor harness wording must be removed before green:\n${offenders.join("\n")}`,
  );
});
