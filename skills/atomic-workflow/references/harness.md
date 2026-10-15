# 하네스 어댑터

이 워크플로는 Cursor, AGY(Antigravity), Claude Code, OpenCode, Codex, Pi에서 같은 규칙으로 동작한다. 커맨드 스킬(`atomic-*`)과 워크플로 `SKILL.md`는 하네스 중립 문구로 쓰고, 하네스마다 달라지는 호출·경로·도구는 이 문서에만 적는다. `atomic-*`라는 이름은 호환을 위해 유지한 것이며 Cursor 전용을 뜻하지 않는다.

## 모델 정책

워크플로는 **모델을 지정하지 않는다.** 서브에이전트를 부를 때 `model` 인자를 넣지 않고, 에이전트 정의에도 `model`을 두지 않는다. 모든 호출은 해당 하네스의 기본 모델을 쓴다. 모델을 바꾸려면 하네스 설정에서 바꾼다. 세션에 없는 모델 슬러그를 추측해 넣지 않는다.

## 서브에이전트 띄우기

본문에서 "`<에이전트>` 서브에이전트를 띄운다"는 **공용 서브에이전트 하나**를 호출하고, 그 호출 프롬프트에 역할 지침을 넣는다는 뜻이다. 단계마다 전용 서브에이전트를 설치하지 않는다.

호출 프롬프트에는 다음을 넣는다. 비밀·토큰·`.env`는 넣지 않는다.

1. 강제 스킬 경로(첫 줄들).
2. `docsDir: <absolute>` (필수), 필요하면 `runsDir: <absolute>`.
3. 역할 지침 파일: `.atomic/agents/<subagentType>.md`를 먼저 읽고 따르라는 한 줄(예: `reviewer` 역할은 `atomic-reviewer.md`).
4. 슬러그, 산출물 파일명, 하지 않을 것.

역할 지침은 `.atomic/agents/<subagentType>.md`가 정본이다. 논리 역할 `reviewer`처럼 role 키와 파일명이 다른 경우에는 `roles.mjs`의 매핑을 따른다(`reviewer` → `atomic-reviewer.md`). 러너가 만드는 카드(`next-card.json`)는 `subagent_type: "generic"`, 논리 `role`, `instructions`, `prompt`만 가지며 `model`이 없다.

TASKS `worker:`가 `agy|opencode|codex|claude`이면 `cli-delegate` 지침으로 위임한다. `cli-delegate`는 [workers.md](../workers.md)의 `invoke-worker.sh`(bash) 또는 `invoke-worker.sh`(Windows)만 실행한다.

### 하네스별 호출 도구

같은 호출 프롬프트를 각 하네스의 네이티브 서브에이전트 도구에 넣는다. 아래 이름은 Phase A 실험에서 실제 도구 이벤트로 확인한 것이다.

| 하네스 | 서브에이전트 도구 | 비고 |
|---|---|---|
| Claude Code | `Agent`(`general-purpose`) | `subagent_type`을 생략하면 범용 에이전트가 쓰인다 |
| Cursor | `Task` | `subagentType`을 지정하지 않으면 범용으로 실행되고 모델은 Cursor가 정한다 |
| AGY | `invoke_subagent` | 호출 인자의 `Model`은 `inherit` |
| OpenCode | `subagent` (`agent`: `general`) | 모델이 `explore`/`general`을 임의로 고를 수 있으니 `general`을 명시한다 |
| Codex | 서브에이전트 도구 확인 전 | 확인되기 전에는 부모 세션이 순차 수행한다 |
| Pi | 없음 | 부모 세션이 같은 지침을 순서대로 수행한다 |

서브에이전트 도구가 없거나 이번 실행 모드에서 쓸 수 없으면 부모 세션이 같은 역할 지침을 직접 순차 수행한다. 이때 독립 검토는 새 컨텍스트가 아니라 증거 확인 절차(PLAN·TASKS·diff·테스트를 다시 읽기)로 대신하고, 그 사실을 보고에 적는다. 다른 하네스의 CLI로 몰래 바꾸지 않는다.

지시문만으로 서브에이전트가 자동 호출된다고 가정하지 않는다. 확인된 것은 호출을 **명시했을 때**의 동작이다(AGY는 규칙만 줘도 호출했다). 호출됐는지는 모델의 말이 아니라 도구 호출 이벤트로 확인한다.

### Cursor 전용 기능

- `rename_chat`, `move_agent_to_root`, `GetDynamicTools`/`CallDynamicTool`은 Cursor에서만 있다. 다른 하네스에서는 건너뛴다.
- **Bugbot 선행 검토**는 Cursor 세션에서 first-party `bugbot` 서브에이전트를 쓸 수 있을 때만 의미가 있다. 다른 하네스에서는 이 단계를 건너뛰고 `reviewer`만 수행한다.

### Bugbot 선행 검토 카드

Review 단계 진입마다 `run-pipeline.mjs`가 bugbot 호출 카드를 남기고 종료코드 10으로 멈출 수 있다. 이 카드는 **Cursor 세션에서만** 실행한다. 카드에는 `model`을 넣지 않고 세션 기본 모델로 first-party `subagent_type: "bugbot"`을 호출한다.

