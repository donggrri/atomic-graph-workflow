import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildOpencodeConfig,
  externalDirectoryKey,
  installOpencodeConfig,
  mergeOpencodeConfig,
} from "../scripts/lib/opencode-config.mjs";
import { rewriteGraphExecutors } from "../scripts/lib/graph.mjs";
import { install } from "../scripts/install.mjs";
import { getWorkflowRoot } from "../scripts/work-status.mjs";

const execFileAsync = promisify(execFile);
const WORKFLOW_HOME = getWorkflowRoot();
const EXTERNAL_KEY = externalDirectoryKey(WORKFLOW_HOME);

function emptyRecord() {
  return { copied: [], overwritten: [], skipped: [] };
}

test("externalDirectoryKey appends /** and trims trailing slashes", () => {
  assert.equal(externalDirectoryKey("/home/u/.cursor-atomic-workflow"), "/home/u/.cursor-atomic-workflow/**");
  assert.equal(externalDirectoryKey("/home/u/wf/"), "/home/u/wf/**");
});

test("buildOpencodeConfig grants external_directory for the workflow home", () => {
  const config = buildOpencodeConfig(WORKFLOW_HOME);
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.permission.external_directory[EXTERNAL_KEY], "allow");
});

test("mergeOpencodeConfig creates the entry when no file exists", () => {
  const merged = mergeOpencodeConfig("", WORKFLOW_HOME);
  assert.equal(merged.added, true);
  assert.equal(merged.changed, true);
  assert.equal(merged.config.permission.external_directory[EXTERNAL_KEY], "allow");
  const round = JSON.parse(merged.text);
  assert.equal(round.permission.external_directory[EXTERNAL_KEY], "allow");
});

test("mergeOpencodeConfig preserves existing keys and permission entries", () => {
  const existing = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "anthropic/claude-sonnet-4-5",
    permission: {
      bash: "allow",
      external_directory: { "~/projects/**": "allow" },
    },
  });
  const merged = mergeOpencodeConfig(existing, WORKFLOW_HOME);
  assert.equal(merged.added, true);
  assert.equal(merged.config.model, "anthropic/claude-sonnet-4-5");
  assert.equal(merged.config.permission.bash, "allow");
  assert.equal(merged.config.permission.external_directory["~/projects/**"], "allow");
  assert.equal(merged.config.permission.external_directory[EXTERNAL_KEY], "allow");
});

test("mergeOpencodeConfig is a no-op when the entry already exists", () => {
  const existing = `${JSON.stringify(buildOpencodeConfig(WORKFLOW_HOME), null, 2)}\n`;
  const merged = mergeOpencodeConfig(existing, WORKFLOW_HOME);
  assert.equal(merged.added, false);
  assert.equal(merged.changed, false);
  assert.equal(merged.text, existing);
});

test("mergeOpencodeConfig rejects non-object and invalid JSON", () => {
  assert.throws(() => mergeOpencodeConfig("[1,2]", WORKFLOW_HOME), /root must be a JSON object/);
  assert.throws(() => mergeOpencodeConfig("{oops", WORKFLOW_HOME), /invalid JSON/);
});

