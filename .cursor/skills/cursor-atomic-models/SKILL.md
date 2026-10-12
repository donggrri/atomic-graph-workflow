---
name: cursor-atomic-models
description: "cursor-atomic-workflow 단계별 모델 설정을 안내한다. 사용자가 직접 호출할 때만 쓴다."
disable-model-invocation: true
---

# /cursor-atomic-models

이 안내는 **읽기 전용**이다. 파일을 고치지 말고, 아래 내용을 사용자에게 설명한다. 모델을 바꾸려면 `/cursor-atomic-config`를 안내한다.

## 단계별 에이전트

| 단계 | 에이전트 | 강제 스킬 | Task `model` |
|---|---|---|---|
| explore / recon | `explorer` | `cursor-atomic-workflow` | `claude-haiku-5-5-high` |
| plan | `planner` | `codebase-design` | `claude-sonnet-5-5-high` |
| plan-review | `plan-reviewer` | `codebase-design`, `tdd` | `composer-2.5` |
| task | `tasker` | `to-tickets` | `composer-2.5` |
| execute | `worker` | `tdd` | `composer-2.5` |
| test | `tester` | `tdd`, `codebase-design` | `claude-haiku-5-5-high` |
| review | `cursor-atomic-reviewer` | `code-review` | `claude-sonnet-5-5-high` |
| CLI 위임 | `cli-delegate` | `cursor-atomic-workflow` | `composer-2.5` |
| commit/status/config | (현재 세션) | — | — |

스킬에 모델을 붙이지 않는다. 모델은 에이전트 frontmatter와 Task 호출의 `model`에 붙는다. 표의 정본은 `scripts/lib/roles.mjs`다. 서브에이전트를 띄우는 법은 `cursor-atomic-workflow` 스킬의 `references/harness.md`를 따른다.

## Cursor

- 프로젝트의 `.cursor/agents/<에이전트>.md` frontmatter `model`을 바꾼다.
- 설치할 때 고정하려면 `node scripts/install.mjs --target <프로젝트> --set-model <agent>=<model>`을 쓴다.
- 지정 모델이 실패하면 그 호출은 멈추고, 세션에 있는 모델 목록을 보고한다. 즉석에서 다른 모델로 바꾸지 않는다.
