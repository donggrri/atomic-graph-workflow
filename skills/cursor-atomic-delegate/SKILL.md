---
name: cursor-atomic-delegate
description: "cursor-atomic-workflow 구현 항목을 서브에이전트 또는 CLI 워커에 위임한다. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-delegate

입력: 커맨드 뒤 텍스트(워커와 항목 id). 비어 있으면 `worker`에 위임한다.

`cursor-atomic-workflow` 스킬과 스킬 디렉터리의 `workers.md`를 읽고 위임한다. 서브에이전트 호출법은 `references/harness.md`를 따른다. `agy` CLI를 직접 호출하지 마라.

- TASKS `worker:` 또는 입력이 `agy|opencode|codex|claude`이면 `cli-delegate` 서브에이전트를 백그라운드로 띄운다.
- 그 외 구현 위임은 `worker` 서브에이전트를 백그라운드로 띄운다.
- PLAN에 막힌 질문이 있으면 위임하지 않는다.
- `cli-delegate` 브리프: `workers.md` 템플릿(FORBID·부모 검증용 `done`). `worker`(Cursor Task) 브리프 첫 줄에 `cursor-atomic-workflow`·`tdd` 경로를 적는다.
- 브리프에 비밀·토큰·`.env`를 넣지 않는다.
- **CLI 워커(agy 등)는 소스 수정만.** invoke 세션에서 항목 `done`·cmake/ctest/npm test를 실행하지 않는다.
- 워커가 돌아오면 이 세션(부모)이 `git diff`와 `scripts/run-done.mjs`로 항목 `done`을 실행한다. 자식의 「완료」문장을 믿지 않는다.
- 통과면 TASKS `[x]`, 아니면 `막힘:`.

커밋·푸시하지 않는다.
