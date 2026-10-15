import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveBin } from "../cli-detect.mjs";
import { spawnCli, spawnCliWith } from "../exec-cross.mjs";
import { spawn } from "node:child_process";

/**
 * @param {{
 *   repoRoot: string,
 *   prompt: string,
 *   timeoutSec?: number,
 *   spawnFn?: typeof spawn,
 * }} params
 */
export async function runHermesCli(params) {
  const bin = resolveBin(["hermes"]);
  if (!bin) {
    return { ok: false, kind: "startup", message: "hermes CLI not on PATH" };
  }

  const timeoutSec = Math.min(params.timeoutSec ?? 560, 590);
  const spawnFn = params.spawnFn ?? spawn;
  let tmpDir = null;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "atomic-hermes-"));
    const queryFile = join(tmpDir, "query.md");
    await writeFile(queryFile, params.prompt, "utf8");

    const args = ["chat", "--oneshot", "-Q", "--query-file", queryFile];
    const child = spawnCliWith(spawnFn, bin, args, {
      cwd: params.repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ code: 124, stdout: "", stderr: "timeout" });
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
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });

    if (result.code === 0) {
      return { ok: true, summary: "hermes chat finished", exitCode: 0 };
    }
    if (result.code === 124) {
      return { ok: false, kind: "run", message: "hermes chat timed out", exitCode: 124 };
    }
    const errMsg = String(result.stderr ?? "").trim() || `hermes exit ${result.code}`;
    return { ok: false, kind: "run", message: errMsg, exitCode: result.code };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "run", message };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
