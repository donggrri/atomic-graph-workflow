import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { binOnPath } from "../cli-detect.mjs";

const execFileAsync = promisify(execFile);

/**
 * Headless Pi via `pi -p` (print mode). See https://pi.dev/docs/latest/cli-integration
 *
 * @param {{
 *   repoRoot: string,
 *   prompt: string,
 *   timeoutMin?: number,
 *   agentStem?: string,
 * }} params
 */
export async function runPiCli(params) {
  if (!binOnPath(["pi"])) {
    return { ok: false, kind: "startup", message: "pi CLI not on PATH (install Pi coding agent CLI)" };
  }
  const args = ["-p", params.prompt];
  const stems = [params.agentStem, "worker"].filter(Boolean);
  for (const stem of stems) {
    const agentPath = join(params.repoRoot, ".pi", "agents", `${stem}.md`);
    if (existsSync(agentPath)) {
      args.unshift("--append-system-prompt", agentPath);
      break;
    }
  }
  try {
    const { stdout } = await execFileAsync("pi", args, {
      cwd: params.repoRoot,
      timeout: (params.timeoutMin ?? 45) * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const tail = String(stdout ?? "").trim().slice(-200);
    return { ok: true, summary: tail || "pi -p finished" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "run", message };
  }
}
