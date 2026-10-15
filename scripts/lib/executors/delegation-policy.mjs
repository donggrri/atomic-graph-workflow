/**
 * Headless delegation policy (cursor-agent, agy, and the other invoke-worker CLIs).
 *
 * The CLIs run with full permissions, so the only guard on a stage that must not change code is
 * the prompt. A stage that edits code runs as is; every other stage gets a FORBID block prepended.
 */

/** Graph stages whose job is to change product code. */
export const EDIT_STAGES = new Set(["lite", "execute"]);

export const FORBID_MARKER = "FORBID (이 단계는 코드를 수정하지 않는다):";

const FORBID_LINES = [
  "제품 소스·테스트·설정·빌드 파일을 만들거나 고치거나 지우지 않는다.",
  "`git commit`, `git push`, `git checkout`, `git reset`, `git stash` 등 저장소 상태를 바꾸는 명령을 실행하지 않는다.",
  "패키지 설치, 빌드, 마이그레이션처럼 작업 트리나 시스템을 바꾸는 명령을 실행하지 않는다.",
  "쓸 수 있는 것은 이 단계의 산출물 문서뿐이다 (`docsDir` 아래의 PLAN·TASKS·REVIEW 등 프롬프트가 지정한 파일).",
  "범위를 넓히지 않는다. 비밀 파일과 `.env`를 읽거나 출력하지 않는다.",
];

/**
 * @param {string | null | undefined} stage graph stage id (`execute`, `review`, ...)
 * @returns {boolean} true when the stage may change product code
 */
export function stageEditsCode(stage) {
  return !!stage && EDIT_STAGES.has(stage);
}

/**
 * Prepend the FORBID block to a prompt of a non-editing stage. Editing stages and prompts that
 * already begin with the generated block are returned unchanged.
 * @param {string | null | undefined} stage
 * @param {string} prompt
 * @returns {string}
 */
export function applyStagePolicy(stage, prompt) {
  const text = prompt ?? "";
  if (stageEditsCode(stage) || text.startsWith(FORBID_MARKER)) return text;
  const block = [FORBID_MARKER, ...FORBID_LINES.map((line) => `- ${line}`)].join("\n");
  return `${block}\n\n${text}`;
}
