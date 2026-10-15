import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readEnv,
  ensureWorkflowHomeDir,
  resolveProjectSettingsReadPath,
  projectSettingsWritePath,
  LEGACY_PROJECT_SETTINGS_FILE,
  PROJECT_SETTINGS_FILE,
} from "../scripts/lib/legacy-paths.mjs";

test("readEnv prefers ATOMIC_ over CURSOR_ATOMIC_", () => {
  assert.equal(readEnv({ ATOMIC_FOO: "new", CURSOR_ATOMIC_FOO: "old" }, "FOO"), "new");
  assert.equal(readEnv({ CURSOR_ATOMIC_FOO: "old" }, "FOO"), "old");
  assert.equal(readEnv({}, "FOO"), undefined);
});

test("ensureWorkflowHomeDir renames legacy home once", () => {
  const home = mkdtempSync(join(tmpdir(), "legacy-home-"));
  try {
    const legacy = join(home, ".cursor-atomic-workflow");
    const modern = join(home, ".atomic-workflow");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "marker.txt"), "x", "utf8");
    const resolved = ensureWorkflowHomeDir({ homeDir: home });
    assert.equal(resolved, modern);
    assert.ok(existsSync(join(modern, "marker.txt")));
    assert.equal(existsSync(legacy), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveProjectSettingsReadPath falls back to legacy filename", () => {
  const repo = mkdtempSync(join(tmpdir(), "legacy-settings-"));
  try {
    const legacyPath = join(repo, LEGACY_PROJECT_SETTINGS_FILE);
    writeFileSync(legacyPath, '{"docsRoot":"specs"}\n', "utf8");
    assert.equal(resolveProjectSettingsReadPath(repo), legacyPath);
    assert.equal(projectSettingsWritePath(repo), join(repo, PROJECT_SETTINGS_FILE));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
