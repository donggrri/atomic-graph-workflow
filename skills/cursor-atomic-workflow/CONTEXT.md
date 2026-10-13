# 도메인 용어 고정 — 자동 테스트 게이트

이 파일은 `cursor-atomic-workflow` 패키지 내에서 "자동 테스트 게이트"와 관련된 도메인 용어를 정의한다. 모든 에이전트와 워커가 이 정의를 따르도록 한다.

---

## 테스트 게이트

항목 완료를 결정하는 **부모의 검증**이다. 워커 로그가 아니다.

- 워커가 완료했다고 주장하는 것만으로 통과하지 않는다.
- 부모 오케스트레이터가 `done` 명령을 직접 실행하여 결과를 판단한다.
- 테스트 게이트는 항목의 완료 여부를 최종 결정하는 권한을 가진다.

## 완료 조건

`TASKS` 항목의 `done` 필드에 적힌, 부모가 실행할 셸 명령이다.

- `done`에 기재된 명령은 반드시 부모 오케스트레이터가 직접 실행한다.
- 워커가 `done` 명령을 스스로 실행하고 결과를 보고하는 것이 아니다.
- 완료 조건이 통과해야 해당 항목을 `[x]`로 체크할 수 있다.
- 예: `node -e "process.exit(0)"`, `npm test`, `npx stryker run --mutate src/file.ts` 등

## 증거

`~/.cursor-atomic-workflow/runs/{shortRepo}/<slug>/<id>.done.json` 파일이다.

- 각 항목의 테스트 게이트 통과 여부를 기록하는 JSON 파일이다.
- `<slug>`는 해당 PLAN/TASKS의 슬러그 이름이다.
- `<id>`는 TASKS 항목의 고유 식별자이다.
- 같은 디렉터리의 `<id>.log`가 그 명령의 stdout/stderr이다.
- `scripts/run-done.mjs`는 로그 경로가 `.log`로 끝나면 그 접미사를 `.done.json`으로 바꿔 증거를 쓴다. 파이프라인 로그는 `<id>.log`이다.
- 증거 파일이 존재하지 않거나 유효하지 않으면, 해당 항목은 완료되지 않은 것으로 간주한다.

## 막힘

게이트가 실패한 뒤 파이프라인을 멈추는 상태이다.

- 테스트 게이트(완료 조건)가 통과하지 못하면 해당 항목은 `막힘` 상태가 된다.
- 막힘이 발생하면 파이프라인은 즉시 멈추고 더 이상 다음 항목으로 진행하지 않는다.
- 막힘 상태에서는 워커 로그만으로는 문제를 해결할 수 없다.
- 부모 오케스트레이터가 `막힘:` 원인과 로그 경로를 남기고 상황을 보고한다.
- 막힘을 해결하려면 사용자 또는 오케스트레이터가 개입하여 근본 원인을 제거해야 한다.

## 리뷰 재작업

REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤 worker→reviewer를 최대 1회 자동 재실행하는 복구 절차이다.

- REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤 worker→reviewer를 최대 1회 자동 재실행한다.
- 한 바퀴 후에도 결함이면 멈추고 보고한다.

## 막힘 재개

실패한 항목만 재시도하는 복구 절차이다.

- 실패한 항목만 재시도한다. 이미 [x]는 유지한다.
- 재시도 시작 때 그 항목의 `막힘:`만 지운다.
- 입구는 `/cursor-atomic-execute`이다.

## 사람 게이트

파이프라인 진행 중 사람의 개입 또는 승인이 허용되는 유일한 관문이다.

- 사람 게이트는 PLAN(Phase 1)만 해당한다.
- 리뷰 재작업 1회·막힘 재개는 정책으로 자동 실행된다.

## PLAN 비판 검토

cost-gate 통과 직후·tasker 전에 `run-pipeline.mjs`가 자동 실행하는 `plan-reviewer` 검토다. Phase 1(PLAN 게이트)의 연장이며, exit 20으로 멈추면 PLAN 게이트로 되돌아가 사용자가 PLAN을 고치거나 「계획 정제」에 수용한다. 「사람 게이트는 PLAN(Phase 1)만」 불변식은 유지한다.

- 산출물: docs dir `PLAN-REVIEW-<slug>.md`. **`## 계획 결함`**만 차단; **`## 개선 제안`**은 비차단.
- 차단 결함 시 planner가 PLAN을 **1회** 자동 수정한 뒤 plan-reviewer가 재검토한다. 재검토 후에도 차단 결함이면 exit 20.
- PLAN-REVIEW가 없거나 `## 계획 결함` 섹션이 없으면 fail-closed(exit 30).

## PLAN 자동 수정

plan-review에서 **`## 계획 결함`**이 있을 때 planner가 PLAN을 한 번 고치는 절차다. 사용자 승인본과 달라질 수 있으며, 승인본은 `runs/.../plan-review/PLAN-<slug>.approved.md`에 보관하고 `pipeline.log`·최종 보고·PLAN `## 자동 수정 기록`에 남긴다.

## Bugbot 선행 검토

Review 단계(Phase 4)에 **진입할 때마다** 부모 오케스트레이터가 Cursor first-party `bugbot` 서브에이전트를 실행하는 선행 검토다. 초기 리뷰와 재작업 후 재리뷰(pass 2) 모두 해당한다.

- 러너는 bugbot 카드를 `next-card.json`에 쓰고 종료코드 10으로 멈출 수 있다. 부모가 Task로 bugbot을 실행한 뒤 결과를 `bugbot-findings.md`에 저장하고 `--resume`한다.
- bugbot 결과는 항목 **증거**나 완료 **게이트**가 아니다. `cursor-atomic-reviewer`가 Standards/Spec 검증과 함께 **트리아지 입력**으로만 읽는다.
- bugbot 실패(`BUGBOT_FAILED`)만으로 리뷰나 파이프라인을 멈추지 않는다.

---

## 용어 요약

| 용어 | 정의 |
|------|------|
| 테스트 게이트 | 항목 완료를 결정하는 부모의 검증. 워커 로그가 아니다. |
| 완료 조건 | TASKS 항목의 done에 적힌, 부모가 실행할 셸 명령 |
| 증거 | ~/.cursor-atomic-workflow/runs/{shortRepo}/\<slug\>/\<id\>.done.json |
| 막힘 | 게이트가 실패한 뒤 파이프라인을 멈추는 상태 |
| 리뷰 재작업 | REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤 worker→reviewer를 최대 1회 자동 재실행. 한 바퀴 후에도 결함이면 멈추고 보고. |
| 막힘 재개 | 실패한 항목만 재시도. 이미 [x]는 유지. 재시도 시작 때 그 항목의 `막힘:`만 지운다. 입구는 `/cursor-atomic-execute`. |
| 사람 게이트 | PLAN(Phase 1)만. 리뷰 재작업 1회·막힘 재개는 정책으로 자동. |
| PLAN 비판 검토 | cost-gate 뒤 plan-reviewer가 PLAN-REVIEW를 쓰는 자동 검토. exit 20은 PLAN 게이트 복귀. |
| PLAN 자동 수정 | plan-review 차단 결함 시 planner가 PLAN 1회 수정. 승인본과 다를 수 있음. |
| Bugbot 선행 검토 | Review 진입마다 부모가 실행하는 Cursor bugbot. 결과는 reviewer 트리아지 입력이며 증거·게이트가 아님. |
| 프로필 | plan·test 지침 묶음. id로 고른다. 단계 순서와 PLAN 파일 위치는 바꾸지 않는다. |
