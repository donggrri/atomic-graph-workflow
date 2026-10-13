# 의도 트리아지와 라우팅

상시 규칙(`.cursor/rules/atomic-router.mdc`)과 `/cursor-atomic-run`이 따르는 판정 표다. **코드 분류기는 없다.** IDE 부모 LLM이 사용자 Input을 읽고 이 표에 맞춰 판정한다. 판정 후 한 줄 알림을 채팅에 남긴다.

## lite vs full (메인 채팅)

사용자가 워크플로 슬래시를 **지정하지 않고** 코딩 작업을 요청했을 때, 부모는 먼저 **lite**(`cursor-atomic-lite`) vs **full**(`/cursor-atomic-plan` 파이프라인)을 고른다. 사용자가 `/cursor-atomic-lite`, `/cursor-atomic-plan`, `/cursor-atomic-run` 등을 명시하면 그 모드가 우선한다.

| 라우팅 | 신호 (하나 이상이면 **full**) |
|--------|-------------------------------|
| **full** | 변경 파일 **5개 이상** 예상 / DB·스키마·마이그레이션 / 인증·권한·보안·시크릿 / **모듈·레이어를 가로지르는 설계** / 요구가 모호·막힌 질문 필요 / 대규모 리팩터·신규 기능(여러 영역) |
| **lite** | **작고 국소적**, 범위가 Input에 잘 드러남 / 보통 **4개 이하** 파일 / 단일 동작·버그·문서·테스트 한정 |

**한 줄 알림** (작업 시작 전): `라우팅: lite (이유: 2파일, 요구 명확)` 또는 `라우팅: full (이유: 인증·다중 모듈)`.

lite로 시작했는데 구현·탐색 중 full 신호가 나타나면 **즉시 멈추고** full로 전환을 권한다(`cursor-atomic-lite` 에스컬레이션과 동일).

질문·설명만, 1~2파일 사소 수정은 아래 「직접 처리」로 워크플로 없이 처리할 수 있다.

## 파이프라인 진입 vs 직접 처리

| 판정 | 신호 (하나 이상이면 진입) |
|------|---------------------------|
| **파이프라인 진입** | 여러 파일 변경·탐색이 필요함 / 동작(런타임·API·UX) 변경 / 신규 기능 / 버그 수정(원인·회귀 검증이 필요한 수준) |
| **직접 처리** | 질문·설명만 / 1~2개 파일의 사소한 수정(오타, 한 줄, 포맷) / 「직접 해줘」「바로 고쳐」 / 다른 `/cursor-atomic-*` 등 워크플로 **개별 커맨드** 호출 / 다른 슬래시 명령이 명시됨 |

### 경계 예시

1. **진입** — 「로그인 API 추가하고 프론트 폼도 붙여줘」(신규 기능, 여러 파일)
2. **진입** — 「MQTT 재연결 시 메시지가 두 번 가는 버그」(버그 수정, 동작 변경)
3. **진입** — 「리팩터링해서 결제 모듈을 서비스 레이어로 분리」(여러 파일, 동작·구조)
4. **진입** — 「이 함수가 왜 null을 반환하는지 찾아서 고쳐줘」(버그 수정, 탐색 포함 가능)
5. **직접** — 「이 에러 메시지가 무슨 뜻이야?」(질문·설명)
6. **직접** — 「README 오타 하나 고쳐줘」(1파일 사소한 수정)
7. **직접** — 「import 순서만 맞춰줘」(1~2파일 사소한 수정)
8. **직접** — 「그냥 직접 패치해, 플랜 없이」(「직접 해줘」)
9. **직접** — 사용자가 `/cursor-atomic-plan`만 호출(개별 커맨드; 트리아지 미진입)
10. **진입** — `/cursor-atomic-run OAuth 토큰 갱신`(명시 진입; 트리아지 생략)

## 의도 명확도 (CLEAR / UNCLEAR)

| 등급 | 조건 | 부모 행동 |
|------|------|-----------|
| **CLEAR** | 목표·범위가 Input만으로 정해짐 | 저장소·코드로 답할 수 **없는** 선택지만 `grilling` **한 라운드** 질문 → 답 받으면 자동 진행 |
| **UNCLEAR** | 목표는 있으나 세부가 비어 있음 | **모범 기본값** 채택, PLAN 「계획 정제」에 `defaults-adopted:` 목록 기록, **추가 질문 없이** 진행 |
| **질문 생략** | `--auto` 플래그 또는 사용자가 「알아서」「auto」 | CLEAR/UNCLEAR 질문 라운드를 생략하고 정책대로 진행 |
| **항상 질문** | 파괴적 작업, 보안·비밀, 비용(SDK 호출 등), 되돌릴 수 없음 | 관련 결정을 **모아서 한 번** 질문(러너 exit 20과 연동) |

