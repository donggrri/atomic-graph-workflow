---
name: cursor-atomic-run
description: "명시적 파이프라인 진입. Input 의도로 트리아지를 건너뛰고 explore부터 자동 워크플로를 실행한다."
---

# /cursor-atomic-run

입력: 커맨드 뒤 텍스트(의도). 비어 있으면 현재 대화의 요청을 의도로 본다.

`cursor-atomic-workflow` 스킬과 `references/routing.md`를 먼저 읽는다. 패키지에 번들된 `grilling`, `domain-modeling`도 필요할 때 직접 읽는다.

## 트리아지 생략

상시 규칙의 「진입 / 직접 처리」 판정은 **하지 않는다**. 이 커맨드는 **항상 파이프라인 진입**으로 간주한다.

한 줄 알림 예: `판정: 파이프라인 진입 (이유: /cursor-atomic-run 명시 호출) · 슬러그: <slug>`

## 슬러그

의도에서 영어 키워드를 고르고 `scripts/lib/slug.mjs`의 `normalizeSlug` / `uniqueSlug`로 검증·중복 회피한다. 산출물은 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/` (레거시 `.docs/<slug>/`, `docs/<slug>/`).

## 이후 흐름

1. **의도 명확도** — `routing.md`의 CLEAR / UNCLEAR / `--auto`·「알아서」 / 파괴적·보안·비용 규칙을 따른다.
2. **PLAN 게이트** — 필요 시 explore, grilling preflight, PLAN 작성·승인(막힌 질문 처리).
3. **러너** — PLAN 게이트 통과 후 `references/routing.md`의 러너 실행·감시·종료코드 표대로 `run-pipeline.mjs`를 백그라운드 실행하고 로그를 폴링한다.

서브에이전트 호출, 스크립트 경로, Task 카드 형식은 `cursor-atomic-workflow`의 `references/harness.md`를 따른다.

## 기존 커맨드

`/cursor-atomic-explore`, `/cursor-atomic-plan` 등 개별 Phase 커맨드는 그대로 두며, 사용자가 그 커맨드를 직접 호출하면 상시 규칙에 따라 **트리아지 미진입(직접 처리)** 로 본다.

커밋은 `/cursor-atomic-wrapup`에서만 한다. 자동 푸시 없음.
