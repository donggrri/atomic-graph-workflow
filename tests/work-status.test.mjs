import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  getWorkflowRoot,
  expandHomePath,
  workflowConfigPath,
  getShortRepo,
  getWorkflowPaths,
  ensureDocsDir,
  parseRepoArg,
  readStatus,
  writeStatus,
  updateStatus,
  listAllStatuses,
  syncFromFiles,
  syncSlug,
  inferPhase,
  importDocs,
  detectCursorSessionId,
  resolveSessionId,
} from "../scripts/work-status.mjs";

const workStatusCli = fileURLToPath(new URL("../scripts/work-status.mjs", import.meta.url));

test("getWorkflowRoot respects ATOMIC_WORKFLOW_HOME and defaults to ~/.atomic-workflow", () => {
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = "/custom/workflow/root";
    assert.equal(getWorkflowRoot(), "/custom/workflow/root");

    delete process.env.ATOMIC_WORKFLOW_HOME;
    assert.match(
      getWorkflowRoot(process.env, { configPath: join(tmpdir(), "no-atomic-config.json") }),
      /\.atomic-workflow$/
    );
  } finally {
    if (orig !== undefined) {
      process.env.ATOMIC_WORKFLOW_HOME = orig;
    } else {
      delete process.env.ATOMIC_WORKFLOW_HOME;
    }
  }
});

test("getWorkflowRoot reads config.json home after env, and ignores invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-home-"));
  const configPath = join(dir, "config.json");
  const homeDir = join(dir, "home");
  const absentEnv = {};
  try {
    assert.equal(expandHomePath("~/runs", "/home/test"), join("/home/test", "runs"));
    assert.equal(
      workflowConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/test"),
      join("/xdg", "atomic-workflow", "config.json")
    );

    writeFileSync(configPath, JSON.stringify({ home: "~/wf-data" }));
    assert.equal(
      getWorkflowRoot(absentEnv, { homeDir, configPath }),
      join(homeDir, "wf-data")
    );

    writeFileSync(configPath, "{");
    assert.equal(
      getWorkflowRoot(absentEnv, { homeDir, configPath }),
      join(homeDir, ".atomic-workflow")
    );

    writeFileSync(configPath, JSON.stringify({ home: "  " }));
    assert.equal(
      getWorkflowRoot(absentEnv, { homeDir, configPath }),
      join(homeDir, ".atomic-workflow")
    );

    assert.equal(
      getWorkflowRoot({ ATOMIC_WORKFLOW_HOME: "/from-env" }, { homeDir, configPath }),
      "/from-env"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getShortRepo normalizes repo basename to kebab-case and caps at 24 chars", () => {
  assert.equal(getShortRepo("/path/to/my-repo"), "my-repo");
  assert.equal(getShortRepo("/path/to/My_Awesome_Repo"), "my-awesome-repo");
  assert.equal(getShortRepo("/path/to/atomic-workflow"), "atomic-workflow");
  assert.equal(
    getShortRepo("/path/to/atomic-workflow-extra"),
    "atomic-workflow-extra"
  );
  assert.ok(getShortRepo("/path/to/very-very-very-very-long-project-name").length <= 24);
});

