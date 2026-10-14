import test from "node:test";
import assert from "node:assert/strict";
import { quoteCmdArgument, buildCmdExeCommandLine } from "../scripts/lib/exec-cross.mjs";

test("quoteCmdArgument wraps paths with spaces", () => {
  const q = quoteCmdArgument("C:\\Users\\Dongjin Shin\\app.cmd");
  assert.match(q, /^"/);
  assert.match(q, /Dongjin Shin/);
  assert.ok(q.includes('""') === false || q.includes('Shin\\app'));
});

test("quoteCmdArgument escapes cmd metacharacters", () => {
  assert.match(quoteCmdArgument("a&b"), /\^&/);
  assert.match(quoteCmdArgument("a|b"), /\^\|/);
  assert.match(quoteCmdArgument("100%"), /%\^%/);
  assert.match(quoteCmdArgument('say "hi"'), /""/);
});

test("buildCmdExeCommandLine quotes executable and every arg", () => {
  const line = buildCmdExeCommandLine("C:\\tools\\run.cmd", ["--workspace", "C:\\Users\\Me\\proj"]);
  assert.ok(line.startsWith('"C:\\tools\\run.cmd"'));
  assert.ok(line.includes('"C:\\Users\\Me\\proj"'));
  assert.ok(!line.includes("windowsVerbatimArguments"));
});
