---
name: cursor-atomic-review
description: "cursor-atomic-workflow Phase 4. REVIEW-<slug>.md 작성과 테스트 대조. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-review

입력: 커맨드 뒤 텍스트(슬러그). 비어 있으면 현재 TASKS를 대상으로 본다.

`cursor-atomic-workflow` 스킬과 스킬 디렉터리의 `testing.md`를 읽고 Phase 4를 수행한다. 서브에이전트 호출법과 스크립트 경로는 `references/harness.md`를 따른다.

남은 구현이 있으면 기본 파이프라인으로 그 항목부터 돌린 다음 리뷰한다. `tester`가 완료된 후 저장소 테스트도 `run-done`으로 실행한다. 그 외에는 `reviewer` 서브에이전트를 백그라운드로 띄운다. `reviewer`는 작업자(`worker`)의 대화 맥락을 상속받지 않는 독립 fresh 컨텍스트로 실행되어, PLAN/TASKS 명세와 실제 `git diff`만을 대조하여 Standards/Spec을 객관적으로 독립 검증한다. 브리프 첫 줄에 `cursor-atomic-workflow`·`code-review` 경로를 적는다. 손자 에이전트를 시키라고 하지 마라. 산출물은 슬러그 폴더(`~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/`, 레거시 `.docs/<slug>/`, `docs/<slug>/`)의 `REVIEW-<slug>.md`다.

Structured Validation 원칙: 빌드/테스트 raw 로그 전체를 채팅창에 덤프하지 말고, 결과 요약, 결함, 실패 시 `errorTail`(마지막 20줄) 및 로그 파일 경로만 간결히 보고한다. 실패한 테스트나 의미 있는 survived mutation을 통과로 쓰지 마라. 커밋하지 마라. 다음이 커밋이면 `/cursor-atomic-wrapup`을 안내한다.

REVIEW 저장(또는 TASKS 재작업) 직후 `node .atomic/scripts/work-status.mjs sync <slug>`로 STATUS.json을 갱신한다.

리뷰 재작업: REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤 worker → reviewer를 한 번만 자동 재실행한다. 한 바퀴 후에도 결함이면 멈추고 보고한다 (flake retry 없음). 사람 게이트는 PLAN(Phase 1)만이며 리뷰 재작업 1회는 정책으로 자동 실행된다.
