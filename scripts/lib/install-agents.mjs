import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SET_MODEL_REMOVED_MESSAGE =
  "--set-model is no longer supported: the workflow does not select models; configure the model in the harness itself";

/**
 * The workflow never pins a model. Reject the removed option before anything is written.
 * @param {Record<string, string> | undefined} setModel
 */
export function rejectSetModel(setModel) {
  if (setModel && Object.keys(setModel).length > 0) {
    throw new Error(SET_MODEL_REMOVED_MESSAGE);
  }
}

async function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
}

/**
 * Copies the neutral agent files unchanged (they carry no model or harness-only fields).
 * An existing file is kept unless `force` is set; `force` regenerates it from the source.
 * @param {string} srcDir neutral `agents/`
 * @param {string} destDir e.g. `.cursor/agents`
 * @param {boolean} force
 */
export async function copyAgentsFlat(srcDir, destDir, force, record) {
  for (const file of await listMarkdown(srcDir)) {
    const content = await readFile(join(srcDir, file), "utf8");
    const dest = join(destDir, file);
    const existed = existsSync(dest);
    if (existed && !force) {
      record.skipped.push(dest);
      continue;
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
