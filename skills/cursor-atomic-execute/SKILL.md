---
name: cursor-atomic-execute
description: "cursor-atomic-workflow Phase 3. TASKS 항목을 worker로 구현한 뒤 기본은 review 자동. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-execute

입력: 커맨드 뒤 텍스트. 비어 있으면 열린 TASKS 항목 전체를 대상으로 본다.

`cursor-atomic-workflow` 스킬을 읽고 Phase 3을 수행한다. 「구현만」이 아니면 열린 항목이 끝난 뒤 `reviewer`까지 자동 진행한다.

서브에이전트 호출법과 스크립트 경로는 `references/harness.md`를 따른다. `agy`/`codex` CLI를 직접 호출하지 마라.

규칙:
- TASKS가 없으면 Phase 2를 먼저 한다.
- 입력이 `self`이면 이 세션이 구현한다.
- 입력이 `agy`이거나 `model=<agy-slug>`가 있으면 `/cursor-atomic-agy execute`와 동일: 다음 열린 TASKS 항목 하나를 `cli-delegate` + `invoke-worker --worker agy`로 위임한다. 브리프·로그는 `~/.cursor-atomic-workflow/runs/{shortRepo}/<slug>/<task-id>.*`. `model=`은 `invoke-worker --model`로 전달(`cursor-atomic-agy` 스킬).
- **CLI 위임(agy|opencode|codex|claude) = 코드만.** 브리프에 `done`은 `부모 검증용`으로만 적고, 워커는 cmake/ctest/npm test·항목 `done` 셸을 **실행하지 않는다**. 검증은 invoke 종료 후 **부모가** `run-done.mjs` (이후 review/tester 단계).
- TASKS 항목 `worker:`가 `agy|opencode|codex|claude`이면 `cli-delegate` 서브에이전트를 백그라운드로 띄운다 (`workers.md`·`invoke-worker.sh`).
- 그 외 구현 항목은 `worker` 서브에이전트를 백그라운드로 띄운다. 브리프 첫 줄에 `cursor-atomic-workflow`·`tdd` 경로를 적는다. 로직은 `tdd`를 강제한다.
- 항목마다 구현 후 **부모가 `run-done`으로 증거를 확인하고 통과할 때만** `[x]` → `node .atomic/scripts/work-status.mjs sync <slug>`. 실패면 `막힘:`과 로그를 남기고 `sync <slug>` 후 멈춘다.
- 막힘 재개: 실패한 항목만 재시도한다. 이미 [x]는 유지한다. 재시도 시작 때 그 항목의 `막힘:`만 지운다. 입구는 `/cursor-atomic-execute`이다.
- 사람 게이트: 사람 게이트는 PLAN(Phase 1)만이다. 막힘 재개는 정책으로 자동 실행된다.
- AskAntigravity는 사용자가 agy CLI 원샷을 분명히 원할 때만. 폴백 체인이 없다.

커밋·푸시하지 않는다. 한국어로 무엇이 끝났는지 보고한다.
