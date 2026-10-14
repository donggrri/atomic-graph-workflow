import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXECUTOR_WORKER } from "./constants.mjs";
import { ensureCommandTrusted } from "../command-trust.mjs";
import { isInteractiveTTY } from "../prompt.mjs";
import { firstExecutable, spawnCli } from "../exec-cross.mjs";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {{
 *   executorId: string,
 *   repoRoot: string,
 *   prompt: string,
 *   runsDir: string,
 *   role: string,
 *   model?: string,
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
    process.env.CURSOR_ATOMIC_TRUST_COMMANDS !== "1" &&
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

  const isWin = process.platform === "win32";
  const script = isWin
    ? join(scriptsDir, "invoke-worker.ps1")
    : join(scriptsDir, "invoke-worker.sh");
  const timeoutMs = (params.timeoutMin ?? 45) * 60 * 1000;

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
    String(params.timeoutMin ?? 45),
  ];
  if (params.model && worker === "agy") {
    baseArgs.push("--model", params.model);
  }

  let child;
  if (isWin) {
    child = spawnCli(
      firstExecutable(["powershell", "pwsh"]) ?? "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...baseArgs],
      { cwd: params.repoRoot, env: process.env },
    );
  } else {
    const bash = firstExecutable(["bash", "sh"]);
    if (!bash) {
      return {
        ok: false,
        kind: "startup",
        message: "bash not on PATH (required for invoke-worker.sh on Unix)",
      };
    }
    child = spawnCli(bash, [script, ...baseArgs], { cwd: params.repoRoot, env: process.env });
  }

  const out = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`worker ${worker} timed out after ${params.timeoutMin ?? 45}m`));
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
      resolve({ stdout, stderr, code });
    });
  }).catch((err) => {
    return { ok: false, kind: "run", message: err instanceof Error ? err.message : String(err) };
  });

  if (out && typeof out === "object" && "ok" in out && out.ok === false) {
    return out;
  }

  const combined = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const lines = combined.trim().split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const exitMatch = last.match(/exit=(\d+)/);
  if (!exitMatch) {
    return {
      ok: false,
      kind: "run",
      message: `worker ${worker} output missing exit=N on last line`,
    };
  }
  const exitCode = Number.parseInt(exitMatch[1], 10);
  if (exitCode === 0) {
    return { ok: true, summary: `worker ${worker} exit 0` };
  }
  return { ok: false, kind: "run", message: `worker ${worker} exit ${exitCode}` };
}
