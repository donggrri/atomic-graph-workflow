/**
 * Bugbot gate + card seam (T1 implements scripts/lib/bugbot.mjs).
 *
 * import {
 *   BUGBOT_FAILED_MARKER,
 *   bugbotFindingsPath,
 *   buildBugbotCard,
 *   readBugbotFindings,
 *   bugbotGate,
 * } from "../scripts/lib/bugbot.mjs";
 *
 * export const BUGBOT_FAILED_MARKER = "BUGBOT_FAILED";
 * bugbotFindingsPath(runsDir) -> `<runsDir>/bugbot-findings.md`
 *
 * buildBugbotCard({ repoRoot, slug, planPath, tasksPath, findingsPath, pass }) -> BugbotCard
 *   BugbotCard = {
 *     kind: "bugbot",
 *     description: "Bugbot",
 *     subagent_type: "bugbot",
 *     run_in_background: false,
 *     pass,
 *     findingsPath,
 *     prompt,  // exactly 3 lines (see tests)
 *   }  // no `model` field
 *
 * readBugbotFindings(path) -> { present: boolean, failed: boolean }
 *   - missing file -> present: false
 *   - first non-empty line is BUGBOT_FAILED -> failed: true
 *
 * bugbotGate({ bugbot, pass, runsDir, repoRoot, slug, planPath, tasksPath, write? }) ->
 *   | { status: "pending", card, bugbot: { pass, status: "pending" } }
 *   | { status: "ready", findingsPath, failed, bugbot: { pass, status: "ready" } }
 *
 * Transitions (pass supplied by runner):
 *   - bugbot.pass === pass && status === "ready" -> ready (no side effects)
 *   - bugbot.pass === pass && status === "pending" -> findings exist ? ready : rewrite card, pending
 *   - else (first entry / pass change) -> archive findings to bugbot-findings.pass<N>.md,
 *     write next-card.json, stdout card JSON, pipeline.log line -> pending
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BUGBOT_FAILED_MARKER,
  bugbotFindingsPath,
  buildBugbotCard,
  readBugbotFindings,
  bugbotGate,
} from "../scripts/lib/bugbot.mjs";

const REPO_ROOT = "/tmp/bugbot-repo-root";
const SLUG = "bugbot-review";
const PLAN_PATH = "/home/user/docs/atomic-workflow/bugbot-review/PLAN-bugbot-review.md";
const TASKS_PATH = "/home/user/docs/atomic-workflow/bugbot-review/TASKS-bugbot-review.md";

/** @param {string} prefix */
function makeRunsDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** @param {() => void} fn */
function withStdoutCapture(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, cb) => {
    chunks.push(String(chunk));
    if (typeof encoding === "function") {
      encoding();
      return true;
    }
    if (typeof cb === "function") {
      cb();
    }
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

/** @param {number} pass */
function expectedPrompt(pass) {
  return [
    `Full Repository Path: ${REPO_ROOT}`,
    "Diff: branch changes",
    `Custom Instructions: atomic-workflow slug ${SLUG}, review pass ${pass}. Spec: PLAN ${PLAN_PATH}, TASKS ${TASKS_PATH}. Report only concrete bugs in the branch changes.`,
  ].join("\n");
}

/** @param {string} runsDir @param {number} pass @param {{ pass?: number, status?: string }} bugbot */
function gateArgs(runsDir, pass, bugbot) {
  return {
    bugbot,
    pass,
    runsDir,
    repoRoot: REPO_ROOT,
    slug: SLUG,
    planPath: PLAN_PATH,
    tasksPath: TASKS_PATH,
  };
}

test("BUGBOT_FAILED_MARKER constant", () => {
  assert.equal(BUGBOT_FAILED_MARKER, "BUGBOT_FAILED");
});

test("bugbotFindingsPath joins runsDir with bugbot-findings.md", () => {
  const runsDir = "/var/runs/my-slug";
  assert.equal(bugbotFindingsPath(runsDir), join(runsDir, "bugbot-findings.md"));
});

test("buildBugbotCard fixed fields and no model", () => {
  const runsDir = makeRunsDir("bugbot-card-");
  try {
    const findingsPath = bugbotFindingsPath(runsDir);
    const pass = 2;
    const card = buildBugbotCard({
      repoRoot: REPO_ROOT,
      slug: SLUG,
      planPath: PLAN_PATH,
      tasksPath: TASKS_PATH,
      findingsPath,
      pass,
    });
    assert.equal(card.kind, "bugbot");
    assert.equal(card.description, "Bugbot");
    assert.equal(card.subagent_type, "bugbot");
    assert.equal(card.run_in_background, false);
    assert.equal(card.pass, pass);
    assert.equal(card.findingsPath, findingsPath);
    assert.equal("model" in card, false);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("buildBugbotCard prompt is exactly three lines with substituted paths", () => {
  const runsDir = makeRunsDir("bugbot-prompt-");
  try {
    const findingsPath = bugbotFindingsPath(runsDir);
    const pass = 3;
    const card = buildBugbotCard({
      repoRoot: REPO_ROOT,
      slug: SLUG,
      planPath: PLAN_PATH,
      tasksPath: TASKS_PATH,
      findingsPath,
      pass,
    });
    const lines = card.prompt.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(card.prompt, expectedPrompt(pass));
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("readBugbotFindings missing file -> present false", () => {
  const runsDir = makeRunsDir("bugbot-read-missing-");
  try {
    const path = join(runsDir, "no-such-findings.md");
    assert.deepEqual(readBugbotFindings(path), { present: false, failed: false });
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("readBugbotFindings normal file -> present true, failed false", () => {
  const runsDir = makeRunsDir("bugbot-read-ok-");
  try {
    const path = join(runsDir, "findings.md");
    writeFileSync(path, "No concrete bugs in diff.\n", "utf8");
    assert.deepEqual(readBugbotFindings(path), { present: true, failed: false });
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("readBugbotFindings BUGBOT_FAILED on first non-empty line -> failed true", () => {
  const runsDir = makeRunsDir("bugbot-read-fail-");
  try {
    const path = join(runsDir, "findings.md");
    writeFileSync(path, "\n\nBUGBOT_FAILED\nDetails follow.\n", "utf8");
    assert.deepEqual(readBugbotFindings(path), { present: true, failed: true });
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("bugbotGate first entry -> pending, next-card.json, stdout card JSON", () => {
  const runsDir = makeRunsDir("bugbot-gate-first-");
  try {
    mkdirSync(runsDir, { recursive: true });
    const pass = 1;
    const bugbot = { pass: 0, status: "pending" };
    const expectedCard = buildBugbotCard({
      repoRoot: REPO_ROOT,
      slug: SLUG,
      planPath: PLAN_PATH,
      tasksPath: TASKS_PATH,
      findingsPath: bugbotFindingsPath(runsDir),
      pass,
    });

    let result;
    const stdout = withStdoutCapture(() => {
      result = bugbotGate(gateArgs(runsDir, pass, bugbot));
    });

    assert.equal(result.status, "pending");
    assert.deepEqual(result.bugbot, { pass, status: "pending" });
    assert.deepEqual(result.card, expectedCard);

    const nextCardPath = join(runsDir, "next-card.json");
    assert.equal(existsSync(nextCardPath), true);
    assert.deepEqual(JSON.parse(readFileSync(nextCardPath, "utf8")), expectedCard);

    const parsedStdout = JSON.parse(stdout.trim());
    assert.deepEqual(parsedStdout, expectedCard);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("bugbotGate pending with findings file -> ready", () => {
  const runsDir = makeRunsDir("bugbot-gate-ready-");
  try {
    mkdirSync(runsDir, { recursive: true });
    const pass = 1;
    const findingsPath = bugbotFindingsPath(runsDir);
    writeFileSync(findingsPath, "Review complete.\n", "utf8");
    const bugbot = { pass: 1, status: "pending" };

    const result = bugbotGate(gateArgs(runsDir, pass, bugbot));

    assert.equal(result.status, "ready");
    assert.equal(result.findingsPath, findingsPath);
    assert.equal(result.failed, false);
    assert.deepEqual(result.bugbot, { pass, status: "ready" });
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("bugbotGate pending without findings -> pending and card rewritten", () => {
  const runsDir = makeRunsDir("bugbot-gate-pending-");
  try {
    mkdirSync(runsDir, { recursive: true });
    const pass = 1;
    const bugbot = { pass: 1, status: "pending" };
    const nextCardPath = join(runsDir, "next-card.json");
    writeFileSync(nextCardPath, JSON.stringify({ stale: true }), "utf8");

    const expectedCard = buildBugbotCard({
      repoRoot: REPO_ROOT,
      slug: SLUG,
      planPath: PLAN_PATH,
      tasksPath: TASKS_PATH,
      findingsPath: bugbotFindingsPath(runsDir),
      pass,
    });

    const result = bugbotGate(gateArgs(runsDir, pass, bugbot));

    assert.equal(result.status, "pending");
    assert.deepEqual(result.bugbot, { pass, status: "pending" });
    assert.deepEqual(result.card, expectedCard);
    assert.deepEqual(JSON.parse(readFileSync(nextCardPath, "utf8")), expectedCard);
    assert.equal(existsSync(bugbotFindingsPath(runsDir)), false);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("bugbotGate pass change archives prior findings to bugbot-findings.pass1.md", () => {
  const runsDir = makeRunsDir("bugbot-gate-archive-");
  try {
    mkdirSync(runsDir, { recursive: true });
    const findingsPath = bugbotFindingsPath(runsDir);
    const priorBody = "Pass 1 findings.\n";
    writeFileSync(findingsPath, priorBody, "utf8");

    const pass = 2;
    const bugbot = { pass: 1, status: "ready" };

    const result = bugbotGate(gateArgs(runsDir, pass, bugbot));

    assert.equal(result.status, "pending");
    const archivePath = join(runsDir, "bugbot-findings.pass1.md");
    assert.equal(existsSync(archivePath), true);
    assert.equal(readFileSync(archivePath, "utf8"), priorBody);
    assert.equal(existsSync(findingsPath), false);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

test("bugbotGate first entry appends pipeline.log line", () => {
  const runsDir = makeRunsDir("bugbot-gate-log-");
  try {
    mkdirSync(runsDir, { recursive: true });
    const pass = 1;
    const bugbot = { pass: 0, status: "pending" };
    const findingsPath = bugbotFindingsPath(runsDir);
    const logPath = join(runsDir, "pipeline.log");

    withStdoutCapture(() => {
      bugbotGate(gateArgs(runsDir, pass, bugbot));
    });

    assert.equal(existsSync(logPath), true);
    const logLine = readFileSync(logPath, "utf8").trim();
    assert.equal(
      logLine,
      `bugbot card pending: pass ${pass}, findings ${findingsPath}`
    );
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
});
