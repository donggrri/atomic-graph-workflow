---
name: cursor-atomic-review
description: "cursor-atomic-workflow Phase 4. REVIEW-<slug>.md 작성과 테스트 대조. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-review

입력: 커맨드 뒤 텍스트(슬러그). 비어 있으면 현재 TASKS를 대상으로 본다.

`cursor-atomic-workflow` 스킬과 스킬 디렉터리의 `testing.md`를 읽고 Phase 4를 수행한다. 서브에이전트 호출법과 스크립트 경로는 `references/harness.md`를 따른다.

`docsDir` = `node .atomic/scripts/work-status.mjs path <slug> [--repo <dir>]`. 남은 구현이 있으면 기본 파이프라인부터. 그 외 `cursor-atomic-reviewer`를 띄운다(작업자 맥락 미상속). 브리프: 1줄 스킬 경로, 2줄 `docsDir: <absolute>`. 산출물 `<docsDir>/REVIEW-<slug>.md`. 손자 에이전트 금지.

Structured Validation 원칙: 빌드/테스트 raw 로그 전체를 채팅창에 덤프하지 말고, 결과 요약, 결함, 실패 시 `errorTail`(마지막 20줄) 및 로그 파일 경로만 간결히 보고한다. 실패한 테스트나 의미 있는 survived mutation을 통과로 쓰지 마라. 커밋하지 마라. 다음이 커밋이면 `/cursor-atomic-wrapup`을 안내한다.

REVIEW 저장(또는 TASKS 재작업) 직후 `node .atomic/scripts/work-status.mjs sync <slug>`로 STATUS.json을 갱신한다.

리뷰 재작업: REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤 worker → reviewer를 한 번만 자동 재실행한다. 한 바퀴 후에도 결함이면 멈추고 보고한다 (flake retry 없음). 사람 게이트는 PLAN(Phase 1)만이며 리뷰 재작업 1회는 정책으로 자동 실행된다.
