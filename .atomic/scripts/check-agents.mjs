#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  roleNames,
  getRole,
  agentFileName,
  modelFamily,
  AUXILIARY_ROLES,
} from "./lib/roles.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultAgentsDir = join(scriptDir, "..", "agents");

/**
 * @param {string} content
 * @returns {string | null}
 */
function frontmatterModel(content) {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;
  const line = block[1].match(/^model:\s*(.+)$/m);
  return line ? line[1].trim() : null;
}

/**
 * @param {{ dir?: string }} [options]
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkAgents(options = {}) {
  const dir = resolve(options.dir ?? defaultAgentsDir);
  const problems = [];

  const checks = [
    ...roleNames().map((name) => ({
      name,
      taskModel: getRole(name).taskModel,
      file: agentFileName(name),
    })),
    ...Object.entries(AUXILIARY_ROLES).map(([name, role]) => ({
      name,
      taskModel: role.taskModel,
      file: `${role.subagentType}.md`,
    })),
  ];

  for (const { name, taskModel, file } of checks) {
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

    const model = frontmatterModel(content);
    if (model === null) {
      problems.push(`${name}: no frontmatter model: in ${file}`);
    } else if (model !== taskModel) {
      problems.push(
        `${name}: frontmatter model "${model}" !== taskModel "${taskModel}" (${file})`,
      );
    }
  }

  const reviewerFamily = modelFamily(getRole("reviewer").taskModel);
  const workerFamily = modelFamily(getRole("worker").taskModel);
  if (reviewerFamily === workerFamily) {
    problems.push(
      `reviewer model family "${reviewerFamily}" must differ from worker "${workerFamily}"`,
    );
  }

  const plannerFamily = modelFamily(getRole("planner").taskModel);
  const planReviewerFamily = modelFamily(getRole("plan-reviewer").taskModel);
  if (plannerFamily === planReviewerFamily) {
    problems.push(
      `plan-reviewer model family "${planReviewerFamily}" must differ from planner "${plannerFamily}"`,
    );
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
