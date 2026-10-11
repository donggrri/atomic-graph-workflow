import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { checkHarnessInstall } from "../scripts/doctor.mjs";
import { ATOMIC_ROUTER_RULE, RULES_DIR } from "../scripts/install.mjs";

const ROUTER = join(".cursor", "rules", ATOMIC_ROUTER_RULE);

test("atomic-router rule is always-applied and references lite vs full", async () => {
  const text = await readFile(ROUTER, "utf8");
  assert.match(text, /alwaysApply:\s*true/);
  assert.match(text, /cursor-atomic-lite/);
  assert.match(text, /cursor-atomic-plan/);
  assert.match(text, /routing\.md/);
  assert.match(text, /라우팅:/);
});

test("package repo has router rule for doctor install check", async () => {
  const hi = await checkHarnessInstall({ cwd: ".", root: "." });
  assert.equal(hi.routerRuleInstalled, true);
  assert.equal(hi.routerRuleExpected, ATOMIC_ROUTER_RULE);
});

test("routing.md documents main-chat lite vs full signals", async () => {
  const text = await readFile(
    join(".cursor", "skills", "cursor-atomic-workflow", "references", "routing.md"),
    "utf8",
  );
  assert.match(text, /lite vs full/);
  assert.match(text, /atomic-router\.mdc/);
  assert.match(text, /5개 이상/);
  assert.match(text, /라우팅: lite/);
});
