/**
 * Workflow roles. A role is a prompt contract (`.atomic/agents/<subagentType>.md`), not a model choice:
 * the workflow never selects a model, every harness uses its own default.
 *
 * @typedef {{ subagentType: string }} RoleDef
 */

/**
 * Every role is executed by the same generic subagent of the active harness.
 * The role-specific instructions travel in the prompt (see adapters/task-card.mjs).
 */
export const GENERIC_SUBAGENT = "generic";

/** @type {Record<string, RoleDef>} */
export const ROLES = {
  explorer: { subagentType: "explorer" },
  planner: { subagentType: "planner" },
  "plan-reviewer": { subagentType: "plan-reviewer" },
  tasker: { subagentType: "tasker" },
  worker: { subagentType: "worker" },
  reviewer: { subagentType: "atomic-reviewer" },
  tester: { subagentType: "tester" },
  "cli-delegate": { subagentType: "cli-delegate" },
};

/**
 * 파이프라인이 호출하지 않는 보조 에이전트. 대화 중 서브에이전트로 부르거나, stop hook의 헤드리스 실행(memory-sweep)에서 쓴다.
 * check-agents가 에이전트 파일이 있는지만 검사한다.
 * @type {Record<string, RoleDef>}
 */
export const AUXILIARY_ROLES = {
  "memory-curator": { subagentType: "memory-curator" },
};

/** @returns {string[]} */
export function roleNames() {
  return Object.keys(ROLES);
}

/**
 * @param {string} name
 * @returns {RoleDef}
 */
export function getRole(name) {
  const role = ROLES[name] ?? AUXILIARY_ROLES[name];
  if (!role) {
    throw new Error(`Unknown role: ${name}`);
  }
  return role;
}

/**
 * @param {string} name role key in ROLES
 * @returns {string} agent markdown file name
 */
export function agentFileName(name) {
  return `${getRole(name).subagentType}.md`;
}
