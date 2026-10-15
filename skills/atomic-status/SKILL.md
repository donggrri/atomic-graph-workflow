---
name: atomic-status
description: "atomic-workflow 진행 상태를 보고한다. 사용자가 직접 호출할 때만 쓴다."
---

# /atomic-status

입력: 커맨드 뒤 텍스트(슬러그). 비어 있으면 전역 목록을 보고한다.

`atomic-workflow` 스킬을 읽고 상태만 보고한다. 스크립트 경로는 `references/harness.md`를 따른다.

파일을 고치거나 커밋하지 마라. 서브에이전트를 띄우지 마라.

`docsDir` = `node .atomic/scripts/work-status.mjs path <slug> [--repo <dir>]`. `runsDir` = `docsDir`의 `/docs/`→`/runs/`.

1. **기본 출력은 전역 목록이다.** `node .atomic/scripts/work-status.mjs list`(또는 `npm run status`)로 워크플로 홈 아래 모든 `STATUS.json`을 표로 보고한다. 슬러그 한 건만 보여 주지 마라. 입력에 슬러그가 있으면 `show <slug>`만 자세히 본다.
2. 레거시 호환으로 `.docs/<slug>/`(`.docs/*/`), `git worktree list` 형제 경로의 `.docs/*/`, `docs/<slug>/`에서도 `EXPLORE-*.md`, `PLAN-*.md`, `TASKS-*.md`, `REVIEW-*.md`를 찾는다. 목록에 없는 레거시만 짧게 덧붙인다. 루트·홈에 남은 레거시 평탄 파일이 있으면 언급하되 자동 이동하지 않는다.
3. 런 로그(`<runsDir>/`, Windows: `<runsDir>/`)도 본다.
4. 목록이 비면 「활성 워크플로 없음. `/atomic-explore` 또는 `/atomic-plan`으로 시작한다」.
5. 목록이 있으면 슬러그·shortRepo·phase·체크 비율·막힘·Cursor `sessionId`를 한국어로 표기한다. 현재 cwd와 `repo`/`cwd`가 맞는 행이 있으면 표시만 한다. 막힘 발생 시 실패한 항목만 재시도하도록 다음 커맨드로 `/atomic-execute`를 안내한다.