파괴적·보안·비용·되돌릴 수 없음 예: `git push --force`, 시크릿 커밋, 프로덕션 DB 마이그레이션, 대량 파일 삭제, SDK 파이프라인 첫 실행 전 비용 확인(이후 plan-review·tasker·worker·reviewer·tester까지 LLM 호출이 추가될 수 있음).

## 알림 형식 (한 줄)

- 진입: `판정: 파이프라인 진입 (이유: 신규 기능, 여러 파일) · 슬러그: <slug>`
- 미진입: `판정: 직접 처리 (이유: 1파일 사소한 수정)`

이유는 표의 신호를 짧게 요약한다. 슬러그는 영어 키워드로 고른 뒤 아래 헬퍼로 검증한다.

## 슬러그

1. 부모 LLM이 의도에서 **영어 키워드**를 고른다 (한국어 의도를 이 모듈이 번역하지 않음).
2. `scripts/lib/slug.mjs`의 `normalizeSlug(text)` — 소문자 ASCII kebab, 최대 40자, 빈 결과는 `work`.
3. `uniqueSlug(existing, base)` — `existing`은 이미 `~/.cursor-atomic-workflow/docs/{shortRepo}/` 아래에 있는 슬러그 디렉터리 이름 배열 등. 충돌 시 `-2`, `-3` …

## 진입 후 흐름 (요약)

1. 필요 시 explore → PLAN 게이트(grilling, 막힌 질문).
2. PLAN 승인·게이트 통과 후 `node scripts/run-pipeline.mjs <slug> [--auto]` 실행(아래). 러너는 **blocked-gate → cost-gate → plan-review(PLAN 비판 검토) → tasker → …** 순으로 진행한다. plan-review는 `plan-reviewer`가 `PLAN-REVIEW-<slug>.md`를 쓰고, 결함 시 planner 자동 수정 1회·재검토 후에도 차단 결함이 남으면 종료코드 **20**으로 멈춘다(아래 「PLAN 비판 검토」).
3. 커밋은 `/cursor-atomic-wrapup`만. 러너·워커는 커밋하지 않음.

`/cursor-atomic-run`은 **1단계 트리아지를 건너뛰고** 항상 파이프라인 진입으로 간다. 이후 grilling·러너·종료코드는 이 문서와 `references/harness.md`를 따른다.

## 러너 실행 위치·감시

