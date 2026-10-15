import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runGraphStage } from "../scripts/lib/stage-run.mjs";

test("GRAPH-V2.md documents the --prompt-file trust boundary", () => {
  const text = readFileSync("docs/GRAPH-V2.md", "utf8");
  assert.ok(text.includes("--prompt-file"), "mentions --prompt-file");
  assert.ok(/trusted/i.test(text), "calls --prompt-file trusted");
  assert.ok(text.includes("node.prompt"), "mentions node.prompt");
  assert.ok(/must stay inside/i.test(text), "confines node.prompt to the repo");
});

test("run-stage.mjs usage documents --prompt-file as trusted", () => {
  const text = readFileSync("scripts/run-stage.mjs", "utf8");
  assert.ok(text.includes("trusted CLI argument"), "trusted CLI comment present");
  assert.ok(text.includes("node.prompt in graph.yaml"), "contrasts node.prompt");
});

test("--prompt-file accepts an outside absolute path (trusted CLI arg)", () => {
  const repo = mkdtempSync(join(tmpdir(), "promptfile-repo-"));
  const outside = mkdtempSync(join(tmpdir(), "promptfile-out-"));
  try {
    const promptPath = join(outside, "prompt.md");
    writeFileSync(promptPath, "hello from outside", "utf8");
    const r = spawnSync(
      process.execPath,
      ["scripts/run-stage.mjs", "no-such-stage", "--repo", repo, "--prompt-file", promptPath],
      { encoding: "utf8" },
    );
    const out = r.stderr + r.stdout;
    assert.match(out, /unknown stage/, out);
    assert.doesNotMatch(out, /escapes repository root/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("stage-run does not read node.prompt escaping the repo through a symlink", async () => {
  const home = mkdtempSync(join(tmpdir(), "atomic-home-"));
  const prevHome = process.env.ATOMIC_WORKFLOW_HOME;
  process.env.ATOMIC_WORKFLOW_HOME = home;
  const repo = mkdtempSync(join(tmpdir(), "stage-sym-"));
  const outside = mkdtempSync(join(tmpdir(), "stage-out-"));
  try {
    mkdirSync(join(repo, ".atomic"), { recursive: true });
    writeFileSync(
      join(repo, ".atomic", "graph.yaml"),
      `version: 2
nodes:
  scan: { prompt: evil/p.md }
edges:
  - { from: scan, to: $end, on: pass }
`,
      "utf8",
    );
    writeFileSync(join(outside, "p.md"), "OUTSIDE-MARKER", "utf8");
    symlinkSync(outside, join(repo, "evil"), "dir");
    let gotPrompt = "";
    const result = await runGraphStage({
      repoRoot: repo,
      stage: "scan",
      prompt: "user prompt",
      slug: "s1",
      adapter: {
        mode: "sdk",
        async runRole(params) {
          gotPrompt = params.prompt;
          return { ok: true, summary: "ok" };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.ok(gotPrompt.includes("user prompt"));
    assert.ok(!gotPrompt.includes("OUTSIDE-MARKER"), "outside prompt file must not be read");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.ATOMIC_WORKFLOW_HOME;
    else process.env.ATOMIC_WORKFLOW_HOME = prevHome;
  }
});
