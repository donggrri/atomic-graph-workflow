---
name: cursor-atomic-plan
description: "cursor-atomic-workflow Phase 1. grilling preflight 후 PLAN 작성·승인 후 기본 파이프라인 자동 실행. /cursor-atomic-plan 또는 메인 채팅 라우터가 full로 판정했을 때 따른다."
metadata:
  argument-hint: "[intent | 계획만]"
---

# /cursor-atomic-plan

`/cursor-atomic-plan` 슬래시, 또는 `.cursor/rules/atomic-router.mdc`가 **full**로 라우팅한 메인 채팅 작업에서 이 스킬을 읽고 따른다.

입력: 커맨드 뒤 텍스트. 비어 있으면 현재 대화의 요청을 의도로 본다.

`cursor-atomic-workflow` 스킬을 먼저 읽고 Phase 1을 수행한다. 패키지에 번들된 `grilling`, `domain-modeling`, `codebase-design`, `wayfinder`도 직접 읽는다. 이름만 언급하고 읽었다고 가정하지 마라.

서브에이전트 호출법, 스크립트 경로, 하네스 전용 도구는 `cursor-atomic-workflow`의 `references/harness.md`를 따른다. CLI 워커를 직접 설치하거나 `agy`/`codex`를 인자 없이 실행하지 마라.

모든 작업(제품 기능 및 워크플로 자체)은 단일 전역 홈 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md`에 쓴다 (레거시: `.docs/<slug>/`, `docs/<slug>/`). 쓰기 전 슬러그 디렉토리를 만든다. 홈·스킬·제품 루트·제품 `docs/`를 서로 혼용하지 않는다. `--profile <id>`가 있어도 산출물 위치는 같다. 그 프로필의 `plan.command`가 있으면 planner 브리프에 그 경로를 넣고, 러너에도 같은 `--profile`을 넘긴다. 외부 명령 파일은 지침일 뿐이고 제품 저장소의 `docs/plan/`으로 옮기지 않는다.

## Planning preflight — 부모가 직접 수행

1. `grilling` 방식으로 decision tree의 현재 frontier를 계산한다. 파일·설정으로 알 수 있는 사실은 직접 조사하고 사용자에게 묻지 않는다.
2. 사용자 결정이 있으면 번호가 있는 질문과 추천 답을 한 라운드에 제시하고 **답을 기다린다**. 답을 받기 전에 PLAN을 확정하거나 `planner`를 띄우지 않는다.
3. 다음 신호가 있으면 wayfinding route로 분류한다: 여러 세션이 필요한 크기, 아직 정확히 질문할 수 없는 fog, 독립 research/prototype/grilling 결정이 둘 이상, 목적지 변경 가능성. 그 외는 `bounded`다.
4. 기본 큰 작업 경로는 tracker 없는 `local-wayfinding`이다. upstream `wayfinder`는 `disable-model-invocation`인 사용자 호출용 orchestrator이므로 사용자가 명시한 경우에만 tracker route로 넘긴다.
5. frontier가 빌 때까지 반복한 뒤 아래 refinement brief를 만든다. 이 brief 없이 planner를 시작하지 않는다.

```markdown
## 계획 정제

- route: bounded | local-wayfinding | explicit-wayfinder
- skills: grilling, domain-modeling, codebase-design
- decision rounds: <횟수 또는 추가 결정 없음>
- settled decisions: <요약>
- remaining fog: <없음 또는 항목>
```

## PLAN 및 다음 단계

1. 코드·문서·전역 홈 및 기존 `.docs/*/`·하네스 `docs/<slug>/`의 EXPLORE/PLAN/TASKS를 읽는다. `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/EXPLORE-<slug>.md`(또는 레거시 `.docs/<slug>/`, `docs/<slug>/`)가 있으면 즉시 반영한다.
2. 사용자가 이미 계획을 줬거나 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md`(또는 레거시 `.docs/<slug>/`, `docs/<slug>/`)가 있어도 refinement brief가 없으면 preflight를 건너뛰지 않는다.
3. refinement가 끝났으면 brief를 포함해 `planner` 서브에이전트를 백그라운드로 띄운다. 브리프 첫 줄에 번들된 `cursor-atomic-workflow`, `codebase-design`, `domain-modeling`, `grilling`, `wayfinder`의 경로를 적는다. 사용자가 완성된 PLAN을 제공한 경우에만 부모가 저장하고 planner를 건너뛴다.
4. 막힌 질문(보안·범위·데이터 손실), `remaining fog`, 또는 입력에 「계획만」이 있으면 구현으로 넘어가지 않는다.
5. 그 외에는 SKILL의 기본 파이프라인대로 `tasker` → frontier의 `worker` → `reviewer`를 백그라운드로 이어서 띄운다. 항목 `done`은 이 세션이 다시 실행한다.
6. PLAN 저장 직후 `node scripts/work-status.mjs sync <slug>`로 STATUS.json을 갱신한다.
7. 지정 모델이 실패하면 그 사실을 보고하고 멈춘다.

커밋·푸시하지 않는다. 한국어로 요약한다.
