---
name: atomic-wrapup
description: "atomic-workflow Phase 5 wrapup. 커밋하고 전역 상태를 갱신한다. 푸시 없음. 사용자가 직접 호출할 때만 쓴다."
---

# /atomic-wrapup

입력: 커밋 메시지에 덧붙일 텍스트. 비어 있어도 된다.

`atomic-workflow` 스킬을 읽고 Phase 5를 수행한다. 스크립트 경로는 `references/harness.md`를 따른다.

`docsDir` = `node .atomic/scripts/work-status.mjs path <slug> [--repo <dir>]`. `workflowHome` = 전역 홈(`ATOMIC_WORKFLOW_HOME` 또는 `~/.atomic-workflow`). `docsDir`이 전역 홈 아래 `docs/<shortRepo>/<slug>`일 때만 세 단계 상위가 `workflowHome`과 일치하고, repo-local `docsRoot`일 때는 일치하지 않으므로 하드코딩된 상위 탐색을 쓰지 마라.

이 단계는 서브에이전트에 넘기지 마라. 이 세션이 직접 커밋한다.

1. `git status`, `git diff`, `git log`를 본다.
2. `.env`/토큰/`service_role`이 있으면 제외하고 경고한다.
3. PLAN/TASKS/REVIEW는 기본적으로 커밋하지 않는다. 슬러그 폴더(`<docsDir>/` 또는 레거시 `.docs/<slug>/`, `docs/<slug>/`)의 원본은 그대로 두고, 복사본만 증거 디렉터리(`<workflowHome>/evidence/{shortRepo}/<YYYY-MM-DD>-<slug>/`, Windows: `<workflowHome>/evidence/{shortRepo}/<YYYY-MM-DD>-<slug>/`)에 둔다.
4. 관련 파일만 add하고 1~2문장으로 커밋한다.
5. 푸시하지 않는다.
6. 커밋이 성공하면 전역 상태를 갱신한다. `node .atomic/scripts/work-status.mjs sync <slug> commit`. 사용자가 「완료」라고 하면 `node .atomic/scripts/work-status.mjs sync <slug> complete`(또는 `complete <slug>`)로 `phase: complete`를 기록한다. 푸시만으로는 완료가 되지 않는다.

한국어로 해시와 남은 일을 보고한다.
