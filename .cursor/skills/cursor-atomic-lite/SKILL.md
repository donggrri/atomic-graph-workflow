---
name: cursor-atomic-lite
description: "단일 세션 경량 워크플로: 짧은 PLAN·구현·메모리·테스트 마무리(서브에이전트 없음). /cursor-atomic-lite 또는 메인 채팅 라우터가 lite로 판정했을 때 따른다."
metadata:
  argument-hint: "<의도>"
---

# /cursor-atomic-lite

`/cursor-atomic-lite` 슬래시, 또는 `.cursor/rules/atomic-router.mdc`가 **lite**로 라우팅한 메인 채팅 작업에서 이 스킬을 읽고 따른다.

입력: 커맨드 뒤 텍스트(의도). 비어 있으면 현재 대화의 요청을 의도로 본다.

**서브에이전트를 띄우지 않는다.** 이 세션(부모)만 PLAN → 구현 → 메모리 → 마무리를 수행한다. `Task`, `explorer`/`planner`/`worker`/`reviewer` 등 파이프라인 역할 호출은 금지.

스크립트 경로는 `cursor-atomic-workflow`의 `references/harness.md` 「스크립트 경로」를 따른다 (`work-status.mjs`, `memory.mjs` 포함).

문서 위치 (`CURSOR_ATOMIC_WORKFLOW_HOME` 있으면 그 홈, 없으면 `~/.cursor-atomic-workflow`):

`{workflowHome}/docs/{shortRepo}/{slug}/PLAN-<slug>.md`

`shortRepo`는 `node <memory.mjs> repo <repoRoot>` 출력. 슬러그는 의도에서 ASCII kebab-case (`fix-typo`). 쓰기 전 슬러그 디렉터리를 만든다.

채팅 제목을 3~5단어로 `rename_chat` 한다.

## 에스컬레이션 (먼저 판정)

아래에 해당하면 **구현을 시작하지 않고** 전체 워크플로(`/cursor-atomic-plan`, `/cursor-atomic-run` 등 `cursor-atomic-*` 파이프라인)로 전환을 권한다.

- 예상 변경 파일이 **5개 이상**(구현·탐색 중 발견 포함)
- DB·스키마·마이그레이션
- 인증·권한·보안·시크릿 처리
- 모듈·레이어를 가로지르는 설계, 요구가 불명확
- PLAN의 「변경 파일」·「완료 기준」·「검증」이 각각 짧은 목록을 넘어 길어짐
- 막힌 질문(범위·데이터 손실·보안)이 사용자 답 없이 남음

에스컬레이션 시 한국어로 이유와 추천 커맨드를 적고 멈춘다.

## 0) MEMORY — 시작

1. `node <memory.mjs> repo <repoRoot>`로 `shortRepo`를 확인한다.
2. `node <memory.mjs> context <shortRepo>`를 실행하고, 출력이 있으면 계획·구현에 반영한다.

## 1) PLAN — 짧은 계획 후 구현

1. 관련 코드·README·기존 동일 슬러그 PLAN(전역 홈·레거시 `.docs/<slug>/`)을 읽는다.
2. 아래 템플릿으로 `PLAN-<slug>.md`를 쓴다. 섹션은 짧게 유지한다.

```markdown
# PLAN: <짧은 제목>

상태: lite
슬러그: <slug>
기준: <커밋 또는 브랜치>

## 목표

<한 문장>

## 변경 파일

- `path/to/file` — <한 줄>

## 완료 기준

- [ ] <측정 가능한 항목>

## 검증

- <예: `npm test`, 특정 스크립트>
```

3. `node <work-status.mjs> sync <slug>`로 STATUS를 맞춘다.
4. PLAN에 따라 **이 세션에서 직접** 코드·문서를 수정한다. 범위를 PLAN 밖으로 넓히지 않는다.

## 2) MEMORY — 종료

구현이 끝난 뒤, 이번 작업에서 다음 실행에 도움이 될 **최대 5건**만 고른다 (`projects/`, `decisions/`, `gotchas/`, 필요 시 `human.md`). 각 `text`는 한 줄·200자 이하·한국어·비밀 없음.

`/tmp/memory-<slug>.json` 예:

```json
{
  "shortRepo": "<shortRepo>",
  "slug": "<slug>",
  "items": [
    { "target": "projects/<shortRepo>.md", "text": "..." }
  ]
}
```

`node <memory.mjs> propose --auto /tmp/memory-<slug>.json` — 항목이 없으면 이 단계를 건너뛴다. 메모리 디렉터리를 직접 편집하지 않는다.

## 3) WRAPUP — 검증·요약

1. PLAN 「검증」에 적은 명령을 실행한다(보통 `npm test`). 실패하면 원인을 고치거나 PLAN/완료 기준을 갱신한 뒤 재실행한다.
2. PLAN 「완료 기준」 체크박스를 실제 결과에 맞게 `[x]`로 갱신한다.
3. `node <work-status.mjs> sync <slug>` (필요 시 `complete`는 사용자가 「완료」라고 할 때만).
4. 한국어로 **짧게** 요약한다: 무엇을 바꿨는지, 테스트 결과, 완료 기준 충족 여부, 저장한 메모리 건수.

커밋·푸시는 사용자가 `/cursor-atomic-wrapup` 또는 명시적으로 요청할 때만 한다.
