import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ROUTER_DISPATCH_COMMANDS } from "./install.test.mjs";

const SKILLS = ".cursor/skills";

test("router dispatch command skills are model-invocable", async () => {
  for (const name of ROUTER_DISPATCH_COMMANDS) {
    const rel = join(SKILLS, name, "SKILL.md");
    const text = await readFile(rel, "utf8");
    assert.doesNotMatch(
      text,
      /disable-model-invocation:\s*true/,
      `${rel} must not block model invocation`,
    );
  }
});
