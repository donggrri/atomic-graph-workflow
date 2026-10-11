# 하네스 어댑터 (Cursor)

이 저장소는 **Cursor** 전용이다. 커맨드 스킬(`cursor-atomic-*`)과 워크플로 `SKILL.md`는 하네스 중립 문구로 쓰고, Cursor에서만 달라지는 호출·경로·도구는 이 문서에만 적는다.

## 서브에이전트 띄우기

본문에서 "`<에이전트>` 서브에이전트를 백그라운드로 띄운다"는 Cursor **Task** 호출(`run_in_background: true`)을 뜻한다. 브리프 첫 줄에 강제 스킬 경로를 적고, 비밀·토큰·`.env`는 넣지 않는다.

에이전트 정의는 `.cursor/agents/<subagent_type>.md`다. 단계별 `model` 슬러그는 `scripts/lib/roles.mjs`의 `ROLES`와 각 에이전트 파일 frontmatter `model`이 맞아야 한다. Task 호출 시 `model`을 생략하지 않는다.

TASKS `worker:`가 `agy|opencode|codex|claude`이면 `cli-delegate`를 띄운다. `cli-delegate`는 [workers.md](../workers.md)의 `invoke-worker.sh`(bash) 또는 `invoke-worker.ps1`(Windows)만 실행한다.

### Cursor 호출 카드

`/cursor-atomic-*` 파이프라인에서 자식을 띄울 때는 이 카드가 「좁은 질문은 Task를 쓰지 않는다」「작은 수정은 부모가 직접 한다」보다 우선한다. 그 규칙은 파이프라인 밖에서만 적용한다. Task가 최상위 도구 목록에 없으면 서브에이전트가 없다고 보지 않는다. `GetDynamicTools`로 `cursor` / `Task` 스키마를 확인한 뒤 `CallDynamicTool`로 호출한다. 그 확인 없이 `self`로 내려가지 않는다.

역할 `reviewer`의 Cursor `subagent_type`은 `cursor-atomic-reviewer`다. `reviewer`로 부르지 않는다. 나머지 역할은 역할 이름과 `subagent_type`이 같다.

| 역할 | subagent_type | model |
|---|---|---|
| explorer | `explorer` | `claude-haiku-5-5-high` |
| planner | `planner` | `claude-sonnet-5-5-high` |
| plan-reviewer | `plan-reviewer` | `grok-4.7-high` |
| tasker | `tasker` | `composer-2.5` |
| worker | `worker` | `composer-2.5` |
| reviewer | `cursor-atomic-reviewer` | `claude-sonnet-5-5-high` |
| tester | `tester` | `claude-haiku-5-5-high` |
| cli-delegate | `cli-delegate` | `grok-4.7-high` |

reviewer의 `model`은 `claude-sonnet-5-5-high`다(worker와 다른 모델 계열이어야 독립 검증이 된다). 이 슬러그가 세션 `available_subagent_models`에 없으면 멈추고 목록을 보고한다. 모든 역할은 표의 슬러그만 쓴다.

### Bugbot 선행 검토 카드

Review 단계 진입마다 `run-pipeline.mjs`가 bugbot 호출 카드를 남기고 종료코드 10으로 멈출 수 있다. **bugbot은 위 역할 모델 표의 유일한 예외**다. `ROLES`·`.cursor/agents`에 bugbot 역할을 두지 않으며, Task 호출 시 **`model` 필드를 넣지 않고 세션 기본 모델**로 first-party `subagent_type: "bugbot"`을 호출한다. `kind: "bugbot"` 카드는 task-card 5역할 존재 검사 대상이 아니다.

- `description`: `"Bugbot"`
- `subagent_type`: `"bugbot"`
- `run_in_background`: `false`
- `prompt`(정확히 3줄):
  - `Full Repository Path: <repoRoot>`
  - `Diff: branch changes`
  - `Custom Instructions: cursor-atomic-workflow slug <slug>, review pass <n>. Spec: PLAN <planPath>, TASKS <tasksPath>. Report only concrete bugs in the branch changes.`
