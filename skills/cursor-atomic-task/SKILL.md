---
name: cursor-atomic-task
description: "cursor-atomic-workflow Phase 2. PLAN을 TASKS로 쪼갠 뒤 기본은 execute→review 자동. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-task

입력: 커맨드 뒤 텍스트(슬러그 또는 힌트). 비어 있으면 현재 PLAN을 대상으로 본다.

`cursor-atomic-workflow` 스킬과 스킬 디렉터리의 `reference.md`를 읽고 Phase 2를 수행한다. 「태스크만」이 아니면 기본 파이프라인으로 구현·리뷰까지 이어간다. 서브에이전트 호출법과 스크립트 경로는 `references/harness.md`를 따른다.

`docsDir` = `node .atomic/scripts/work-status.mjs path <slug> [--repo <dir>]`. `<docsDir>`에 `TASKS-<slug>.md`가 없고 PLAN이 있으면 `tasker`를 띄운다. 브리프: 1줄 스킬 경로, 2줄 `docsDir: <absolute>`. PLAN 없으면 Phase 1부터. 이슈 트래커에 올리지 마라.

TASKS 저장 직후 `node .atomic/scripts/work-status.mjs sync <slug>`로 STATUS.json을 갱신한다.

커밋하지 않는다. 한국어로 항목 수와 이어서 돌릴 워커를 보고한다.
