import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { install } from "../scripts/install.mjs";

const HARNESS_CASES = [
  { harness: "cursor", prep: (target) => mkdir(join(target, ".cursor"), { recursive: true }) },
  { harness: "opencode", prep: (target) => mkdir(join(target, ".opencode"), { recursive: true }) },
  { harness: "codex", prep: async () => {} },
  { harness: "pi", prep: (target) => mkdir(join(target, ".pi"), { recursive: true }) },
  { harness: "agy", prep: async () => {} },
  { harness: "claude", prep: async () => {}, withClaude: true },
];

/**
 * @param {string} cwd installed project root
 * @param {string} memoryHome isolated workflow vault
 * @param {string[]} args memory.mjs args
 */
function runInstalledMemory(cwd, memoryHome, args) {
  const script = join(cwd, ".atomic", "scripts", "memory.mjs");
  return execFileSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, CURSOR_ATOMIC_WORKFLOW_HOME: memoryHome },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

for (const { harness, prep, withClaude } of HARNESS_CASES) {
  test(`installed memory.mjs CLI for harness ${harness}`, async () => {
    const target = await mkdtemp(join(tmpdir(), `memory-install-${harness}-`));
    const memoryHome = await mkdtemp(join(tmpdir(), `memory-vault-${harness}-`));
    try {
      await prep(target);
      await install({
        root: ".",
        target,
        harness,
        force: true,
        quiet: true,
        ...(withClaude ? { withClaude: true } : {}),
      });

      const marker = `memory-install-${harness}-${Date.now()}`;
      const shortRepo = runInstalledMemory(target, memoryHome, ["repo", "."]).trim();
      assert.match(shortRepo, /^[a-z0-9][a-z0-9_-]{0,23}$/, "shortRepo from repo .");

      const before = runInstalledMemory(target, memoryHome, ["context", shortRepo]);
      assert.doesNotMatch(before, new RegExp(marker));

      const batchPath = join(memoryHome, "propose-batch.json");
      await writeFile(
        batchPath,
        `${JSON.stringify(
          {
            shortRepo,
            slug: "memory-install-test",
            items: [{ target: `projects/${shortRepo}.md`, text: marker }],
          },
          null,
          2,
        )}\n`,
      );

      const proposeOut = runInstalledMemory(target, memoryHome, ["propose", "--auto", batchPath]);
      assert.match(proposeOut, /자동 저장: 1/);

      const after = runInstalledMemory(target, memoryHome, ["context", shortRepo]);
      assert.match(after, new RegExp(marker));
      assert.match(after, /^<memory>/m);
    } finally {
      await rm(target, { recursive: true, force: true });
      await rm(memoryHome, { recursive: true, force: true });
    }
  });
}
