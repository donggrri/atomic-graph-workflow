import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { spawnCli } from "../scripts/lib/exec-cross.mjs";

const isWin = process.platform === "win32";
const runSmoke = isWin || process.env.RUN_WINDOWS_SMOKE === "1";

test(
  "exec-cross runs .cmd with spaces and & in path",
  { skip: !runSmoke },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "exec-cross smoke "));
    const nested = join(root, "a & b");
    mkdirSync(nested, { recursive: true });
    const cmdPath = join(nested, "echo-args.cmd");
    writeFileSync(
      cmdPath,
      "@echo off\r\necho ARGV=%*\r\necho exit=0\r\n",
      "utf8",
    );
    const child = spawnCli(cmdPath, ["--workspace", join(nested, "한글 폴더")]);
    let stdout = "";
    const code = await new Promise((resolve, reject) => {
      child.stdout?.on("data", (c) => {
        stdout += String(c);
      });
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 0);
    assert.match(stdout, /ARGV=/);
  },
);

test(
  "invoke-worker.ps1 agy file-pointer prompt with fake agy on PATH",
  { skip: !runSmoke },
  () => {
    const root = mkdtempSync(join(tmpdir(), "iw-smoke-"));
    const binDir = join(root, "bin");
    const ws = join(root, "ws");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(binDir, "agy.cmd"),
      "@echo off\r\necho %*\r\necho exit=0\r\n",
      "utf8",
    );
    const promptFile = join(root, "brief.md");
    writeFileSync(promptFile, "한글 지시: 테스트 완료\r\n", "utf8");
    const logFile = join(root, "run.log");
    const script = join(process.cwd(), "scripts", "invoke-worker.ps1");
    const psExe = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const ps = spawnSync(
      psExe,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Worker",
        "agy",
        "-Workspace",
        ws,
        "-PromptFile",
        promptFile,
        "-LogFile",
        logFile,
        "-TimeoutMin",
        "1",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}` },
      },
    );
    if (ps.error) {
      assert.fail(ps.error.message);
    }
    const norm = `${ps.stdout ?? ""}\n${ps.stderr ?? ""}`.replace(/\u0000/g, "");
    assert.equal(ps.status, 0, norm);
    assert.match(norm, /Read the file at the following path/i);
    assert.match(norm, /effective-prompt\.md/i);
    const log = readFileSync(logFile, "utf8").replace(/\u0000/g, "");
    assert.match(log, /exit=0/);
    rmSync(root, { recursive: true, force: true });
  },
);
