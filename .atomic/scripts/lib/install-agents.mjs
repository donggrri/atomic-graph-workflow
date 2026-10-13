import { readFile, writeFile, mkdir, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
  for (const file of await listMarkdown(srcDir)) {
    let content = await readFile(join(srcDir, file), "utf8");
    const stem = file.replace(/\.md$/, "");
    const model = setModel[stem] || setModel[file];
    if (model) {
      content = applyModelOverride(content, model);
    }
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