- `description`: `"Bugbot"`
- `subagent_type`: `"bugbot"`
- `run_in_background`: `false`
- `prompt`(정확히 3줄):
  - `Full Repository Path: <repoRoot>`
  - `Diff: branch changes`
  - `Custom Instructions: atomic-workflow slug <slug>, review pass <n>. Spec: PLAN <planPath>, TASKS <tasksPath>. Report only concrete bugs in the branch changes.`
- 부모는 bugbot 결과를 `findingsPath`(`runs/.../bugbot-findings.md`)에 `# Bugbot findings — <slug> pass <n>` 헤더와 함께 저장하거나, 실패하거나 Cursor가 아니면 `# BUGBOT_FAILED` / `reason:` / `attempts:` 마커를 쓴 뒤 `--resume`한다.

예시(Cursor Task, `model` 생략):

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
    Custom Instructions: atomic-workflow slug my-slug, review pass 1. Spec: PLAN /path/PLAN-my-slug.md, TASKS /path/TASKS-my-slug.md. Report only concrete bugs in the branch changes.
```

### plan-reviewer (PLAN 비판 검토)

cost-gate 통과 후 tasker 전에 러너가 `plan-reviewer` 지침으로 공용 서브에이전트를 띄운다. task-card는 `role: "plan-reviewer"` 카드로 종료코드 10 후 부모가 호출 → `--resume`한다. planner 자동 수정 카드는 `role: "planner"`(revise 프롬프트). 상세 전이·종료코드는 [routing.md](routing.md) 「PLAN 비판 검토」를 따른다.

## 커맨드 입력

커맨드 스킬의 "입력"은 사용자가 `/atomic-<이름>` 스킬을 호출할 때 함께 보낸 메시지 텍스트다. 비어 있으면 각 커맨드 스킬이 정한 기본값을 쓴다.

## 스크립트 경로

문서의 `scripts/<파일>`(`work-status.mjs`, `run-done.mjs`, `memory.mjs` 등)은 **항상** 저장소 루트 기준:

`node .atomic/scripts/<파일>`

(개발 중 이 워크플로 패키지 자체에서는 루트 `scripts/<파일>`도 동일 내용이다. `node scripts/sync-bundled.mjs`로 `.atomic/scripts/`와 맞춘다.)

### work-status.mjs path (`docsDir`)

슬러그 문서 폴더: `node .atomic/scripts/work-status.mjs path <slug> [--repo <dir>]`. 절대 경로를 출력하고 없으면 만든다. 홈은 `ATOMIC_WORKFLOW_HOME`, 없으면 `~/.atomic-workflow`.

부모는 서브에이전트 브리프에 스킬 경로 다음 줄 `docsDir: <absolute>`를 **필수**로 넣는다. 자식은 `~/.atomic-workflow/...`를 쓰지 않고 `<docsDir>/PLAN-<slug>.md` 등만 쓴다. `cli-delegate`·런 로그는 `runsDir: <absolute>`(보통 `docsDir`의 `/docs/`→`/runs/`)도 넣는다.

### memory.mjs (승인형 볼트)

볼트 루트는 `ATOMIC_WORKFLOW_HOME`(없으면 `~/.atomic-workflow`)이다. 메모리 파일은 `<볼트>/memory/` 아래에 있다.

1. `node .atomic/scripts/memory.mjs repo <repoPath>` — `shortRepo` 식별자 출력 (보통 프로젝트 루트 `.`).
2. `node .atomic/scripts/memory.mjs context <shortRepo>` — 승인된 항목을 `<memory>` 블록으로 출력(없으면 `(주입할 메모리 없음)`).
3. 작업 종료 시 JSON 파일을 만들고 `node .atomic/scripts/memory.mjs propose --auto <file.json>` — 검증 통과 항목을 바로 저장한다.

`propose` JSON 형식 (`memory.mjs`가 검증):

```json
{
  "shortRepo": "<repo 명령 출력>",
  "slug": "<작업 슬러그>",
  "items": [
    { "target": "projects/<shortRepo>.md", "text": "한 줄, 200자 이하, 비밀 없음" }
  ]
}
```

`target`은 `human.md` 또는 `projects|decisions|gotchas/<name>.md`(`name`은 소문자·숫자·`_`·`-`, 최대 48자). 승인 대기만 큐에 넣을 때는 `propose <file.json>`(`--auto` 없음). `list`, `approve <id>`, `reject <id>`도 지원한다.

## 하네스 전용 도구

- Cursor: `rename_chat`, `move_agent_to_root`. 파이프라인 밖에서만 쓰지 말고, 워크트리를 만들었으면 즉시 `move_agent_to_root`로 옮긴다.
- 셸이 PowerShell(Windows)이면 heredoc 대신 here-string을 쓰고, CLI 위임은 [workers.md](../workers.md)의 PowerShell 경로를 쓴다.
