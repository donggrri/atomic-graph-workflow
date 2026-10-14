import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { binOnPath } from "../cli-detect.mjs";

const execFileAsync = promisify(execFile);

/**
 * @param {{ repoRoot: string, prompt: string, timeoutMin?: number, agentStem?: string }} params
 */
export async function runCursorAgentCli(params) {
  if (!binOnPath(["cursor-agent", "agent"])) {
    return { ok: false, kind: "startup", message: "cursor-agent CLI not on PATH" };
  }
  const bin = binOnPath(["cursor-agent"]) ? "cursor-agent" : "agent";
  try {
    await execFileAsync(
      bin,
      ["-p", "--force", "--trust", "--workspace", params.repoRoot, params.prompt],
      {
        cwd: params.repoRoot,
        timeout: (params.timeoutMin ?? 45) * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return { ok: true, summary: "cursor-agent CLI finished" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "run", message };
  }
}
