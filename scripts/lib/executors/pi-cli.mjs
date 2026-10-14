import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveBin } from "../cli-detect.mjs";
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

  const dir = await mkdtemp(join(tmpdir(), "pi-prompt-"));
  const promptFile = join(dir, "prompt.md");
  await writeFile(promptFile, params.prompt, "utf8");

  const args = ["-p", promptFile];
  const stems = [params.agentStem, "worker"].filter(Boolean);
  for (const stem of stems) {
    const agentPath = join(params.repoRoot, ".pi", "agents", `${stem}.md`);
    if (existsSync(agentPath)) {
      args.unshift("--append-system-prompt", agentPath);
      break;
    }
  }

  try {
    const child = spawnCli(bin, args, { cwd: params.repoRoot, env: process.env });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          child.kill("SIGTERM");
          reject(new Error("pi -p timed out"));
        },
        (params.timeoutMin ?? 45) * 60 * 1000,
      );
      let stdout = "";
      child.stdout?.on("data", (c) => {
        stdout += String(c);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout });
      });
    });
    if (result.code === 0) {
      const tail = String(result.stdout ?? "").trim().slice(-200);
      return { ok: true, summary: tail || "pi -p finished" };
    }
    return { ok: false, kind: "run", message: `pi exit ${result.code}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "run", message };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