- **cwd**: 현재 열린 제품 저장소 루트(워크플로 패키지가 아닌 작업 대상 repo). 스크립트는 워크플로 설치 경로의 `scripts/run-pipeline.mjs`를 사용한다.
- **시작**: PLAN 게이트 통과 후 Shell에서 `node <path>/scripts/run-pipeline.mjs <slug> [--auto] [--profile <id>]`를 **백그라운드**(`block_until_ms: 0`)로 실행. `--adapter`는 붙이지 않는다. 기본 어댑터는 SDK다. `--profile`을 생략하면 프로젝트 `.cursor-atomic-workflow.json`의 `profile`, 그다음 `~/.cursor-atomic-workflow/settings.json`의 `profile`, 둘 다 없으면 `atomic`이다. PLAN·TASKS·REVIEW 위치는 프로필과 무관하게 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/`다.
- **감시**: `~/.cursor-atomic-workflow/runs/{shortRepo}/{slug}/pipeline.log` 꼬리를 주기적으로 확인해 단계 전환마다 한 줄 보고. task-card가 선택된 이유는 그 로그와 stderr에 같은 한 줄로 남는다.
- **상세**: CLI 인자, 상태 파일, 어댑터는 PLAN 「러너」절 및 `scripts/run-pipeline.mjs`를 참조한다.

### 어댑터

- 기본 어댑터는 SDK다. `@cursor/sdk` import가 성공하면 러너는 task-card로 떨어지지 않는다.
- `--adapter sdk`인데 import가 실패하면 task-card로 바꾸지 않고 종료코드 2로 끝낸다.
- task-card는 import가 실패해 기본 경로가 떨어진 경우이거나, `--adapter task-card`를 명시한 경우에만 쓴다. 그때 러너는 이유 한 줄을 stderr와 `pipeline.log`에 남긴다.
- task-card 프롬프트의 스킬 경로는 대상 저장소 `.cursor/skills/<이름>/SKILL.md` 파일이 있을 때만 그 경로다. 없으면 `~/.cursor/skills/<이름>/SKILL.md`를 가리킨다.

## 종료코드와 부모 행동

| 코드 | 의미 | 부모 행동 (요약) |
|------|------|------------------|
| **0** | 완료(tester 통과) | 한국어로 결과 보고, `/cursor-atomic-wrapup` 안내 |
| **2** | 사용법/전제 오류(PLAN·brief 없음, `--adapter sdk`인데 import 실패 등) | 오류 요약 보고 |
| **10** | 부모 행동 필요(bugbot 선행 검토 카드, task-card 역할 카드, 또는 cli-delegate 항목) | `next-card.json`의 `kind === "bugbot"`(또는 `pipeline.json`의 `bugbot.status === "pending"`)이면 아래 「bugbot 카드」를 **먼저** 탄다. cli-delegate는 그 항목만 위임 후 `--resume`. 그 외 task-card는 아래 「task-card와 세션 역할」(plan-reviewer·planner revise 카드 포함) |
| **20** | 사람 게이트(PLAN 막힌 질문, 비용 확인, **plan-review 차단 결함**, **agy 단계 질문**) | 질문을 모아 한 번에 묻고 답 반영 후 `--resume`. `cursor.phase === "agy-ask"`이면 아래 「agy 단계 질문」. plan-review에서 멈춘 경우 PLAN-REVIEW `## 계획 결함`을 보여 주고 PLAN에 반영하거나 「계획 정제」에 수용 기록 후 `--resume`(자동 수정 1회는 이미 소진된 상태) |
| **30** | 항목 `done` 실패(`막힘:`) 또는 **plan-review 단계 실패**(PLAN-REVIEW 없음·형식 불량 등) | worker 막힘이면 보고 후 `--resume` 또는 `/cursor-atomic-execute`. plan-review 30이면 `--resume`으로 같은 라운드 재시도 |
| **40** | 리뷰 재작업 1회 후에도 결함 | 보고 후 멈춤 |
| **50** | 에이전트 시작 실패(인증·네트워크 등, 1회 재시도 후) | 세션에 `tasker`, `planner`, `plan-reviewer`, `worker`, `cursor-atomic-reviewer`가 모두 있으면 `--adapter task-card --resume`. 하나라도 없으면 task-card로 바꾸지 않고 시작 실패를 보고한다 |

에이전트는 떴으나 단계가 실패한 경우는 50이 아니라 해당 단계 실패(worker → 30 + `막힘:` 등)로 처리한다.

### task-card와 세션 역할

종료코드 10이고 `pipeline.json`의 `adapter`가 `task-card`이면 `next-card.json`을 읽는다.

1. 이 세션 `available_subagent_types`에 `tasker`, `planner`, `plan-reviewer`, `worker`, `cursor-atomic-reviewer`가 모두 있고, 카드의 `subagent_type`도 그 목록에 있으면 카드 그대로 Task를 실행한 뒤 `--resume`한다.
2. 다섯 역할 중 하나라도 없거나 카드의 `subagent_type`이 목록에 없으면 Task를 실행하지 않는다. 없는 `subagent_type`을 다른 역할로 바꾸지 않는다. 같은 슬러그를 `--adapter sdk --resume`로 다시 실행한다.

cli-delegate 항목으로 나온 종료코드 10은 이 분기를 타지 않는다. `explore`, `coder`, `reviewer`처럼 다른 타입이 목록에 있어도 빠진 역할을 그 타입으로 대체하지 않는다.

### agy 단계 질문

`--auto`가 아니면 러너는 계획 검토 앞, 구현 루프 앞, 리뷰 앞에서 한 번씩 멈추고 종료코드 **20**을 낸다. `pipeline.json`의 `cursor.phase`는 `agy-ask`이고, `cursor.stage`는 `plan` | `implement` | `review`이다. `cursor.question`을 그대로 예/아니오로 묻는다.

- 예: `agyChoice.<stage>`를 `"agy"`로 기록하고 `--resume`
- 아니오: `agyChoice.<stage>`를 `"sdk"`로 기록하고 `--resume`

