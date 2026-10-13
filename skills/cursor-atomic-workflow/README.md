# cursor-atomic-workflow

`/cursor-atomic-plan`이 PLAN을 확정하면 task → execute → review는 자동이다. 커밋만 `/cursor-atomic-wrapup`. 이어서 할 일이 흐려지면 `/cursor-atomic-status`.

이 저장소는 **Cursor** 전용이다. 단계마다 Task 서브에이전트가 다른 모델로 돌고, 번들 스킬은 설치 즉시 발견된다.

계획 단계의 사용자 문답은 async `planner`가 아니라 부모 오케스트레이터가 번들된 `grilling`으로 수행한다. 부모가 남긴 `계획 정제` brief가 있어야 planner가 PLAN을 작성한다. `wayfinder` tracker 흐름은 사용자가 명시했을 때만 사용하고, 자동 큰 작업 경로는 `local-wayfinding`이다.

에이전트 지시: [SKILL.md](SKILL.md). 템플릿: [reference.md](reference.md). 워커: [workers.md](workers.md). 모델: [models.md](models.md). 테스트: [testing.md](testing.md).

## 헤드리스 CLI (bash)

TASKS `worker:`가 `agy|opencode|codex|claude`일 때 Cursor는 Task `cli-delegate`가 아래 스크립트만 실행한다.

```bash
# PATH 확인
bash .agents/skills/cursor-atomic-workflow/scripts/ensure-workers.sh

# 비대화형 실행 (단일 진입점)
bash .agents/skills/cursor-atomic-workflow/scripts/invoke-worker.sh \
  --worker agy \
  --workspace "$(pwd)" \
  --prompt-file /path/to/brief.md \
  --log-file /path/to/run.log \
  --skills cursor-atomic-workflow,tdd
```

Windows는 동일 계약의 `invoke-worker.ps1` / `ensure-workers.ps1`을 쓴다. `agy`를 인자 없이 실행하지 마라 (TUI 정지).

진입점:

- 커맨드 스킬: `.cursor/skills/cursor-atomic-*/SKILL.md`
- 에이전트: `.cursor/agents/*.md`

계획이 막히면 구현으로 넘어가지 않는다. 커밋은 `/cursor-atomic-wrapup`일 때만, 푸시는 따로 요청할 때만 한다.
