import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expandHome,
  getProfile,
  plannerProfileLines,
  resolveProfileId,
  testerStep,
} from "../scripts/lib/profiles.mjs";
import { parseArgs } from "../scripts/run-pipeline.mjs";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "profiles-"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value), "utf8");
}

test("expandHome replaces a leading tilde", () => {
  assert.equal(expandHome("~/edge/a.md", "/home/me"), "/home/me/edge/a.md");
  assert.equal(expandHome("/abs/a.md", "/home/me"), "/abs/a.md");
});

test("atomic tester step matches the historical prompt and npm test", () => {
  const root = tempRoot();
  try {
    const loaded = getProfile("atomic", {
      packageRoot: root,
      workflowHome: root,
      repoRoot: root,
      homeDir: root,
    });
    assert.equal(loaded.ok, true);
    assert.deepEqual(plannerProfileLines(loaded.profile, "/tmp/PLAN.md"), []);
    assert.deepEqual(testerStep(loaded.profile, "pipe-run"), {
      prompt: "Test slug pipe-run",
      done: "npm test",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repo profile overrides home, home overrides package", () => {
  const root = tempRoot();
  const home = join(root, "home");
  const pkg = join(root, "pkg");
  const repo = join(root, "repo");
  const homeDir = join(root, "user");
  try {
    for (const dir of [pkg, home, repo]) {
      mkdirSync(join(dir, "profiles"), { recursive: true });
    }
    const cmd = join(root, "cmd.md");
    writeFileSync(cmd, "# cmd\n", "utf8");
    writeJson(join(pkg, "profiles", "ext.json"), {
      id: "ext",
      test: { command: cmd, done: "from-pkg" },
    });
    writeJson(join(home, "profiles", "ext.json"), {
      id: "ext",
      test: { command: cmd, done: "from-home" },
    });
    writeJson(join(repo, "profiles", "ext.json"), {
      id: "ext",
      plan: { command: cmd },
      test: { command: cmd },
      extra: true,
    });

    const loaded = getProfile("ext", {
      packageRoot: pkg,
      workflowHome: home,
      repoRoot: repo,
      homeDir,
    });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.profile.test.done, null);
    assert.equal(loaded.profile.plan.command, cmd);
    assert.ok(loaded.warnings.some((line) => line.includes("unsupported key")));
    const step = testerStep(loaded.profile, "slug");
    assert.match(step.prompt, /Profile test command: /);
    assert.match(step.prompt, /do not SSH/);
    assert.equal(step.done, null);
    assert.match(plannerProfileLines(loaded.profile, "/p/PLAN.md")[0], /write the output only to \/p\/PLAN.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing command file, relative path, id mismatch, and unknown id fail", () => {
  const root = tempRoot();
  const pkg = join(root, "pkg");
  try {
    mkdirSync(join(pkg, "profiles"), { recursive: true });
    writeJson(join(pkg, "profiles", "gone.json"), {
      id: "gone",
      test: { command: join(root, "missing.md") },
    });
    writeJson(join(pkg, "profiles", "rel.json"), {
      id: "rel",
      plan: { command: "relative.md" },
    });
    writeJson(join(pkg, "profiles", "bad.json"), {
      id: "other",
    });
    const opts = { packageRoot: pkg, workflowHome: root, repoRoot: root, homeDir: root };
    assert.match(getProfile("gone", opts).reason, /not found/);
    assert.match(getProfile("rel", opts).reason, /absolute or start with ~/);
    assert.match(getProfile("bad", opts).reason, /does not match file name/);
    const unknown = getProfile("nope", opts);
    assert.equal(unknown.ok, false);
    assert.match(unknown.reason, /unknown profile: nope/);
    assert.match(unknown.reason, /atomic/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("test.done alone replaces npm test and keeps the atomic prompt", () => {
  const root = tempRoot();
  const pkg = join(root, "pkg");
  try {
    mkdirSync(join(pkg, "profiles"), { recursive: true });
    writeJson(join(pkg, "profiles", "done.json"), {
      id: "done",
      test: { done: "echo ok" },
    });
    const loaded = getProfile("done", {
      packageRoot: pkg,
      workflowHome: root,
      repoRoot: root,
      homeDir: root,
    });
    assert.equal(testerStep(loaded.profile, "slug").prompt, "Test slug slug");
    assert.equal(testerStep(loaded.profile, "slug").done, "echo ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProfileId prefers cli, then project, then global, then atomic", () => {
  const root = tempRoot();
  const repo = join(root, "repo");
  const home = join(root, "wf");
  try {
    mkdirSync(repo, { recursive: true });
    mkdirSync(home, { recursive: true });
    const base = { repoRoot: repo, workflowHome: home };
    assert.deepEqual(resolveProfileId({ ...base, cliProfile: "bsp" }), {
      ok: true,
      id: "bsp",
      source: "cli",
    });
    writeJson(join(home, "settings.json"), { profile: "bsp" });
    assert.equal(resolveProfileId(base).id, "bsp");
    writeJson(join(repo, ".atomic-workflow.json"), { profile: "atomic" });
    assert.equal(resolveProfileId(base).id, "atomic");
    assert.equal(resolveProfileId(base).source, "project");
    writeFileSync(join(home, "settings.json"), "{", "utf8");
    writeFileSync(join(repo, ".atomic-workflow.json"), "", "utf8");
    assert.equal(resolveProfileId(base).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bsp.json.example is not a shipped profile", () => {
  const names = readdirSync("profiles");
  assert.ok(names.includes("bsp.json.example"));
  assert.equal(names.includes("bsp.json"), false);
  const example = readFileSync("profiles/bsp.json.example", "utf8");
  assert.doesNotMatch(example, /edge_bsp_foundation/);
  assert.match(example, /"id": "bsp"/);
  const root = tempRoot();
  try {
    const loaded = getProfile("bsp", {
      packageRoot: process.cwd(),
      workflowHome: root,
      repoRoot: root,
      homeDir: root,
    });
    assert.equal(loaded.ok, false);
    assert.match(loaded.reason, /unknown profile: bsp/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverProfiles ignores example json names", () => {
  const root = tempRoot();
  const pkg = join(root, "pkg");
  try {
    mkdirSync(join(pkg, "profiles"), { recursive: true });
    writeJson(join(pkg, "profiles", "demo.example.json"), {
      id: "demo.example",
      plan: { command: "~/missing.md" },
    });
    writeFileSync(join(pkg, "profiles", "bsp.json.example"), "{}\n", "utf8");
    const loaded = getProfile("demo.example", {
      packageRoot: pkg,
      workflowHome: root,
      repoRoot: root,
      homeDir: root,
    });
    assert.match(loaded.reason, /unknown profile: demo\.example/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseArgs requires a --profile value", () => {
  const missing = parseArgs(["node", "run-pipeline.mjs", "slug", "--profile"]);
  assert.match(missing.error, /missing --profile/);
  const ok = parseArgs(["node", "run-pipeline.mjs", "slug", "--profile", "bsp", "--dry-run"]);
  assert.equal(ok.profileId, "bsp");
  assert.equal(ok.flags.dryRun, true);
});
