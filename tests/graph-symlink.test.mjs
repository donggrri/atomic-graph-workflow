import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { assertInsideRepo } from "../scripts/lib/graph.mjs";

const V2_BASE = `version: 2
defaults: { executor: cursor-subagent }
nodes:
  review: { skill: atomic-review }
  test: { skill: atomic-test }
edges:
  - { from: review, to: test, on: pass }
`;

function writeV2Repo(repo) {
  mkdirSync(join(repo, ".atomic"), { recursive: true });
  writeFileSync(join(repo, ".atomic", "graph.yaml"), V2_BASE, "utf8");
}

function addNode(repo, ...extra) {
  return spawnSync(
    process.execPath,
    ["scripts/lib/graph.mjs", "add-node", ...extra, "--repo", repo],
    { encoding: "utf8" },
  );
}

test("add-node refuses --prompt through a symlinked dir escaping the repo", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-sym-"));
  const outside = mkdtempSync(join(tmpdir(), "addnode-out-"));
  try {
    writeV2Repo(repo);
    symlinkSync(outside, join(repo, "evil"), "dir");
    const before = readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8");
    const r = addNode(repo, "z", "--after", "review", "--prompt", "evil/zz.md");
    assert.notEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stderr + r.stdout, /symlink|escapes repository root/i);
    // Nothing written through the link, graph untouched.
    assert.deepEqual(readdirSync(outside), []);
    assert.equal(existsSync(join(repo, "evil", "zz.md")), false);
    assert.equal(readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8"), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("add-node refuses --skill scaffold through a symlinked dir escaping the repo", () => {
  const repo = mkdtempSync(join(tmpdir(), "addnode-sym-"));
  const outside = mkdtempSync(join(tmpdir(), "addnode-out-"));
  try {
    writeV2Repo(repo);
    mkdirSync(join(repo, ".agents", "skills"), { recursive: true });
    symlinkSync(outside, join(repo, ".agents", "skills", "y"), "dir");
    const before = readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8");
    const r = addNode(repo, "y", "--after", "review", "--skill", "y");
    assert.notEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stderr + r.stdout, /symlink|escapes repository root/i);
    // Nothing written through the link, graph untouched.
    assert.deepEqual(readdirSync(outside), []);
    assert.equal(readFileSync(join(repo, ".atomic", "graph.yaml"), "utf8"), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("assertInsideRepo allows '..foo' names but rejects '..' escapes", () => {
  const repo = mkdtempSync(join(tmpdir(), "assert-dotdot-"));
  try {
    const ok = assertInsideRepo(repo, join("..foo", "bar.md"));
    assert.equal(ok, join(repo, "..foo", "bar.md"));
    assert.throws(() => assertInsideRepo(repo, "../evil.md"), /escapes repository root/);
    assert.throws(() => assertInsideRepo(repo, "/etc/passwd"), /escapes repository root/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("assertInsideRepo refuses symlink escapes and symlink targets", () => {
  const repo = mkdtempSync(join(tmpdir(), "assert-sym-"));
  const outside = mkdtempSync(join(tmpdir(), "assert-out-"));
  try {
    symlinkSync(outside, join(repo, "evil"), "dir");
    assert.throws(() => assertInsideRepo(repo, "evil/zz.md", "--prompt"), /symlink|escapes repository root/);
    // A final path that exists and is itself a symlink is refused.
    const real = join(repo, "real.md");
    writeFileSync(real, "x", "utf8");
    symlinkSync(real, join(repo, "link.md"));
    assert.throws(() => assertInsideRepo(repo, "link.md"), /symlink/);
    // Ordinary nested paths still pass.
    assert.ok(assertInsideRepo(repo, "a/b/c.md").endsWith(join("a", "b", "c.md")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
