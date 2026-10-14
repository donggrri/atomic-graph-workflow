import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureCommandTrusted } from "../scripts/lib/command-trust.mjs";

test("ensureCommandTrusted scopes hash by repoRoot", async () => {
  const home = mkdtempSync(join(tmpdir(), "trust-home-"));
  const repoA = mkdtempSync(join(tmpdir(), "repo-a-"));
  const repoB = mkdtempSync(join(tmpdir(), "repo-b-"));
  try {
    mkdirSync(join(home, "memory"), { recursive: true });
    process.env.CURSOR_ATOMIC_TRUST_COMMANDS = "";
    const first = await ensureCommandTrusted("npm test", {
      workflowHome: home,
      repoRoot: repoA,
      nonInteractive: true,
    });
    assert.equal(first.ok, false);
    writeFileSync(
      join(home, "trusted-commands.json"),
      JSON.stringify({ hashes: [] }),
      "utf8",
    );
    const trusted = await ensureCommandTrusted("npm test", {
      workflowHome: home,
      repoRoot: repoA,
      nonInteractive: true,
    });
    assert.equal(trusted.ok, false);
  } finally {
    delete process.env.CURSOR_ATOMIC_TRUST_COMMANDS;
    rmSync(home, { recursive: true, force: true });
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
  }
});
