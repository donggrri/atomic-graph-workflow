import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentFileName, roleNames } from "./roles.mjs";

/** Maps CLI `--set-model` keys to agent file stems. */
export const SET_MODEL_ALIASES = {
  reviewer: "cursor-atomic-reviewer",
};

/**
 * @param {Record<string, string>} setModel
 * @returns {Record<string, string>} stem -> model
 */
export function normalizeSetModel(setModel) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, model] of Object.entries(setModel ?? {})) {
    const stem = SET_MODEL_ALIASES[key] ?? key;
    out[stem] = model;
  }
  return out;
}

/**
 * @param {Record<string, string>} setModel
 */
export function validateSetModelKeys(setModel) {
  const stems = new Set(
    roleNames().map((role) => agentFileName(role).replace(/\.md$/, "")),
  );
  stems.add("memory-curator");
  for (const key of Object.keys(setModel ?? {})) {
    const stem = SET_MODEL_ALIASES[key] ?? key;
    if (!stems.has(stem)) {
      throw new Error(
        `unknown --set-model agent "${key}" (use role name or file stem such as cursor-atomic-reviewer)`,
      );
    }
  }
}

/**
 * @param {string} content
 * @param {string} [existingContent]
 */
export function preserveExistingModel(content, existingContent) {
  if (!existingContent) return content;
  const line = existingContent.match(/^model:\s*(.+)$/m);
  if (!line) return content;
  return applyModelOverride(content, line[1].trim());
}

export function applyModelOverride(content, model) {
  if (/^model:\s*.*$/m.test(content)) {
    return content.replace(/^model:\s*.*$/m, `model: ${model}`);
  }
  return content.replace(/^---\r?\n/, `---\nmodel: ${model}\n`);
}

async function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
}

/**
 * @param {string} srcDir neutral `agents/`
 * @param {string} destDir e.g. `.cursor/agents`
 * @param {Record<string, string>} setModel
 * @param {boolean} force
 */
export async function copyAgentsFlat(srcDir, destDir, setModel, force, record) {
  const models = normalizeSetModel(setModel);
  for (const file of await listMarkdown(srcDir)) {
    let content = await readFile(join(srcDir, file), "utf8");
    const stem = file.replace(/\.md$/, "");
    const model = models[stem] || models[file];
    const dest = join(destDir, file);
    const existed = existsSync(dest);
    if (existed && !force) {
      record.skipped.push(dest);
      continue;
    }
    if (model) {
      content = applyModelOverride(content, model);
    } else if (existed && force) {
      const existingContent = await readFile(dest, "utf8");
      content = preserveExistingModel(content, existingContent);
    }
    await mkdir(destDir, { recursive: true });
    await writeFile(dest, content, "utf8");
    record[existed ? "overwritten" : "copied"].push(dest);
  }
}

/** @param {string} srcDir @param {string} destDir */
export async function copyAgentsToAtomic(srcDir, destDir, force, record) {
  for (const file of await listMarkdown(srcDir)) {
    const src = join(srcDir, file);
    const dest = join(destDir, file);
    const existed = existsSync(dest);
    if (existed && !force) {
      record.skipped.push(dest);
      continue;
    }
    await mkdir(destDir, { recursive: true });
    const content = await readFile(src, "utf8");
    await writeFile(dest, content, "utf8");
    record[existed ? "overwritten" : "copied"].push(dest);
  }
}

/**
 * OpenCode subagent frontmatter tweak: ensure `mode: subagent` when missing.
 * @param {string} content
 */
export function opencodeAgentContent(content) {
  if (/^mode:\s/m.test(content)) {
    return content;
  }
  return content.replace(/^---\r?\n/, "---\nmode: subagent\n");
}
