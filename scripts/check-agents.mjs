#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { roleNames, agentFileName, AUXILIARY_ROLES } from "./lib/roles.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultAgentsDir = join(scriptDir, "..", "agents");

/** Frontmatter keys that tie an agent to one harness or model. The workflow owns none of them. */
const FORBIDDEN_FRONTMATTER = ["model", "readonly", "is_background"];

/**
 * @param {string} content
 * @returns {string[]} forbidden keys present in the frontmatter
 */
export function forbiddenFrontmatterKeys(content) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return [];
  return FORBIDDEN_FRONTMATTER.filter((key) =>
    new RegExp(`^${key}\\s*:`, "m").test(block[1]),
  );
}

/**
 * @param {{ dir?: string }} [options]
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkAgents(options = {}) {
  const dir = resolve(options.dir ?? defaultAgentsDir);
  const problems = [];

  const checks = [
    ...roleNames().map((name) => ({ name, file: agentFileName(name) })),
    ...Object.entries(AUXILIARY_ROLES).map(([name, role]) => ({
      name,
      file: `${role.subagentType}.md`,
    })),
  ];

  for (const { name, file } of checks) {
    const path = join(dir, file);

    if (!existsSync(path)) {
      problems.push(`${name}: missing agent file ${file} in ${dir}`);
      continue;
    }

    let content;
    try {
      content = readFileSync(path, "utf8");
    } catch (err) {
      problems.push(`${name}: cannot read ${file}: ${err.message}`);
      continue;
    }

    for (const key of forbiddenFrontmatterKeys(content)) {
      problems.push(`${name}: frontmatter "${key}:" is not allowed in ${file} (harness decides)`);
    }
  }

  return { ok: problems.length === 0, problems };
}

function parseArgs(argv) {
  let dir;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) {
      dir = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: node scripts/check-agents.mjs [--dir <agentsDir>]",
      );
      process.exit(0);
    }
  }
  return { dir };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const { ok, problems } = checkAgents(dir ? { dir } : {});
  if (!ok) {
    for (const p of problems) {
      console.error(p);
    }
    process.exit(1);
  }
  console.log("ok");
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main();
}
