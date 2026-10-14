import { GRAPH_STAGE_IDS } from "./graph.mjs";
import { EXECUTOR_IDS } from "./executors/constants.mjs";
import { confirm, select } from "./prompt.mjs";

const STAGE_LABELS = {
  lite: "Lite (single-session)",
  explore: "Explore",
  plan: "Plan",
  "plan-review": "Plan review",
  task: "Task",
  execute: "Execute",
  review: "Review",
  wrapup: "Wrapup / test",
  memory: "Memory",
};

/** @type {Record<string, string>} */
const DANGEROUS_EXECUTOR_NOTES = {
  "cursor-agent":
    "cursor-agent: --force --trust (샌드박스 없음, 저장소 전체 접근).",
  agy: "agy: 헤드리스 CLI, 승인 프롬프트 없음.",
  codex: "codex: approval mode(예: never)에 따라 무승인 실행 가능.",
  opencode: "opencode: 외부 CLI 위임, 로컬 정책에 따름.",
  claude: "claude: 외부 CLI 위임, --dangerously-skip-permissions 등 정책 주의.",
};

/**
 * @param {boolean} interactive
 * @param {Record<string, string>} [existing]
 * @returns {Promise<{ executors: Record<string, string>, trustedExecutors: Record<string, boolean> }>}
 */
export async function collectExecutorChoices(interactive, existing = {}) {
  /** @type {Record<string, string>} */
  const executors = {};
  /** @type {Record<string, boolean>} */
  const trustedExecutors = {};
  const choices = EXECUTOR_IDS.map((id) => ({ value: id, label: id }));
  const confirmedDangerous = new Set();

  for (const stage of GRAPH_STAGE_IDS) {
    const label = STAGE_LABELS[stage] ?? stage;
    const def =
      typeof existing[stage] === "string"
        ? existing[stage]
        : stage === "plan"
          ? "cursor-sdk"
          : "cursor-subagent";
    const picked = interactive
      ? await select(`${label} 단계 executor`, choices, def)
      : def;
    executors[stage] = picked;

    const note = DANGEROUS_EXECUTOR_NOTES[picked];
    if (interactive && note && !confirmedDangerous.has(picked)) {
      const ok = await confirm(`${note}\n이 executor를 신뢰하고 사용할까요?`, {
        default: false,
      });
      if (!ok) {
        throw new Error(`executor ${picked} 선택이 취소되었습니다.`);
      }
      confirmedDangerous.add(picked);
      trustedExecutors[picked] = true;
    }
  }
  return { executors, trustedExecutors };
}
