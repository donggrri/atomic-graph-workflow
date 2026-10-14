/** @typedef {{ id: string, params?: Array<{ id: string, value: string }> }} SdkModel */

/** @typedef {{ subagentType: string, taskModel: string, sdk: SdkModel }} RoleDef */

/** @type {Record<string, RoleDef>} */
export const ROLES = {
  explorer: {
    subagentType: "explorer",
    taskModel: "claude-haiku-5-5-high",
    sdk: {
      id: "claude-haiku-5-5",
      params: [{ id: "reasoning_effort", value: "high" }],
    },
  },
  planner: {
    subagentType: "planner",
    taskModel: "claude-sonnet-5-5-high",
    sdk: {
      id: "claude-sonnet-5-5",
      params: [{ id: "reasoning_effort", value: "high" }],
    },
  },
  "plan-reviewer": {
    subagentType: "plan-reviewer",
    taskModel: "composer-2.5",
    sdk: {
      id: "composer-2.5",
    },
  },
  tasker: {
    subagentType: "tasker",
    taskModel: "composer-2.5",
    sdk: {
      id: "composer-2.5",
    },
  },
  worker: {
    subagentType: "worker",
    taskModel: "composer-2.5",
    sdk: {
      id: "composer-2.5",
    },
  },
  reviewer: {
    subagentType: "cursor-atomic-reviewer",
    taskModel: "claude-sonnet-5-5-high",
    sdk: {
      id: "claude-sonnet-5-5",
      params: [{ id: "reasoning_effort", value: "high" }],
    },
  },
  tester: {
    subagentType: "tester",
    taskModel: "claude-haiku-5-5-high",
    sdk: {
      id: "claude-haiku-5-5",
      params: [{ id: "reasoning_effort", value: "high" }],
    },
  },
  "cli-delegate": {
    subagentType: "cli-delegate",
    taskModel: "composer-2.5",
    sdk: {
      id: "composer-2.5",
    },
  },
};

/**
 * 파이프라인이 호출하지 않는 보조 에이전트. 대화 중 Task로 부르거나, stop hook의 헤드리스 실행(memory-sweep)에서 쓴다.
 * check-agents가 에이전트 파일과 모델이 맞는지만 검사한다.
 * @type {Record<string, { subagentType: string, taskModel: string, sdk: SdkModel }>}
 */
export const AUXILIARY_ROLES = {
  "memory-curator": {
    subagentType: "memory-curator",
    taskModel: "composer-2.5",
    sdk: {
      id: "composer-2.5",
    },
  },
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

/**
 * @param {string} modelId
 * @returns {string}
 */
export function modelFamily(modelId) {
  if (modelId.startsWith("composer-")) return "composer";
  if (modelId.startsWith("muse-spark-")) return "muse-spark";
  if (modelId.startsWith("claude-")) return "claude";
  if (modelId.startsWith("gpt-")) return "gpt";
  if (modelId.startsWith("grok-")) return "grok";
  if (modelId.startsWith("gemini-")) return "gemini";
  if (modelId.startsWith("kimi-")) return "kimi";
  const first = modelId.split("-")[0];
  return first || modelId;
}
