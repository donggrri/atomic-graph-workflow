import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { detectHarnessesSync } from "../scripts/lib/harnesses.mjs";
import { install } from "../scripts/install.mjs";

test("detectHarnessesSync does not treat .agents/skills alone as agy", async () => {
  const target = await mkdtemp(join(tmpdir(), "harness-agy-fp-"));
  try {
    await mkdir(join(target, ".cursor"), { recursive: true });
    await mkdir(join(target, ".agents", "skills"), { recursive: true });
    const found = detectHarnessesSync(target);
    assert.equal(found.has("agy"), false);
    assert.equal(found.has("cursor"), true);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("after cursor-only install, auto detection does not include agy", async () => {
  const target = await mkdtemp(join(tmpdir(), "harness-cursor-only-"));
  try {
    await mkdir(join(target, ".cursor"), { recursive: true });
    await install({ root: ".", target, harness: "cursor", force: true, quiet: true });
    const found = detectHarnessesSync(target);
    assert.equal(found.has("agy"), false);
    assert.equal(found.has("cursor"), true);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
