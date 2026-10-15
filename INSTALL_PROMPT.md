# 설치 프롬프트 (어느 에이전트에든 그대로 붙여넣기)

> `<WORKFLOW_REPO>` 기본값: `https://github.com/donggrri/atomic-workflow`

```text
이 저장소에 Atomic Workflow를 설치해줘. 아래 순서를 지키고, 각 단계 결과를 짧게 보고해.

0. 안전 규칙
   - 커밋, push, PR은 하지 마. 파일만 바꾸고 마지막에 변경 목록을 보여줘.
   - 기존 AGENTS.md / CLAUDE.md 내용은 지우지 마. `<!-- atomic:begin -->`~`<!-- atomic:end -->` 블록만 추가하거나 교체해.

1. 환경 확인
   - `node -v` 실행. 없거나 22.13 미만이면 설치를 멈추고 "Node >=22.13 필요"라고 알려줘. 설치 후 `node .atomic/scripts/doctor.mjs`도 Node 버전을 검사해 미달이면 실패한다.
   - `git rev-parse --show-toplevel`로 저장소 루트로 이동.

2. 하네스 감지 (해당되는 것 모두)
   - 네가 스스로 어떤 에이전트인지 먼저 말해 (Cursor / opencode / Codex / Pi / Antigravity / Claude Code / 기타).
   - 저장소에 있는 폴더도 확인: .cursor, .opencode, opencode.json, .codex, .pi, .agents, .agent, .claude, CLAUDE.md, GEMINI.md.
   - 결과를 `--harness` 값으로 정리 (예: `cursor,opencode`). 판단이 애매하면 `all` (Claude Code는 기본 제외).

3. 설치
   - 임시 폴더에 워크플로 저장소를 받는다:
     git clone --depth 1 <WORKFLOW_REPO> "${TMPDIR:-/tmp}/atomic-workflow"
   - 실행:
     node "${TMPDIR:-/tmp}/atomic-workflow/scripts/install.mjs" --target . --harness <2단계 결과>
   - Claude Code도 필요하면 `--with-claude` 또는 `--harness claude`를 추가.
   - 이전 버전(`.cursor/skills/cursor-atomic-*`)이 있으면 `--migrate`를 붙여 중복 스킬을 정리.
   - 기대 결과: `.atomic/`(scripts, graph.yaml), `.agents/skills/atomic-*`, AGENTS.md 블록, 하네스별 어댑터
     (cursor: .cursor/agents / opencode: .opencode/commands, .opencode/agents / pi: .pi/prompts / claude: .claude/* + CLAUDE.md의 @AGENTS.md).

4. 검증
   - `node .atomic/scripts/doctor.mjs --harness <하네스> --target .` 실행. 실패 항목은 고치고 다시 실행해서 통과할 때까지.
   - `node .atomic/scripts/work-status.mjs list`가 오류 없이 출력되는지 확인.
   - 네 하네스에서 스킬 목록에 `atomic-lite`, `atomic-plan`이 보이는지 확인.

5. 보고
   - 감지한 하네스, 생성/수정된 파일 목록, doctor 결과, 사용법 한 줄
     (예: "코딩 작업을 그냥 요청하면 lite/full을 자동 선택. 직접 지정: /atomic-lite").
```
