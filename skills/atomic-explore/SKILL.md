---
name: atomic-explore
description: "atomic-workflow Phase 0. 코드베이스 및 기술 사전 탐색 후 EXPLORE-<slug>.md 작성. 사용자가 직접 호출할 때만 쓴다."
---

# /atomic-explore

입력: 커맨드 뒤 텍스트. 비어 있으면 현재 대화의 요청을 탐색 주제로 본다.

`atomic-workflow` 스킬을 먼저 읽고 Phase 0(탐색/Recon)을 수행한다.

서브에이전트 호출법, 스크립트 경로, 하네스 전용 도구는 `atomic-workflow`의 `references/harness.md`를 따른다. CLI 워커를 직접 설치하거나 `agy`/`codex`를 인자 없이 실행하지 마라.

`docsDir` = `node .atomic/scripts/work-status.mjs path <slug> [--repo <dir>]` (기본 홈 `CURSOR_ATOMIC_WORKFLOW_HOME`, 없으면 `~/.cursor-atomic-workflow`). 산출물 `<docsDir>/EXPLORE-<slug>.md` (레거시 읽기: `.docs/<slug>/`, `docs/<slug>/`). 홈·스킬·제품 `docs/` 혼용 금지.

1. 기존 코드, 문서, 설정, `docsDir` 및 레거시 `.docs/*/`·하네스 `docs/<slug>/`의 `EXPLORE-*.md` / `PLAN-*.md`를 확인한다.
2. `explorer`를 백그라운드로 띄운다. 브리프: 1줄 `atomic-workflow` 경로, 2줄 `docsDir: <absolute>`. 비대화형/헤드리스: `node .atomic/scripts/run-stage.mjs explore --repo . --slug <slug> --prompt-file <brief.md>` (executor는 `.cursor-atomic-workflow.json`의 `executors.explore`와 graph 기본값).
3. `explorer`가 대상 파일, 핵심 코드/인터페이스, 아키텍처 흐름, 리스크를 분석하여 `<docsDir>/EXPLORE-<slug>.md`(레거시: `.docs/<slug>/`, `docs/<slug>/`)를 작성한다.
4. 코드를 수정하거나 커밋·푸시하지 않는다.
5. 지정 모델이 실패하면 그 사실을 보고하고 멈춘다.
6. EXPLORE 저장 직후 `node .atomic/scripts/work-status.mjs sync <slug>`로 STATUS.json을 갱신한다.
7. 완료 후 탐색 결과 핵심을 한국어로 요약하고, 이어서 `/atomic-plan`을 실행할 수 있도록 안내한다.
