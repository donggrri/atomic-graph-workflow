import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EXECUTOR_WORKER } from "./constants.mjs";
import { ensureCommandTrusted } from "../command-trust.mjs";

const execFileAsync = promisify(execFile);
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
 * }} params
 */
export async function runWorkerExecutor(params) {
  const worker = EXECUTOR_WORKER[params.executorId];
  if (!worker) {
    return { ok: false, kind: "run", message: `worker CLI not mapped for ${params.executorId}` };
  }

  if (!params.skipTrust && process.env.CURSOR_ATOMIC_TRUST_COMMANDS !== "1") {
    const trusted = await ensureCommandTrusted(`invoke-worker:${worker}`, { nonInteractive: true });
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
  const args = [
    script,
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
    args.push("--model", params.model);
  }

  try {
    const { stdout, stderr } = await execFileAsync("bash", args, {
      cwd: params.repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });
    const out = `${stdout ?? ""}${stderr ?? ""}`;
    const exitMatch = out.match(/exit=(\d+)/);
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : 0;
    if (exitCode === 0) {
      return { ok: true, summary: `worker ${worker} exit 0` };
    }
    return { ok: false, kind: "run", message: `worker ${worker} exit ${exitCode}` };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : 1;
    return { ok: false, kind: "run", message: `worker ${worker} failed (${code})` };
  }
}