test("installOpencodeConfig creates, preserves, then skips", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-config-"));
  try {
    const record = emptyRecord();
    await installOpencodeConfig(target, WORKFLOW_HOME, record);
    const dest = join(target, "opencode.json");
    assert.ok(existsSync(dest));
    assert.ok(record.copied.includes(dest));
    let parsed = JSON.parse(await readFile(dest, "utf8"));
    assert.equal(parsed.permission.external_directory[EXTERNAL_KEY], "allow");

    await writeFile(
      dest,
      JSON.stringify({ theme: "dark", permission: { edit: "ask", external_directory: { "/data/**": "allow" } } }),
      "utf8",
    );
    const mergeRecord = emptyRecord();
    await installOpencodeConfig(target, WORKFLOW_HOME, mergeRecord);
    assert.ok(mergeRecord.overwritten.includes(dest));
    parsed = JSON.parse(await readFile(dest, "utf8"));
    assert.equal(parsed.theme, "dark");
    assert.equal(parsed.permission.edit, "ask");
    assert.equal(parsed.permission.external_directory["/data/**"], "allow");
    assert.equal(parsed.permission.external_directory[EXTERNAL_KEY], "allow");

    const skipRecord = emptyRecord();
    await installOpencodeConfig(target, WORKFLOW_HOME, skipRecord);
    assert.deepEqual(skipRecord.skipped, [dest]);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("rewriteGraphExecutors rewrites cursor executors only for opencode-only installs", () => {
  const text = [
    "version: 1",
    "nodes:",
    "  lite:",
    "    executor: cursor-sdk",
    "  explore:",
    "    executor: cursor-subagent",
    "  execute:",
    "    executor: cursor-agent",
    "  review:",
    "    executor: opencode",
    "",
  ].join("\n");

  const opencodeOnly = rewriteGraphExecutors(text, { hasOpencode: true, hasCursor: false });
  assert.equal(opencodeOnly.replaced, 3);
  assert.match(opencodeOnly.text, /executor: opencode/);
  assert.doesNotMatch(opencodeOnly.text, /cursor-sdk|cursor-subagent|cursor-agent/);
  assert.match(opencodeOnly.text, /version: 1/);

  const withCursor = rewriteGraphExecutors(text, { hasOpencode: true, hasCursor: true });
  assert.equal(withCursor.replaced, 0);
  assert.equal(withCursor.text, text);

  const noOpencode = rewriteGraphExecutors(text, { hasOpencode: false, hasCursor: false });
  assert.equal(noOpencode.replaced, 0);
  assert.equal(noOpencode.text, text);
});

test("rewriteGraphExecutors keeps unrelated text intact", () => {
  const text = "nodes:\n  lite:\n    skill: cursor-atomic-lite\n    executor: cursor-sdk # comment\n";
  const res = rewriteGraphExecutors(text, { hasOpencode: true, hasCursor: false });
  assert.equal(res.replaced, 0);
  assert.equal(res.text, text);
});

test("install writes opencode.json and rewrites graph executors for opencode-only", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-install-"));
  try {
    const res = await install({ root: ".", target, harness: "opencode", force: true });
    const dest = join(target, "opencode.json");
    assert.ok(res.copied.includes(dest), `copied should include ${dest}`);
    const parsed = JSON.parse(await readFile(dest, "utf8"));
    assert.equal(parsed.permission.external_directory[EXTERNAL_KEY], "allow");

    const graph = await readFile(join(target, ".atomic", "graph.yaml"), "utf8");
    assert.doesNotMatch(graph, /executor: cursor-(sdk|subagent|agent)/);
    assert.match(graph, /executor: opencode/);
    assert.ok(res.overwritten.includes(join(target, ".atomic", "graph.yaml")));
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("install keeps cursor executors when cursor is also installed", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-cursor-install-"));
  try {
    await install({ root: ".", target, harness: "cursor,opencode", force: true });
    const graph = await readFile(join(target, ".atomic", "graph.yaml"), "utf8");
    assert.match(graph, /executor: cursor-subagent/);
    const parsed = JSON.parse(await readFile(join(target, "opencode.json"), "utf8"));
    assert.equal(parsed.permission.external_directory[EXTERNAL_KEY], "allow");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("install merges an existing opencode.json instead of clobbering it", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-merge-install-"));
  try {
    await writeFile(
      join(target, "opencode.json"),
      JSON.stringify({ model: "openai/gpt-5", permission: { external_directory: { "/srv/**": "allow" } } }),
      "utf8",
    );
    const res = await install({ root: ".", target, harness: "opencode", force: true });
    assert.ok(res.overwritten.includes(join(target, "opencode.json")));
    const parsed = JSON.parse(await readFile(join(target, "opencode.json"), "utf8"));
    assert.equal(parsed.model, "openai/gpt-5");
    assert.equal(parsed.permission.external_directory["/srv/**"], "allow");
    assert.equal(parsed.permission.external_directory[EXTERNAL_KEY], "allow");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("install does not create opencode.json for cursor-only installs", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-absent-"));
  try {
    await install({ root: ".", target, harness: "cursor", force: true });
    assert.equal(existsSync(join(target, "opencode.json")), false);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("invoke-worker.sh separates skills block and prompt with a blank line", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "invoke-skills-blank-"));
  const skillDir = join(tmp, ".agents", "skills", "tdd");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "# tdd", "utf8");
  const brief = join(tmp, "brief.md");
  await writeFile(brief, "hi", "utf8");
  const log = join(tmp, "run.log");
  try {
    const { stdout } = await execFileAsync("bash", [
      "scripts/invoke-worker.sh",
      "--worker",
      "opencode",
      "--workspace",
      tmp,
      "--prompt-file",
      brief,
      "--log-file",
      log,
      "--skills",
      "tdd",
      "--dry-run",
    ]);
    assert.match(stdout, /exit=0/);
    const effective = await readFile(join(tmp, "run.effective-prompt.md"), "utf8");
    assert.match(effective, /SKILL\.md\n\nhi/);
    assert.doesNotMatch(effective, /SKILL\.mdhi/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("lite skill writes the memory proposal under docsDir", async () => {
  const text = await readFile(join("skills", "atomic-lite", "SKILL.md"), "utf8");
  assert.doesNotMatch(text, /\/tmp\/memory-<slug>\.json/);
  assert.match(text, /<docsDir>\/memory-<slug>\.json/);
});
