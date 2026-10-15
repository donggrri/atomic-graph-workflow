#!/usr/bin/env node
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveBin } from "./lib/cli-detect.mjs";
import { spawnCliWith } from "./lib/exec-cross.mjs";
import { readDocsRoot } from "./lib/project-settings.mjs";
import {
  resolveHermesRoute,
  isHermesRunnerOnPath,
  loadHermesRoutingOverrides,
} from "./lib/hermes-routing.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} repoRoot
 */
export function delegateLogPath(repoRoot) {
  const docsRoot = readDocsRoot(repoRoot);
  if (docsRoot) {
    return join(resolve(repoRoot), docsRoot, "hermes-delegate.log");
  }
  return join(resolve(repoRoot), ".atomic", "hermes-delegate.log");
}

/**
 * @param {string} repoRoot
 */
export async function readLastImplementRunner(repoRoot) {
  const logPath = delegateLogPath(repoRoot);
  if (!existsSync(logPath)) return null;
  const text = await readFile(logPath, "utf8");
  const lines = text.trim().split(/\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      const stage = String(row.stage ?? "").toLowerCase();
      if (["execute", "implement", "fix", "task"].includes(stage) && row.runner) {
        return String(row.runner);
      }
    } catch {
      // skip bad lines
    }
  }
  return null;
}

/**
 * @param {string} stage
 * @param {{ repoRoot?: string }} [options]
 */
export async function routeStage(stage, options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const lastImplementRunner = await readLastImplementRunner(repoRoot);
  const overrides = loadHermesRoutingOverrides(repoRoot);
  const resolved = resolveHermesRoute(stage, { repoRoot, lastImplementRunner, overrides });
  const out = {
    stage: resolved.stage,
    runner: resolved.runner,
    model: resolved.model,
    fallback: resolved.fallback,
  };
  if (resolved.warning) out.warning = resolved.warning;
  return out;
}

/**
 * @param {{ runner: string, model: string, workspace: string, promptFile: string, timeoutSec?: number, spawnFn?: typeof spawn }} opts
 */
export async function runRunnerCli(opts) {
  const prompt = await readFile(opts.promptFile, "utf8");
  const timeoutSec = Math.min(opts.timeoutSec ?? 560, 590);

  if (opts.runner === "cursor-agent") {
    const bin = resolveBin(["cursor-agent", "agent"]);
    if (!bin) return { ok: false, kind: "startup", exitCode: 1, message: "cursor-agent not on PATH" };
    const args = [
      "-p",
      "--model",
      opts.model,
      "--trust",
      "--force",
      "--workspace",
      opts.workspace,
      prompt,
    ];
    const child = spawnCliWith(opts.spawnFn ?? spawn, bin, args, {
      cwd: opts.workspace,
      env: process.env,
      stdio: ["ignore", "inherit", "pipe"],
    });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(124);
      }, timeoutSec * 1000);
      let stderr = "";
      child.stderr?.on("data", (c) => {
        stderr += String(c);
      });
      child.on("error", reject);
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve(c ?? 1);
      });
    }).catch((err) => ({ ok: false, message: String(err) }));
    if (typeof code === "object") return { ok: false, kind: "run", exitCode: 1, message: code.message };
    if (code === 0) return { ok: true, exitCode: 0 };
    if (code === 124) return { ok: false, kind: "run", exitCode: 124, message: "cursor-agent timed out" };
    return { ok: false, kind: "run", exitCode: code, message: `cursor-agent exit ${code}` };
  }

  if (opts.runner === "agy") {
    const bin = resolveBin(["agy"]);
    if (!bin) return { ok: false, kind: "startup", exitCode: 1, message: "agy not on PATH" };
    const args = ["--model", opts.model, "--mode", "accept-edits", "--print-timeout", `${timeoutSec}s`, "-p", prompt];
    const child = spawnCliWith(opts.spawnFn ?? spawn, bin, args, {
      cwd: opts.workspace,
      env: process.env,
      stdio: ["ignore", "inherit", "pipe"],
    });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(124);
      }, timeoutSec * 1000);
      child.stderr?.on("data", () => {});
      child.on("error", reject);
      child.on("close", (c) => {
        clearTimeout(timer);
        resolve(c ?? 1);
      });
    }).catch((err) => ({ ok: false, message: String(err) }));
    if (typeof code === "object") return { ok: false, kind: "run", exitCode: 1, message: code.message };
    if (code === 0) return { ok: true, exitCode: 0 };
    if (code === 124) return { ok: false, kind: "run", exitCode: 124, message: "agy timed out" };
    return { ok: false, kind: "run", exitCode: code, message: `agy exit ${code}` };
  }

  return { ok: false, kind: "run", exitCode: 1, message: `unknown runner ${opts.runner}` };
}

