import { resolveBin } from "../cli-detect.mjs";
import { spawnCli } from "../exec-cross.mjs";

/**
 * @param {{ repoRoot: string, prompt: string, timeoutMin?: number }} params
 */
export async function runCursorAgentCli(params) {
  const bin = resolveBin(["cursor-agent", "agent"]);
  if (!bin) {
    return { ok: false, kind: "startup", message: "cursor-agent CLI not on PATH" };
  }

  const args = ["-p", "--force", "--trust", "--workspace", params.repoRoot];

  try {
    const child = spawnCli(bin, args, { cwd: params.repoRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin?.write(params.prompt);
    child.stdin?.end();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          child.kill("SIGTERM");
          reject(new Error("cursor-agent CLI timed out"));
        },
        (params.timeoutMin ?? 45) * 60 * 1000,
      );
      let stderr = "";
      child.stderr?.on("data", (c) => {
        stderr += String(c);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });
    if (result.code === 0) {
      return { ok: true, summary: "cursor-agent CLI finished" };
    }
    return {
      ok: false,
      kind: "run",
      message: result.stderr?.trim() || `cursor-agent exit ${result.code}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "run", message };
  }
}
