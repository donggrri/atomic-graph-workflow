#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile, unlink, open } from "node:fs/promises";
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
  isFallbackEnabledForStage,
} from "./lib/hermes-routing.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export const STDERR_TAIL_MAX = 4000;
export const OPENCODE_LOCK_REL = join(".atomic", "opencode-run.lock");
export const HERMES_ATOMIC_LOG_REL = join(".atomic", "hermes-delegate.log");

/** @type {readonly RegExp[]} */
export const HERMES_FAILURE_STDERR_PATTERNS = [
  /permission[\s_-]*denied/i,
  /auto[\s_-]*denied/i,
  /no[\s_-]*output/i,
];

/**
 * @param {string} stderr
 */
export function truncateStderr(stderr, maxLen = STDERR_TAIL_MAX) {
  const text = String(stderr ?? "");
  if (text.length <= maxLen) return text;
  return text.slice(-maxLen);
}

/**
 * @param {{ exitCode: number, stdout?: string, stderr?: string }} result
 * @returns {{ failed: boolean, message?: string }}
 */
export function detectDelegatedFailure(result) {
  const exitCode = result.exitCode ?? 1;
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "");

  if (exitCode !== 0) {
    return { failed: true, message: `runner exit ${exitCode}` };
  }

  if (!stdout) {
    return { failed: true, message: "runner exited 0 with empty stdout" };
  }

  for (const re of HERMES_FAILURE_STDERR_PATTERNS) {
    if (re.test(stderr)) {
      return { failed: true, message: `runner stderr matched failure pattern: ${re}` };
    }
  }

  return { failed: false };
}

/**
 * @param {string} repoRoot
 */
export function atomicHermesLogPath(repoRoot) {
  return join(resolve(repoRoot), HERMES_ATOMIC_LOG_REL);
}

/**
 * @param {string} repoRoot
 */
export function delegateLogPath(repoRoot) {
  const docsRoot = readDocsRoot(repoRoot);
  if (docsRoot) {
    return join(resolve(repoRoot), docsRoot, "hermes-delegate.log");
  }
  return atomicHermesLogPath(repoRoot);
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
  const routingConfig = loadHermesRoutingOverrides(repoRoot);
  const resolved = resolveHermesRoute(stage, {
    repoRoot,
    lastImplementRunner,
    overrides: routingConfig.overrides,
    routingConfig,
  });
  const out = {
    stage: resolved.stage,
    runner: resolved.runner,
    model: resolved.model,
    fallback: resolved.fallback,
    fallbackEnabled: resolved.fallbackEnabled,
  };
  if (resolved.warning) out.warning = resolved.warning;
  return out;
}

/**
 * @param {string} lockPath
 * @param {number} timeoutMs
 */
export async function acquireOpencodeLock(lockPath, timeoutMs = 120_000) {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.write(String(process.pid));
      await handle.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // ignore
        }
      };
    } catch (err) {
      if (err && typeof err === "object" && err.code !== "EEXIST") {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
}

/**
 * @param {string} workspace
 */
export async function buildOpencodeHeadlessEnv(workspace) {
  const configPath = join(workspace, ".atomic", "hermes-opencode-run.json");
  await mkdir(dirname(configPath), { recursive: true });
  const config = {
    $schema: "https://opencode.ai/config.json",
    permission: {
      bash: "allow",
      edit: "allow",
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return {
    ...process.env,
    OPENCODE_CONFIG: configPath,
    OPENCODE_PERMISSION: "bash=allow,edit=allow",
  };
}

/**
 * @param {{ runner: string, model: string, workspace: string, promptFile: string, stage?: string, timeoutSec?: number, spawnFn?: typeof spawn }} opts
 */
export async function runRunnerCli(opts) {
  const prompt = await readFile(opts.promptFile, "utf8");
  const timeoutSec = Math.min(opts.timeoutSec ?? 560, 590);
  const stage = String(opts.stage ?? "").toLowerCase();
  const needsHeadlessPermissions = stage === "plan" || stage === "plan-review";

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
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { code, stdout, stderr } = await collectChildOutput(child, timeoutSec, "cursor-agent");
    if (code && typeof code === "object") {
      return { ok: false, kind: "run", exitCode: 1, message: code.message, stderr };
    }
    const failure = detectDelegatedFailure({ exitCode: code, stdout, stderr });
    if (failure.failed) {
      return {
        ok: false,
        kind: "run",
        exitCode: code === 0 ? 1 : code,
        message: failure.message,
        stdout,
        stderr,
      };
    }
    if (code === 0) return { ok: true, exitCode: 0, stdout, stderr };
    if (code === 124) return { ok: false, kind: "run", exitCode: 124, message: "cursor-agent timed out", stderr };
    return { ok: false, kind: "run", exitCode: code, message: `cursor-agent exit ${code}`, stderr };
  }

  if (opts.runner === "opencode") {
    const bin = resolveBin(["opencode"]);
    if (!bin) return { ok: false, kind: "startup", exitCode: 1, message: "opencode not on PATH" };
    const lockPath = join(opts.workspace, OPENCODE_LOCK_REL);
    const lockWaitMs = Math.min(5_000, timeoutSec * 1000);
    const release = await acquireOpencodeLock(lockPath, lockWaitMs);
    if (!release) {
      return {
        ok: false,
        kind: "run",
        exitCode: 1,
        message: "opencode run lock timeout (another opencode run is in progress)",
      };
    }
    try {
      const env = needsHeadlessPermissions
        ? await buildOpencodeHeadlessEnv(opts.workspace)
        : process.env;
      const args = ["run", "-m", opts.model, prompt];
      const child = spawnCliWith(opts.spawnFn ?? spawn, bin, args, {
        cwd: opts.workspace,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const { code, stdout, stderr } = await collectChildOutput(child, timeoutSec, "opencode");
      const failure = detectDelegatedFailure({ exitCode: code, stdout, stderr });
      if (failure.failed) {
        return {
          ok: false,
          kind: "run",
          exitCode: code === 0 ? 1 : code,
          message: failure.message,
          stdout,
          stderr,
        };
      }
      if (code === 0) return { ok: true, exitCode: 0, stdout, stderr };
      if (code === 124) return { ok: false, kind: "run", exitCode: 124, message: "opencode timed out", stderr };
      return { ok: false, kind: "run", exitCode: code, message: `opencode exit ${code}`, stderr };
    } finally {
      await release();
    }
  }

  if (opts.runner === "agy") {
    const bin = resolveBin(["agy"]);
    if (!bin) return { ok: false, kind: "startup", exitCode: 1, message: "agy not on PATH" };
    const args = ["--model", opts.model, "--mode", "accept-edits", "--print-timeout", `${timeoutSec}s`, "-p", prompt];
    const child = spawnCliWith(opts.spawnFn ?? spawn, bin, args, {
      cwd: opts.workspace,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { code, stdout, stderr } = await collectChildOutput(child, timeoutSec, "agy");
    const failure = detectDelegatedFailure({ exitCode: code, stdout, stderr });
    if (failure.failed) {
      return {
        ok: false,
        kind: "run",
        exitCode: code === 0 ? 1 : code,
        message: failure.message,
        stdout,
        stderr,
      };
    }
    if (typeof code === "object") return { ok: false, kind: "run", exitCode: 1, message: code.message, stderr };
    if (code === 0) return { ok: true, exitCode: 0, stdout, stderr };
    if (code === 124) return { ok: false, kind: "run", exitCode: 124, message: "agy timed out", stderr };
    return { ok: false, kind: "run", exitCode: code, message: `agy exit ${code}`, stderr };
  }

  return { ok: false, kind: "run", exitCode: 1, message: `unknown runner ${opts.runner}` };
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} timeoutSec
 * @param {string} label
 */
function collectChildOutput(child, timeoutSec, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout: "", stderr: "" });
    }, timeoutSec * 1000);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", reject);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve({ code: c ?? 1, stdout, stderr });
    });
  }).catch((err) => ({ code: { message: String(err) }, stdout: "", stderr: "" }));
}