/**
 * @param {{ stage: string, workspace: string, promptFile: string, dryRun?: boolean, spawnFn?: typeof spawn }} opts
 */
export async function runDelegatedStage(opts) {
  const workspace = resolve(opts.workspace);
  const routed = await routeStage(opts.stage, { repoRoot: workspace });
  let runner = routed.runner;
  let model = routed.model;
  let fallbackUsed = false;

  if (opts.dryRun) {
    return { ...routed, exitCode: 0, fallbackUsed: false, dryRun: true };
  }

  // Whole stage (primary + fallback) must stay under Hermes' 600s foreground limit.
  const budgetSec = Math.min(opts.timeoutSec ?? 560, 590);
  const startedAt = Date.now();
  let result = await runRunnerCli({
    timeoutSec: budgetSec,
    runner,
    model,
    workspace,
    promptFile: opts.promptFile,
    spawnFn: opts.spawnFn,
  });

  if (!result.ok) {
    const fb = routed.fallback;
    const remainingSec = Math.floor(budgetSec - (Date.now() - startedAt) / 1000);
    if (remainingSec >= 30 && isHermesRunnerOnPath(fb.runner) && (fb.runner !== runner || fb.model !== model)) {
      fallbackUsed = true;
      runner = fb.runner;
      model = fb.model;
      result = await runRunnerCli({
        timeoutSec: remainingSec,
        runner,
        model,
        workspace,
        promptFile: opts.promptFile,
        spawnFn: opts.spawnFn,
      });
    }
  }

  const logPath = delegateLogPath(workspace);
  await mkdir(dirname(logPath), { recursive: true });
  const row = {
    ts: new Date().toISOString(),
    stage: opts.stage,
    runner,
    model,
    exit: result.exitCode ?? (result.ok ? 0 : 1),
    fallbackUsed,
  };
  await appendFile(logPath, `${JSON.stringify(row)}\n`, "utf8");

  return { ...routed, runner, model, exitCode: row.exit, fallbackUsed, ok: result.ok };
}

function parseArgs(argv) {
  const cmd = argv[0];
  if (cmd === "route") {
    return { cmd, stage: argv[1] };
  }
  if (cmd === "run") {
    const out = { cmd, stage: argv[1], workspace: process.cwd(), promptFile: null, dryRun: false };
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--workspace" && argv[i + 1]) out.workspace = argv[++i];
      else if (argv[i] === "--prompt-file" && argv[i + 1]) out.promptFile = argv[++i];
      else if (argv[i] === "--dry-run") out.dryRun = true;
    }
    return out;
  }
  return { cmd: null };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.cmd === "route" && parsed.stage) {
    const json = await routeStage(parsed.stage, { repoRoot: process.cwd() });
    if (json.warning) console.error(json.warning);
    console.log(JSON.stringify(json));
    return;
  }
  if (parsed.cmd === "run" && parsed.stage && parsed.promptFile) {
    const res = await runDelegatedStage({
      stage: parsed.stage,
      workspace: parsed.workspace,
      promptFile: parsed.promptFile,
      dryRun: parsed.dryRun,
    });
    if (!res.ok && !parsed.dryRun) process.exitCode = res.exitCode && res.exitCode !== 0 ? res.exitCode : 1;
    return;
  }
  console.error(`Usage: node scripts/hermes-delegate.mjs route <stage>
       node scripts/hermes-delegate.mjs run <stage> --workspace <repo> --prompt-file <f> [--dry-run]`);
  process.exit(2);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
