import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getRole, GENERIC_SUBAGENT } from "../roles.mjs";

/**
 * Role instructions live in `.atomic/agents/<subagentType>.md` for every harness.
 * @param {string} subagentType
 */
export function agentInstructionsRelPath(subagentType) {
  return join(".atomic", "agents", `${subagentType}.md`);
}

/** @type {Record<string, string[]>} */
const ROLE_SKILL_DIRS = {
  explorer: ["atomic-workflow"],
  planner: ["atomic-workflow", "codebase-design", "grilling"],
  "plan-reviewer": ["atomic-workflow", "codebase-design", "tdd"],
  tasker: ["atomic-workflow", "to-tickets"],
  worker: ["atomic-workflow", "tdd"],
  reviewer: ["atomic-workflow", "code-review"],
  tester: ["atomic-workflow", "tdd", "codebase-design"],
  "cli-delegate": ["atomic-workflow"],
  "memory-curator": ["atomic-workflow"],
};

/**
 * Target repo `.agents/skills/<name>/SKILL.md` when that file exists.
 * Otherwise `~/.agents/skills/<name>/SKILL.md`.
 *
 * @param {string} repoRoot
 * @param {string} skillName
 * @param {{ homeDir?: string, exists?: (path: string) => boolean }} [options]
 * @returns {string}
 */
export function resolveSkillPath(repoRoot, skillName, options = {}) {
  const exists = options.exists ?? existsSync;
  const home = options.homeDir ?? homedir();
  const repoFile = join(resolve(repoRoot), ".agents", "skills", skillName, "SKILL.md");
  if (exists(repoFile)) return repoFile;
  return join(home, ".agents", "skills", skillName, "SKILL.md");
}

/**
 * @param {string} repoRoot
 * @param {string} role
 * @param {string} body
 * @param {{ homeDir?: string, exists?: (path: string) => boolean }} [options]
 */
export function formatPrompt(repoRoot, role, body, options = {}) {
  const dirs = options.skillNames ?? ROLE_SKILL_DIRS[role] ?? ["atomic-workflow"];
  const skillLines = dirs.map((name) => resolveSkillPath(repoRoot, name, options));
  const roleDef = getRole(role);
  const instructionPath = resolve(repoRoot, agentInstructionsRelPath(roleDef.subagentType));
  const context = [
    `Role instructions: ${instructionPath}`,
    options.docsDir ? `docsDir: ${options.docsDir}` : null,
    options.runsDir ? `runsDir: ${options.runsDir}` : null,
  ].filter(Boolean);
  const tail = (body ?? "").trim();
  return [...skillLines, ...context, tail].filter(Boolean).join("\n");
}

/**
 * @param {string} repoRoot
 * @param {string[]} skillNames
 * @param {string} body
 * @param {{ homeDir?: string, exists?: (path: string) => boolean }} [options]
 */
export function formatSkillPrompt(repoRoot, skillNames, body, options) {
  const skillLines = skillNames.map((name) => resolveSkillPath(repoRoot, name, options));
  const tail = (body ?? "").trim();
  return tail ? `${skillLines.join("\n")}\n${tail}` : skillLines.join("\n");
}

/**
 * @param {{ runsDir: string, slug: string, repoRoot: string, docsDir?: string, homeDir?: string, exists?: (path: string) => boolean }} options
 */
export function createTaskCardAdapter({ runsDir, slug, repoRoot, docsDir, homeDir, exists }) {
  const skillOptions = { homeDir, exists, docsDir, runsDir };
  return {
    mode: "task-card",
    /**
     * @param {{ role: string, prompt?: string, cwd?: string }} params
     */
    async runRole({ role, prompt }) {
      const roleDef = getRole(role);
      // No `model`: the parent harness decides. `role` tells the parent which instructions apply.
      const card = {
        subagent_type: GENERIC_SUBAGENT,
        role,
        instructions: agentInstructionsRelPath(roleDef.subagentType),
        prompt: String(prompt ?? "").includes("Role instructions:")
          ? prompt
          : formatPrompt(repoRoot, role, prompt ?? "", skillOptions),
      };

      mkdirSync(runsDir, { recursive: true });
      const cardPath = join(runsDir, "next-card.json");
      writeFileSync(cardPath, `${JSON.stringify(card, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify(card, null, 2)}\n`);

      const message = "task-card pending parent";
      return {
        ok: false,
        kind: "run",
        message,
        card,
        slug,
      };
    },
  };
}