test("ensureDocsDir creates slug folder under workflow home", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const repo = mkdtempSync(join(tmpdir(), "wf-repo-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const slug = "path-slug";
    const docsDir = ensureDocsDir(repo, slug);
    const expected = join(tmpRoot, "docs", getShortRepo(repo), slug);
    assert.equal(docsDir, expected);
    assert.equal(existsSync(docsDir), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("path CLI prints absolute docsDir and honors --repo", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const repo = mkdtempSync(join(tmpdir(), "wf-repo-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const slug = "cli-path";
    const out = execFileSync(
      process.execPath,
      [workStatusCli, "path", slug, "--repo", repo],
      { encoding: "utf8", env: { ...process.env, ATOMIC_WORKFLOW_HOME: tmpRoot } }
    ).trim();
    assert.equal(out, join(tmpRoot, "docs", getShortRepo(repo), slug));
    assert.equal(existsSync(out), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("parseRepoArg strips --repo and resolves path", () => {
  const parsed = parseRepoArg(["path", "x", "--repo", "/tmp/my-repo", "--session-id", "bc-1"]);
  assert.equal(parsed.repo, join("/tmp/my-repo"));
  assert.deepEqual(parsed.rest, ["path", "x", "--session-id", "bc-1"]);
});

test("getWorkflowPaths returns docs, runs, evidence, and statusJson paths", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const paths = getWorkflowPaths("/fake/my-repo", "sample-slug");
    assert.equal(paths.shortRepo, "my-repo");
    assert.equal(paths.slug, "sample-slug");
    assert.equal(paths.docsDir, join(tmpRoot, "docs", "my-repo", "sample-slug"));
    assert.equal(paths.runsDir, join(tmpRoot, "runs", "my-repo", "sample-slug"));
    assert.equal(paths.statusJson, join(tmpRoot, "docs", "my-repo", "sample-slug", "STATUS.json"));
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("writeStatus and readStatus perform atomic write and read", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const repo = "/fake/my-repo";
    const slug = "test-atomic";

    const initial = await writeStatus(repo, slug, {
      slug,
      repo,
      worktree: null,
      cwd: repo,
      branch: "main",
      phase: "plan",
      tasks: { total: 3, done: 1, blockedId: null, blockedReason: null },
      lastCommand: "/atomic-plan",
    });

    assert.equal(initial.phase, "plan");
    assert.equal(initial.shortRepo, "my-repo");

    const loaded = await readStatus(repo, slug);
    assert.ok(loaded);
    assert.equal(loaded.slug, slug);
    assert.equal(loaded.phase, "plan");
    assert.equal(loaded.tasks.done, 1);

    const updated = await updateStatus(repo, slug, {
      phase: "execute",
      tasks: { total: 3, done: 2, blockedId: null, blockedReason: null },
    });
    assert.equal(updated.phase, "execute");
    assert.equal(updated.tasks.done, 2);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("writeStatus detects cross-repo collision and rejects overwrite", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const repoA = "/fake/repo-one/my-repo";
    const repoB = "/different/path/my-repo";
    const slug = "same-slug";

    await writeStatus(repoA, slug, {
      slug,
      repo: repoA,
      phase: "explore",
    });

    await assert.rejects(
      async () => {
        await writeStatus(repoB, slug, {
          slug,
          repo: repoB,
          phase: "explore",
        });
      },
      /collision/i
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("syncFromFiles parses TASKS file checkmarks and blockage", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const repo = "/fake/my-repo";
    const slug = "sync-slug";

    const paths = getWorkflowPaths(repo, slug);
    mkdirSync(paths.docsDir, { recursive: true });

    const tasksContent = `# TASKS: test
- [x] T1 done item
- [ ] T2 blocked item
  막힘: build failure in step 2
- [ ] T3 remaining
`;
    writeFileSync(join(paths.docsDir, `TASKS-${slug}.md`), tasksContent, "utf8");

    const synced = await syncFromFiles(repo, slug);
    assert.equal(synced.tasks.total, 3);
    assert.equal(synced.tasks.done, 1);
    assert.equal(synced.tasks.blockedId, "T2");
    assert.match(synced.tasks.blockedReason, /build failure/);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("listAllStatuses returns all recorded statuses across repos", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    await writeStatus("/fake/repo-a", "slug-1", { phase: "explore" });
    await writeStatus("/fake/repo-b", "slug-2", { phase: "execute" });

    const list = await listAllStatuses();
    assert.equal(list.length, 2);
    const slugs = list.map((item) => item.slug).sort();
    assert.deepEqual(slugs, ["slug-1", "slug-2"]);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("inferPhase derives phase from artifacts and task progress", () => {
  assert.equal(inferPhase({ explore: true }, {}), "explore");
  assert.equal(inferPhase({ plan: true }, {}), "plan");
  assert.equal(inferPhase({ tasks: true }, { total: 2, done: 0 }), "task");
  assert.equal(inferPhase({ tasks: true }, { total: 2, done: 1 }), "execute");
  assert.equal(
    inferPhase({ tasks: true }, { total: 2, done: 2 }),
    "review"
  );
  assert.equal(
    inferPhase({ review: true }, { total: 2, done: 2 }),
    "review"
  );
  assert.equal(
    inferPhase({ tasks: true }, { total: 2, done: 1, blockedId: "T2" }),
    "execute"
  );
});

test("syncSlug writes STATUS.json from slug-folder artifacts", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const slug = "auto-sync";
    const paths = getWorkflowPaths(repo, slug);
    mkdirSync(paths.docsDir, { recursive: true });
    writeFileSync(join(paths.docsDir, `PLAN-${slug}.md`), "# PLAN\n", "utf8");
    writeFileSync(
      join(paths.docsDir, `TASKS-${slug}.md`),
      "- [x] T1 done\n- [ ] T2 open\n",
      "utf8"
    );

    const synced = await syncSlug(repo, slug);
    assert.equal(synced.slug, slug);
    assert.equal(synced.phase, "execute");
    assert.equal(synced.artifacts.plan, true);
    assert.equal(synced.artifacts.tasks, true);
    assert.equal(synced.tasks.total, 2);
    assert.equal(synced.tasks.done, 1);

    const loaded = await readStatus(repo, slug);
    assert.equal(loaded.phase, "execute");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("syncSlug preserves complete phase unless phase is explicit", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const repo = "/fake/my-repo";
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const slug = "done-slug";
    await writeStatus(repo, slug, { phase: "complete" });
    const paths = getWorkflowPaths(repo, slug);
    mkdirSync(paths.docsDir, { recursive: true });
    writeFileSync(join(paths.docsDir, `PLAN-${slug}.md`), "# PLAN\n", "utf8");

    const kept = await syncSlug(repo, slug);
    assert.equal(kept.phase, "complete");

    const forced = await syncSlug(repo, slug, { phase: "commit" });
    assert.equal(forced.phase, "commit");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});

test("detectCursorSessionId reads CURSOR_CONVERSATION_ID", () => {
  assert.equal(
    detectCursorSessionId({ CURSOR_CONVERSATION_ID: "bc-01a0b3c6-8f63-7ecf-9edb-f7ef7a437751" }),
    "bc-01a0b3c6-8f63-7ecf-9edb-f7ef7a437751"
  );
  assert.equal(detectCursorSessionId({ CURSOR_CONVERSATION_ID: "  " }), null);
  assert.equal(detectCursorSessionId({}), null);
});

test("resolveSessionId prefers override, then Cursor env, then stored id", () => {
  assert.equal(
    resolveSessionId("cli-id", "old-id", { CURSOR_CONVERSATION_ID: "bc-env" }),
    "cli-id"
  );
  assert.equal(
    resolveSessionId(undefined, "old-id", { CURSOR_CONVERSATION_ID: "bc-env" }),
    "bc-env"
  );
  assert.equal(resolveSessionId(undefined, "old-id", {}), "old-id");
  assert.equal(resolveSessionId(undefined, null, {}), null);
});

test("writeStatus records Cursor sessionId from CURSOR_CONVERSATION_ID", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const origHome = process.env.ATOMIC_WORKFLOW_HOME;
  const origSession = process.env.CURSOR_CONVERSATION_ID;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    process.env.CURSOR_CONVERSATION_ID = "bc-test-session-id";
    const saved = await writeStatus("/fake/my-repo", "session-slug", { phase: "plan" });
    assert.equal(saved.sessionId, "bc-test-session-id");

    delete process.env.CURSOR_CONVERSATION_ID;
    const kept = await writeStatus("/fake/my-repo", "session-slug", { phase: "execute" });
    assert.equal(kept.sessionId, "bc-test-session-id");

    const overridden = await writeStatus("/fake/my-repo", "session-slug", {
      phase: "execute",
      sessionIdOverride: "bc-override",
    });
    assert.equal(overridden.sessionId, "bc-override");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (origHome !== undefined) process.env.ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
    if (origSession !== undefined) process.env.CURSOR_CONVERSATION_ID = origSession;
    else delete process.env.CURSOR_CONVERSATION_ID;
  }
});

test("syncSlug refreshes sessionId when Cursor conversation changes", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  const origHome = process.env.ATOMIC_WORKFLOW_HOME;
  const origSession = process.env.CURSOR_CONVERSATION_ID;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    process.env.CURSOR_CONVERSATION_ID = "bc-first";
    const slug = "session-sync";
    const paths = getWorkflowPaths(repo, slug);
    mkdirSync(paths.docsDir, { recursive: true });
    writeFileSync(join(paths.docsDir, `PLAN-${slug}.md`), "# PLAN\n", "utf8");

    const first = await syncSlug(repo, slug);
    assert.equal(first.sessionId, "bc-first");

    process.env.CURSOR_CONVERSATION_ID = "bc-second";
    const second = await syncSlug(repo, slug);
    assert.equal(second.sessionId, "bc-second");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (origHome !== undefined) process.env.ATOMIC_WORKFLOW_HOME = origHome;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
    if (origSession !== undefined) process.env.CURSOR_CONVERSATION_ID = origSession;
    else delete process.env.CURSOR_CONVERSATION_ID;
  }
});

test("bundled skill work-status.mjs matches scripts/work-status.mjs", () => {
  const root = readFileSync("scripts/work-status.mjs", "utf8");
  const bundled = readFileSync(
    ".atomic/scripts/work-status.mjs",
    "utf8"
  );
  assert.equal(bundled, root);
});

test("importDocs copies .docs slugs into global home and records origin paths", async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "wf-test-"));
  const repo = mkdtempSync(join(tmpdir(), "repo-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  try {
    process.env.ATOMIC_WORKFLOW_HOME = tmpRoot;
    const slugDir = join(repo, ".docs", "legacy-slug");
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(join(slugDir, "PLAN-legacy-slug.md"), "# PLAN\n", "utf8");
    writeFileSync(join(slugDir, "TASKS-legacy-slug.md"), "- [x] T1 done\n- [ ] T2 open\n", "utf8");

    const imported = await importDocs(repo, join(repo, ".docs"));
    assert.equal(imported.length, 1);
    assert.equal(imported[0].slug, "legacy-slug");
    assert.equal(imported[0].repo, repo);
    assert.equal(imported[0].sourceDocs, slugDir);
    assert.equal(imported[0].artifacts.plan, true);
    assert.equal(imported[0].artifacts.tasks, true);
    assert.equal(imported[0].tasks.total, 2);
    assert.equal(imported[0].tasks.done, 1);
    assert.equal(imported[0].phase, "execute");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
});
