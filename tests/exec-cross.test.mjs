import test from "node:test";
import assert from "node:assert/strict";
import {
  quoteCmdArgument,
  buildCmdExeCommandLine,
  getCmdExeSpawnInvocation,
  spawnCliWith,
} from "../scripts/lib/exec-cross.mjs";

test("quoteCmdArgument wraps paths with spaces", () => {
  const q = quoteCmdArgument("C:\\Users\\Dongjin Shin\\app.cmd");
  assert.equal(q, '"C:\\Users\\Dongjin Shin\\app.cmd"');
});

test("quoteCmdArgument keeps metacharacters literal inside quotes", () => {
  assert.equal(quoteCmdArgument("a&b"), '"a&b"');
  assert.equal(quoteCmdArgument("a|b"), '"a|b"');
  assert.equal(quoteCmdArgument("100%"), '"100%^%"');
  assert.equal(quoteCmdArgument('say "hi"'), '"say ""hi"""');
});

test("getCmdExeSpawnInvocation uses verbatim cmd.exe argv", () => {
  const cmd = "C:\\tools\\agent.cmd";
  const inv = getCmdExeSpawnInvocation(cmd, ["--flag", "C:\\Users\\Me & Co\\proj"]);
  assert.equal(inv.file, "cmd.exe");
  assert.deepEqual(inv.argv.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(inv.argv[3], `"${buildCmdExeCommandLine(cmd, ["--flag", "C:\\Users\\Me & Co\\proj"])}"`);
  assert.equal(inv.options.windowsVerbatimArguments, true);
  assert.equal(inv.options.shell, false);
});

test("spawnCliWith passes exact cmd invocation for .cmd files", { skip: process.platform !== "win32" }, () => {
  const calls = [];
  const mockSpawn = (file, argv, options) => {
    calls.push({ file, argv, options });
    return { on() {}, stdout: { on() {} }, stderr: { on() {} }, stdin: null, kill() {} };
  };
  spawnCliWith(mockSpawn, "C:\\bin\\tool.cmd", ["--x", "y"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "cmd.exe");
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
  assert.match(calls[0].argv[3], /^".*tool\.cmd.*"$/);
});