- 부모는 bugbot 결과를 `findingsPath`(`runs/.../bugbot-findings.md`)에 `# Bugbot findings — <slug> pass <n>` 헤더와 함께 저장하거나, 실패 시 `# BUGBOT_FAILED` / `reason:` / `attempts:` 마커를 쓴 뒤 `--resume`한다.

예시(Task, `model` 생략):

```text
namespace: cursor
toolName: Task
arguments:
  description: Bugbot
  subagent_type: bugbot
  run_in_background: false
  prompt: |
    Full Repository Path: /path/to/repo
    Diff: branch changes
    Custom Instructions: cursor-atomic-workflow slug my-slug, review pass 1. Spec: PLAN /path/PLAN-my-slug.md, TASKS /path/TASKS-my-slug.md. Report only concrete bugs in the branch changes.
```

`model`은 이번 세션의 `available_subagent_models`에 있을 때만 그 슬러그를 넣는다. 없으면 호출을 멈추고 없는 슬러그와 세션 목록을 보고한다. 같은 계열의 다른 슬러그로 바꿀 때는 어떤 슬러그를 썼는지 보고에 적는다. `inherit`나 생략으로 부모 모델을 쓰지 않는다.

```text
namespace: cursor
toolName: Task
arguments:
  description: <3~5단어>
  subagent_type: <위 표>
  model: <위 표의 슬러그>
  run_in_background: true
  prompt: |
    첫 줄: 강제 스킬 절대 경로
    이어서 역할, 슬러그, 산출물 경로, 하지 않을 것
```

`subagent_type`이 `available_subagent_types`에 없으면 그 타입으로 Task를 호출하지 않는다. 없는 역할을 다른 `subagent_type`으로 바꾸지 않는다. 러너가 task-card(종료코드 10)로 멈췄고 세션에 `tasker`, `planner`, `plan-reviewer`, `worker`, `cursor-atomic-reviewer` 중 하나라도 없으면 카드를 실행하지 말고, 같은 슬러그를 `--adapter sdk --resume`로 다시 실행한다. 그 밖의 누락은 설치가 옛 것이므로 보고하고, `node scripts/install.mjs --target <프로젝트> --force` 뒤 새 세션이 필요하다.

### plan-reviewer (PLAN 비판 검토)

cost-gate 통과 후 tasker 전에 러너가 `plan-reviewer`를 띄운다. Task `model`은 **`grok-4.7-high`**(위 역할 표). SDK 경로는 헤드리스로 끝까지 진행하고, task-card는 `subagent_type: "plan-reviewer"` 카드로 종료코드 10 후 부모 Task → `--resume`한다. planner 자동 수정 카드는 `subagent_type: "planner"`(revise 프롬프트). 상세 전이·종료코드는 [routing.md](routing.md) 「PLAN 비판 검토」를 따른다.

## 커맨드 입력

커맨드 스킬의 "입력"은 사용자가 `/cursor-atomic-<이름>` 스킬을 호출할 때 함께 보낸 메시지 텍스트다. 비어 있으면 각 커맨드 스킬이 정한 기본값을 쓴다.

## 스크립트 경로

문서의 `scripts/<파일>`(`work-status.mjs`, `run-done.mjs`, `memory.mjs`)은 아래 순서로 찾는다.

1. 이 패키지 저장소 안이면 루트 `scripts/<파일>`.
2. 그 외(설치 프로젝트)에는 `~/.cursor/skills/cursor-atomic-workflow/scripts/<파일>` 또는 이 저장소를 클론한 경우 루트 `scripts/<파일>`.

## 하네스 전용 도구

- Cursor: `rename_chat`, `move_agent_to_root`. 파이프라인 밖에서만 쓰지 말고, 워크트리를 만들었으면 즉시 `move_agent_to_root`로 옮긴다.
- 셸이 PowerShell(Windows)이면 heredoc 대신 here-string을 쓰고, CLI 위임은 [workers.md](../workers.md)의 PowerShell 경로를 쓴다.
