import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";
import {
  ATOMIC_SCRIPT_DIR,
  bundledScriptDiffs,
  syncBundledScripts,
} from "../scripts/sync-bundled.mjs";

test("package .atomic/scripts matches scripts/", async () => {
  assert.deepEqual(await bundledScriptDiffs({ cwd: process.cwd() }), []);
});

test("syncBundledScripts copies root scripts and --check sees drift", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sync-bundled-"));
  try {
    const name = "work-status.mjs";
    await mkdir(join(cwd, "scripts"), { recursive: true });
    await mkdir(join(cwd, ATOMIC_SCRIPT_DIR), { recursive: true });
    await writeFile(join(cwd, "scripts", name), `root ${name}\n`, "utf8");
    await writeFile(join(cwd, ATOMIC_SCRIPT_DIR, name), `old ${name}\n`, "utf8");
    const drifted = await bundledScriptDiffs({ cwd });
    assert.deepEqual(drifted, [name]);

    await syncBundledScripts({ cwd });
    assert.deepEqual(await bundledScriptDiffs({ cwd }), []);
    const text = await readFile(join(cwd, ATOMIC_SCRIPT_DIR, name), "utf8");
    assert.equal(text, "root work-status.mjs\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
