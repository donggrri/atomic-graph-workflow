import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveBin } from "../cli-detect.mjs";
import { getRole } from "../roles.mjs";
import { spawnCli } from "../exec-cross.mjs";

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
  const bin = resolveBin(["pi"]);
  if (!bin) {
    return { ok: false, kind: "startup", message: "pi CLI not on PATH (install Pi coding agent CLI)" };
  }

  const args = ["-p"];
  const roleDef = params.agentStem ? getRole(params.agentStem) : null;
  const stems = [roleDef?.subagentType, params.agentStem, "worker"].filter(Boolean);
  for (const stem of stems) {
    const agentPath = join(params.repoRoot, ".pi", "agents", `${stem}.md`);
    if (existsSync(agentPath)) {
      args.unshift("--append-system-prompt", agentPath);
      break;
    }
  }

  try {
    const child = spawnCli(bin, args, {
      cwd: params.repoRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin?.write(params.prompt);
    child.stdin?.end();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          child.kill("SIGTERM");
          reject(new Error("pi -p timed out"));
        },
        (params.timeoutMin ?? 45) * 60 * 1000,
      );
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (c) => {
        stdout += String(c);
      });
      child.stderr?.on("data", (c) => {
        stderr += String(c);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    if (result.code === 0) {
      const tail = String(result.stdout ?? "").trim().slice(-200);
      return { ok: true, summary: tail || "pi -p finished" };
    }
    const errMsg = String(result.stderr ?? "").trim() || `pi exit ${result.code}`;
    return { ok: false, kind: "run", message: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "run", message };
  }
}
