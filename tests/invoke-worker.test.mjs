import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptsDir = "scripts";

test("invoke-worker.sh exists and is executable", async () => {
  const path = join(scriptsDir, "invoke-worker.sh");
  const info = await stat(path);
  assert.ok(info.isFile(), `${path} must exist`);
  assert.notEqual(info.mode & 0o111, 0, `${path} must be executable`);
});

test("ensure-workers.sh exists and is executable", async () => {
  const path = join(scriptsDir, "ensure-workers.sh");
  const info = await stat(path);
  assert.ok(info.isFile(), `${path} must exist`);
  assert.notEqual(info.mode & 0o111, 0, `${path} must be executable`);
});

test("invoke-worker.sh rejects unknown worker with exit 2", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const script = join(scriptsDir, "invoke-worker.sh");
  const tmp = await mkdtemp(join(tmpdir(), "invoke-worker-test-"));
  const brief = join(tmp, "brief.md");
  const log = join(tmp, "run.log");
  await writeFile(brief, "test brief", "utf8");
  try {
    await execFileAsync("bash", [
      script,
      "--worker",
      "invalid",
      "--workspace",
      "/tmp",
      "--prompt-file",
      brief,
      "--log-file",
      log,
    ]);
    assert.fail("expected exit 2");
  } catch (err) {
    assert.equal(err.code, 2, `expected exit 2, got ${err.code}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("invoke-worker.ps1 documents claude workers and skills", async () => {
  const text = await readFile(join(scriptsDir, "invoke-worker.ps1"), "utf8");
  assert.doesNotMatch(text, /'pi'/);
  assert.match(text, /'claude'/);
  assert.match(text, /Skills/i);
  assert.doesNotMatch(text, /Resolve-PiPkg/);
});

test("invoke-worker.sh passes no --model to agy and rejects --model", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const script = join(scriptsDir, "invoke-worker.sh");
  const tmp = await mkdtemp(join(tmpdir(), "invoke-worker-model-"));
  const brief = join(tmp, "brief.md");
  const log = join(tmp, "run.log");
  await writeFile(brief, "model brief", "utf8");
  const base = [
    script,
    "--worker",
    "agy",
    "--workspace",
    process.cwd(),
    "--prompt-file",
    brief,
    "--log-file",
    log,
  ];
  try {
    await execFileAsync("bash", [...base, "--dry-run"], {
      env: { ...process.env, CURSOR_ATOMIC_AGY_MODEL: "legacy-env-model" },
    });
    const logText = await readFile(log, "utf8");
    assert.doesNotMatch(logText, /--model/);
    assert.doesNotMatch(logText, /legacy-env-model/);
    assert.match(logText, /--print-timeout 45m0s/);

    await assert.rejects(
      execFileAsync("bash", [...base, "--model", "gemini-3.8-flash", "--dry-run"]),
      (err) => /--model is no longer supported/.test(String(err.stderr)),
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("invoke-worker.sh supports --dry-run", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const script = join(scriptsDir, "invoke-worker.sh");
  const tmp = await mkdtemp(join(tmpdir(), "invoke-worker-dry-"));
  const brief = join(tmp, "brief.md");
  const log = join(tmp, "run.log");
  await writeFile(brief, "dry run brief", "utf8");
  try {
    const { stdout } = await execFileAsync("bash", [
      script,
      "--worker",
      "agy",
      "--workspace",
      process.cwd(),
      "--prompt-file",
      brief,
      "--log-file",
      log,
      "--dry-run",
    ]);
    const logText = await readFile(log, "utf8");
    assert.match(stdout, /exit=0/);
    assert.match(logText, /dry-run:/);
    assert.match(logText, /agy.*-p/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("invoke-worker.sh never documents a bare agy invocation", async () => {
  const text = await readFile(join(scriptsDir, "invoke-worker.sh"), "utf8");
  assert.doesNotMatch(text, /^\s*agy\s*$/m);
  assert.match(text, /CURSOR_ATOMIC_SKILL_ROOT/);
  assert.doesNotMatch(text, /resolve_pi_pkg/);
  assert.match(text, /--dry-run/);
  assert.match(text, /--skills-file/);
  assert.match(text, /run_with_timeout/);
});
