/** @typedef {"cursor-subagent"|"cursor-agent"|"cursor-sdk"|"agy"|"codex"|"opencode"|"pi"|"claude"|"hermes"} ExecutorId */

export const EXECUTOR_IDS = [
  "cursor-subagent",
  "cursor-agent",
  "cursor-sdk",
  "agy",
  "codex",
  "opencode",
  "pi",
  "claude",
  "hermes",
];

/** @type {Record<ExecutorId, string[]>} */
export const EXECUTOR_BINS = {
  "cursor-subagent": ["cursor-agent", "agent"],
  "cursor-agent": ["cursor-agent", "agent"],
  "cursor-sdk": ["node"],
  agy: ["agy"],
  codex: ["codex"],
  opencode: ["opencode"],
  pi: ["pi"],
  claude: ["claude"],
  hermes: ["hermes"],
};

/** invoke-worker.sh worker names */
export const EXECUTOR_WORKER = {
  agy: "agy",
  codex: "codex",
  opencode: "opencode",
  claude: "claude",
};

/** Preferred fallback order when the chosen CLI is missing. */
export const EXECUTOR_FALLBACK_CHAIN = [
  "cursor-sdk",
  "cursor-subagent",
  "cursor-agent",
  "agy",
  "codex",
  "opencode",
  "claude",
  "hermes",
];
