#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";

/**
 * Command log `…/<id>.log` stores evidence at `…/<id>.done.json`.
 * A log path that does not end in `.log` keeps the summary at `${logPath}.done.json`.
 * @param {string} logPath
 * @returns {string}
 */
export function evidencePath(logPath) {
  if (logPath.endsWith(".log")) return `${logPath.slice(0, -".log".length)}.done.json`;
  return `${logPath}.done.json`;
}

/**
 * 명령을 실행하고 stdout/stderr를 logPath에 저장한 뒤 요약 JSON을 쓴다.
 * @param {{ cwd?: string, command: string, logPath: string, timeoutMs: number }} opts
 * @returns {Promise<{ ok: boolean, exitCode: number, outputPath: string, errorTail?: string }>}
 */
export async function runDone({ cwd, command, logPath, timeoutMs }) {
  const donePath = evidencePath(logPath);

  return new Promise((resolve) => {
    let settled = false;

    const child = spawn(command, {
      cwd: cwd || process.cwd(),
      shell: true,
    });

    const logStream = createWriteStream(logPath);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      child.kill();
      await finishStream(logStream);
      const errorTail = await extractErrorTail(logPath);
      await writeSummary(donePath, { ok: false, exitCode: -1, outputPath: donePath, command, errorTail });
      resolve({ ok: false, exitCode: -1, outputPath: donePath, errorTail });
    }, timeoutMs);

    child.on("close", async (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 스트림이 아직 끝나지 않았을 수 있으므로 flush 후 요약 작성
      await finishStream(logStream);
      const ok = exitCode === 0;
      const result = { ok, exitCode, outputPath: donePath };
      const summary = { ok, exitCode, outputPath: donePath, command };
      if (!ok) {
        const errorTail = await extractErrorTail(logPath);
        result.errorTail = errorTail;
        summary.errorTail = errorTail;
      }
      await writeSummary(donePath, summary);
      resolve(result);
    });

    child.on("error", async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await finishStream(logStream);
      const errorTail = await extractErrorTail(logPath);
      await writeSummary(donePath, { ok: false, exitCode: -1, outputPath: donePath, command, errorTail });
      resolve({ ok: false, exitCode: -1, outputPath: donePath, errorTail });
    });
  });
}

async function finishStream(stream) {
  if (stream.writableFinished) return;
  await new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    stream.once("error", done);
    if (stream.writableEnded) {
      stream.once("finish", done);
    } else {
      stream.end(done);
    }
  });
}

async function extractErrorTail(logPath, maxLines = 20) {
  try {
    const content = await readFile(logPath, "utf8");
    if (!content) return "";
    const stripped = content.replace(/[\r\n]+$/, "");
    if (!stripped) return "";
    const lines = stripped.split(/\r?\n/);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

async function writeSummary(path, data) {
  try {
    await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
    // 요약 작성 실패 시 무시
  }
}

// CLI 실행 엔트리포인트
if (process.argv[1] && process.argv[1].endsWith("run-done.mjs")) {
  const args = process.argv.slice(2);
  let command = "";
  let logPath = "output.log";
  if (args.length === 1) {
    command = args[0];
  } else if (args.length >= 2) {
    logPath = args[args.length - 1];
    command = args.slice(0, -1).join(" ");
  }
  const timeoutMs = parseInt(process.env.TIMEOUT_MS || "30000", 10);

  runDone({ command, logPath, timeoutMs }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}
