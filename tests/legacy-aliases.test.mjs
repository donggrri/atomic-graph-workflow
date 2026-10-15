import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { LEGACY_NAME_MAP, legacyCommandContent, legacySkillAliases, legacySkillContent } from "../scripts/lib/legacy-aliases.mjs";

const canonicalSkills = new Set(
  (await readdir("skills")).filter((name) => name.startsWith("atomic-")).sort(),
);

const legacyEntries = legacySkillAliases();

test("legacy name map covers every canonical workflow skill and reviewer agent", () => {
  assert.equal(legacyEntries.length, 17);
  for (const [legacy, canonical] of legacyEntries) {
    assert.match(legacy, /^cursor-atomic-/);
    assert.match(canonical, /^atomic-/);
    assert.ok(canonicalSkills.has(canonical), `${canonical} must be a source skill`);
    assert.notEqual(legacy, canonical);
  }
  assert.equal(LEGACY_NAME_MAP["cursor-atomic-reviewer"], "atomic-reviewer");
  assert.equal(new Set(Object.values(LEGACY_NAME_MAP)).size, Object.keys(LEGACY_NAME_MAP).length);
});

test("legacy skill and command aliases point only to canonical skills", () => {
  const [legacy, canonical] = legacyEntries.find(([oldName]) => oldName === "cursor-atomic-plan");
  const skill = legacySkillContent(legacy, canonical);
  const command = legacyCommandContent(legacy, canonical);
  assert.match(skill, new RegExp(`name: ${legacy}`));
  assert.match(skill, new RegExp(`\.agents/skills/${canonical}/SKILL\\.md`));
  assert.doesNotMatch(skill, /PLAN|TASKS|executor|model:/);
  assert.match(command, new RegExp(`\.agents/skills/${canonical}/SKILL\\.md`));
  assert.match(command, /\$ARGUMENTS/);
});

test("canonical source frontmatter matches its renamed directory", async () => {
  for (const name of canonicalSkills) {
    const text = await readFile(`skills/${name}/SKILL.md`, "utf8");
    assert.match(text, new RegExp(`^name: ${name}$`, "m"), name);
  }
});