예이면 그 단계만 agy다. 러너는 종료코드 **10**으로 멈추고 `cursor.delegate`는 `"agy"`, `cursor.stage`는 같은 단계다. 부모는 `cli-delegate`로 그 단계만 위임한 뒤 `--resume`한다. 계획이면 PLAN을 갱신한다. 구현이면 `taskId` 한 항목이고, 재개 후 러너가 `done`을 검사한다. 리뷰이면 agy가 `REVIEW-<slug>.md`를 쓴다. bugbot과 `cursor-atomic-reviewer`는 그 선택을 따르지 않는다. 아니오이면 그 단계는 기존 SDK 역할로 간다. 다음 단계 앞에서 다시 묻는다.

### bugbot 카드

Review 단계 진입마다(초기·재작업 후 재리뷰) 러너가 bugbot 호출 카드를 `next-card.json`에 쓰고 종료코드 **10**으로 멈출 수 있다. `kind === "bugbot"`(또는 `pipeline.json`의 `bugbot.status === "pending"`)이면 **어댑터(sdk/task-card)와 무관하게** 이 분기를 task-card 5역할 검사보다 **먼저** 탄다. task-card의 `tasker`·`planner`·`plan-reviewer`·`worker`·`cursor-atomic-reviewer` 다섯 역할 존재 검사는 bugbot 카드에 적용하지 않는다.

1. `next-card.json`에서 `kind === "bugbot"`(또는 카드 JSON의 `kind: "bugbot"`)인지 확인한다.
2. 세션 `available_subagent_types`에 `bugbot`이 있으면 Cursor `Task`로 카드 그대로 실행한다. `description`은 `"Bugbot"`, `run_in_background`는 `false`, `prompt`는 카드 원문(3줄: `Full Repository Path:` / `Diff: branch changes` / `Custom Instructions:`)을 바꾸지 않는다. 카드에 `model` 필드는 없다.
3. 성공 시 bugbot 출력을 카드의 `findingsPath`(보통 `~/.cursor-atomic-workflow/runs/{shortRepo}/{slug}/bugbot-findings.md`)에 저장한다. 파일 맨 위에 `# Bugbot findings — <slug> pass <n>` 헤더를 두고 그 아래에 원문을 붙인다.
4. `node scripts/run-pipeline.mjs <slug> --resume`(또는 동일 슬러그 `--resume`)으로 이어간다. 러너는 findings가 있으면 `cursor-atomic-reviewer`를 띄우며 프롬프트에 `Bugbot findings: <path>`를 포함한다.
5. bugbot Task가 실패하면 **1회** 재시도한다. 그래도 실패하거나 세션에 `bugbot` 타입이 없으면 `findingsPath`에 실패 마커 파일을 쓴다: 첫 줄 `# BUGBOT_FAILED`, 다음 줄 `reason:`, `attempts:`(예: `reason: bugbot unavailable`, `attempts: 2`). 그다음 `--resume`한다. **재시도 후에도 bugbot이 실패했다는 이유만으로 파이프라인을 멈추지 않는다.** reviewer는 `BUGBOT_FAILED`를 트리아지 입력으로만 처리하고 Standards/Spec 검증은 계속한다.

### PLAN 비판 검토 (plan-review)

cost-gate 통과 직후·tasker 전에 러너가 **항상** `plan-reviewer`를 실행한다(SDK 기본, task-card면 종료코드 10 카드). 산출물은 docs dir의 `PLAN-REVIEW-<slug>.md`이며 **`## 계획 결함`**만 차단한다(`## 개선 제안`은 비차단).

1. **`## 계획 결함` 없음** — tasker로 진행한다.
2. **결함 + 자동 수정 미사용** — planner에게 revise 프롬프트(`Revise PLAN for slug …`)로 PLAN 1회 수정 → plan-reviewer 재검토.
3. **재검토 후에도 차단 결함** — 종료코드 **20**. 부모는 PLAN-REVIEW `## 계획 결함`을 사용자에게 보여 주고, PLAN에 고치거나 「계획 정제」에 수용·`## 수용된 위험`으로 기록한 뒤 `--resume`(이때 자동 수정 1회는 다시 하지 않음).
4. **PLAN-REVIEW 없음·`## 계획 결함` 섹션 없음** — fail-closed로 종료코드 **30**. `--resume`으로 같은 라운드를 재시도한다.
5. **exit 0 보고** — `pipeline.json`의 `state.planReview.revised`가 true이면 최종 보고에 **「PLAN이 자동 수정됨(승인본: `<runs>/.../plan-review/PLAN-<slug>.approved.md`)」**을 반드시 적는다.
