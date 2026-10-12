import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgyModel } from "../.cursor/skills/cursor-atomic-workflow/scripts/resolve-agy-model.mjs";

test("resolveAgyModel maps gemini-3.8-flash alias", () => {
  assert.equal(resolveAgyModel("gemini-3.8-flash"), "gemini-3.8-flash-high");
  assert.equal(resolveAgyModel("gemini-3.8-flash-medium"), "gemini-3.8-flash-high");
  assert.equal(resolveAgyModel("gemini-3.8-flash-high"), "gemini-3.8-flash-high");
  assert.equal(resolveAgyModel(""), "");
});
