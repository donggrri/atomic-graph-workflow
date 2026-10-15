import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXECUTOR_WORKER } from "./constants.mjs";
import { ensureCommandTrusted } from "../command-trust.mjs";
import { isInteractiveTTY } from "../prompt.mjs";
import { firstExecutable, spawnCli } from "../exec-cross.mjs";
import { readEnv } from "../legacy-paths.mjs";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {{
 *   executorId: string,
 *   repoRoot: string,
 *   prompt: string,
 *   runsDir: string,
 *   role: string,
 *   timeoutMin?: number,
 *   skipTrust?: boolean,
 *   settings?: { trustedExecutors?: Record<string, boolean> },
 * }} params
 */
export async function runWorkerExecutor(params) {
  const worker = EXECUTOR_WORKER[params.executorId];
  if (!worker) {
    return { ok: false, kind: "run", message: `worker CLI not mapped for ${params.executorId}` };
  }

  const trustedBySetting = params.settings?.trustedExecutors?.[params.executorId];
  if (
    !params.skipTrust &&
    readEnv(process.env, "TRUST_COMMANDS") !== "1" &&
    !trustedBySetting
  ) {
    const trusted = await ensureCommandTrusted(`invoke-worker:${worker}`, {
      repoRoot: params.repoRoot,
      nonInteractive: !isInteractiveTTY(),
    });
    if (!trusted.ok) {
      return { ok: false, kind: "run", message: trusted.reason };
    }
  }

  await mkdir(params.runsDir, { recursive: true });
  const stamp = Date.now();
  const promptFile = join(params.runsDir, `executor-${params.role}-${stamp}.md`);
  const logFile = join(params.runsDir, `executor-${params.role}.log`);
  await writeFile(promptFile, params.prompt, "utf8");

  const script = join(scriptsDir, "invoke-worker.sh");
  const timeoutMin = params.timeoutMin ?? 45;
  const timeoutMs = timeoutMin * 60 * 1000;

  const baseArgs = [
    "--worker",
    worker,
    "--workspace",
    params.repoRoot,
    "--prompt-file",
    promptFile,
    "--log-file",
    logFile,
    "--timeout-min",
    String(timeoutMin),
  ];

  const bash = firstExecutable(["bash", "sh"]);
  if (!bash) {
    return {
      ok: false,
      kind: "startup",
      message: "bash not on PATH (required for invoke-worker.sh on Unix)",
    };
  }
  const child = spawnCli(bash, [script, ...baseArgs], { cwd: params.repoRoot, env: process.env });

  const out = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`worker ${worker} timed out after ${timeoutMin}m`));
    }, timeoutMs);
    child.stdout?.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  }).catch((err) => {
    return { ok: false, kind: "run", message: err instanceof Error ? err.message : String(err) };
  });

  if (out && typeof out === "object" && "ok" in out && out.ok === false) {
    return out;
  }

  const stdoutText = String(out.stdout ?? "");
  const lines = stdoutText.trim().split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const exitMatch = last.match(/^exit=(\d+)\s*$/);
  const parsedExit = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
  const exitCode = parsedExit ?? out.code ?? 1;

  if (exitCode === 0) {
    return { ok: true, summary: `worker ${worker} exit 0` };
  }
  if (parsedExit == null && out.code !== 0) {
    const errTail = String(out.stderr ?? "").trim().slice(-200);
    return {
      ok: false,
      kind: "run",
      message: errTail || `worker ${worker} exit ${out.code}`,
    };
  }
  return { ok: false, kind: "run", message: `worker ${worker} exit ${exitCode}` };
}
