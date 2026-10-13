---
name: cursor-atomic-explore
description: "cursor-atomic-workflow Phase 0. 코드베이스 및 기술 사전 탐색 후 EXPLORE-<slug>.md 작성. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-explore

입력: 커맨드 뒤 텍스트. 비어 있으면 현재 대화의 요청을 탐색 주제로 본다.

`cursor-atomic-workflow` 스킬을 먼저 읽고 Phase 0(탐색/Recon)을 수행한다.

서브에이전트 호출법, 스크립트 경로, 하네스 전용 도구는 `cursor-atomic-workflow`의 `references/harness.md`를 따른다. CLI 워커를 직접 설치하거나 `agy`/`codex`를 인자 없이 실행하지 마라.

모든 작업(제품 기능 및 워크플로 자체)은 단일 전역 홈 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/EXPLORE-<slug>.md`에 쓴다 (레거시: `.docs/<slug>/`, `docs/<slug>/`). 쓰기 전 슬러그 디렉토리를 만든다. 홈·스킬·제품 루트·제품 `docs/`를 서로 혼용하지 않는다.

1. 기존 코드, 문서, 설정, 전역 홈 및 기존 `.docs/*/`·하네스 `docs/<slug>/`의 `EXPLORE-*.md` / `PLAN-*.md`를 확인한다.
2. 사용자의 탐색 주제나 의도를 바탕으로 `explorer` 서브에이전트를 백그라운드로 띄운다. 브리프 첫 줄에 `cursor-atomic-workflow` 경로를 적는다.
3. `explorer`가 대상 파일, 핵심 코드/인터페이스, 아키텍처 흐름, 리스크를 분석하여 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/EXPLORE-<slug>.md`(레거시: `.docs/<slug>/`, `docs/<slug>/`)를 작성한다.
4. 코드를 수정하거나 커밋·푸시하지 않는다.
5. 지정 모델이 실패하면 그 사실을 보고하고 멈춘다.
6. EXPLORE 저장 직후 `node scripts/work-status.mjs sync <slug>`로 STATUS.json을 갱신한다.
7. 완료 후 탐색 결과 핵심을 한국어로 요약하고, 이어서 `/cursor-atomic-plan`을 실행할 수 있도록 안내한다.