/**
 * @param {{ stage: string, workspace: string, promptFile: string, dryRun?: boolean, spawnFn?: typeof spawn, timeoutSec?: number }} opts
 */
export async function runDelegatedStage(opts) {
  const workspace = resolve(opts.workspace);
  const routed = await routeStage(opts.stage, { repoRoot: workspace });
  let runner = routed.runner;
  let model = routed.model;
  let fallbackUsed = false;
  let lastStderr = "";

  if (opts.dryRun) {
    return { ...routed, exitCode: 0, fallbackUsed: false, dryRun: true };
  }

  const budgetSec = Math.min(opts.timeoutSec ?? 560, 590);
  const startedAt = Date.now();
  let result = await runRunnerCli({
    timeoutSec: budgetSec,
    runner,
    model,
    workspace,
    promptFile: opts.promptFile,
    stage: opts.stage,
    spawnFn: opts.spawnFn,
  });
  lastStderr = result.stderr ?? "";

  const routingConfig = loadHermesRoutingOverrides(workspace);
  const fallbackAllowed =
    routed.fallbackEnabled &&
    routed.fallback &&
    isFallbackEnabledForStage(opts.stage, routingConfig);

  if (!result.ok && fallbackAllowed) {
    const fb = routed.fallback;
    const remainingSec = Math.floor(budgetSec - (Date.now() - startedAt) / 1000);
    if (
      remainingSec >= 30 &&
      fb &&
      isHermesRunnerOnPath(fb.runner) &&
      (fb.runner !== runner || fb.model !== model)
    ) {
      fallbackUsed = true;
      runner = fb.runner;
      model = fb.model;
      result = await runRunnerCli({
        timeoutSec: remainingSec,
        runner,
        model,
        workspace,
        promptFile: opts.promptFile,
        stage: opts.stage,
        spawnFn: opts.spawnFn,
      });
      lastStderr = result.stderr ?? lastStderr;
    }
  }

  const stderrTail = truncateStderr(lastStderr);
  const logPath = delegateLogPath(workspace);
  const atomicLogPath = atomicHermesLogPath(workspace);
  await mkdir(dirname(logPath), { recursive: true });
  await mkdir(dirname(atomicLogPath), { recursive: true });

  const row = {
    ts: new Date().toISOString(),
    stage: opts.stage,
    runner,
    model,
    exit: result.exitCode ?? (result.ok ? 0 : 1),
    fallbackUsed,
    ok: result.ok,
    message: result.ok ? undefined : result.message,
    stderrTail: stderrTail || undefined,
  };
  const line = `${JSON.stringify(row)}\n`;
  await appendFile(logPath, line, "utf8");
  if (logPath !== atomicLogPath) {
    await appendFile(atomicLogPath, line, "utf8");
  }
  if (stderrTail) {
    await appendFile(
      atomicLogPath,
      `# stderr ${row.ts} stage=${opts.stage}\n${stderrTail}\n`,
      "utf8",
    );
  }

  return {
    ...routed,
    runner,
    model,
    exitCode: row.exit,
    fallbackUsed,
    ok: result.ok,
    message: result.message,
    stderrTail,
  };
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
