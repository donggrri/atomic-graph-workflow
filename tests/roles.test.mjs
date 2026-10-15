import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  ROLES,
  AUXILIARY_ROLES,
  GENERIC_SUBAGENT,
  roleNames,
  getRole,
  agentFileName,
} from "../scripts/lib/roles.mjs";
import { checkAgents, forbiddenFrontmatterKeys } from "../scripts/check-agents.mjs";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const agentsDir = join(repoRoot, "agents");
const skillDir = join(repoRoot, "skills", "atomic-workflow");
const harnessPath = join(skillDir, "references", "harness.md");

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

/** Model ids the workflow used to pin; none may survive in roles, agents or the harness doc. */
const LEGACY_MODEL_IDS = [
  "composer-2.5",
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "taskModel",
];

/** @returns {{ tmp: string, dir: string }} */
function copyAgentsDirToTemp() {
  const tmp = mkdtempSync(join(tmpdir(), "roles-agents-"));
  const dir = join(tmp, "agents");
  cpSync(agentsDir, dir, { recursive: true });
  return { tmp, dir };
}

test("getRole returns all eight pipeline roles and throws for unknown keys", () => {
  assert.deepEqual(roleNames().sort(), [...EXPECTED_ROLE_KEYS].sort());
  for (const name of EXPECTED_ROLE_KEYS) {
    const role = getRole(name);
    assert.equal(typeof role.subagentType, "string");
    assert.ok(role.subagentType.length > 0);
  }
  assert.throws(() => getRole("not-a-role"), /Unknown role: not-a-role/);
  assert.equal(getRole("memory-curator").subagentType, "memory-curator");
});

test("roles carry no model fields", () => {
  for (const role of [...Object.values(ROLES), ...Object.values(AUXILIARY_ROLES)]) {
    assert.deepEqual(Object.keys(role), ["subagentType"]);
  }
  assert.equal(GENERIC_SUBAGENT, "generic");
});

test("agentFileName maps reviewer to atomic-reviewer.md", () => {
  assert.equal(agentFileName("reviewer"), "atomic-reviewer.md");
  assert.equal(agentFileName("worker"), "worker.md");
});

test("checkAgents accepts the repository agents directory", () => {
  assert.ok(existsSync(agentsDir));
  const { ok, problems } = checkAgents({ dir: agentsDir });
  assert.equal(ok, true, problems.join("; "));
  assert.deepEqual(problems, []);
});

test("source agents have no model, readonly or is_background frontmatter", () => {
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(join(agentsDir, file), "utf8");
    assert.deepEqual(forbiddenFrontmatterKeys(content), [], `${file} frontmatter`);
    assert.doesNotMatch(content, /Cursor 서브에이전트다/, `${file} footer is harness-neutral`);
  }
});

test("checkAgents rejects a pinned model in agent frontmatter", () => {
  const { tmp, dir } = copyAgentsDirToTemp();
  try {
    const file = join(dir, "explorer.md");
    const content = readFileSync(file, "utf8");
    writeFileSync(file, content.replace(/^---\r?\n/, "---\nmodel: some-model\n"), "utf8");
    const { ok, problems } = checkAgents({ dir });
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.startsWith("explorer:") && /"model:"/.test(p)));
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

test("harness doc is harness-neutral and names no pinned model", () => {
  const harnessMd = readFileSync(harnessPath, "utf8");

  for (const harness of ["Claude Code", "AGY", "OpenCode", "Cursor", "Pi"]) {
    assert.ok(harnessMd.includes(harness), `harness.md must cover ${harness}`);
  }
  assert.doesNotMatch(harnessMd, /Cursor.{0,6}전용이다/, "no longer Cursor-only");
  for (const id of LEGACY_MODEL_IDS) {
    assert.ok(!harnessMd.includes(id), `harness.md must not mention ${id}`);
  }
  assert.match(harnessMd, /모델을 지정하지 않는다/);
});
