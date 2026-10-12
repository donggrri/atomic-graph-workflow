# cursor-atomic-workflow 모델

SKILL.md를 먼저 읽는다. 위임할 모델이 필요할 때만 연다.

## Cursor Task 모델

Cursor는 에이전트 frontmatter를 호출에 자동으로 넣지 않으므로, 부모가 Task `model`에 아래 슬러그를 넣는다. 정본은 `scripts/lib/roles.mjs`의 `ROLES`다. `.cursor/agents/*.md` frontmatter와 이 표는 같다.

| 역할 | subagent_type | model |
|---|---|---|
| explorer | `explorer` | `claude-haiku-5-5-high` |
| planner | `planner` | `claude-sonnet-5-5-high` |
| plan-reviewer | `plan-reviewer` | `composer-2.5` |
| tasker | `tasker` | `composer-2.5` |
| worker | `worker` | `composer-2.5` |
| reviewer | `cursor-atomic-reviewer` | `claude-sonnet-5-5-high` |
| tester | `tester` | `claude-haiku-5-5-high` |
| cli-delegate | `cli-delegate` | `composer-2.5` |

세션 `available_subagent_models`에 슬러그가 없으면 그 호출은 멈추고 목록을 보고한다. `inherit`로 부모 모델을 쓰지 않는다.

**예외 — bugbot 선행 검토:** 파이프라인 Review 진입 시 `subagent_type: "bugbot"` Task는 위 표·`ROLES`에 없다. 카드에 `model`을 두지 않고 **세션 기본 모델**로 호출한다(`references/harness.md` 「Bugbot 선행 검토 카드」).

## 단계 기본값

스킬에는 모델이 없다. 단계마다 **에이전트**를 띄워야 모델이 갈린다. 그 에이전트가 스킬을 읽는다.

| 단계 | 에이전트 | 강제 스킬 |
|---|---|---|
| explore / recon | `explorer` | `cursor-atomic-workflow` |
| plan | `planner` | `cursor-atomic-workflow`, `codebase-design` |
| plan-review | `plan-reviewer` | `cursor-atomic-workflow`, `codebase-design`, `tdd` |
| task | `tasker` | `cursor-atomic-workflow`, `to-tickets` |
| execute | `worker` | `cursor-atomic-workflow`, `tdd` |
| review | `reviewer` | `cursor-atomic-workflow`, `code-review` |
| commit/status/config | parent | (없음, 현재 세션 모델) |

지정 모델이 실패하면 그 오류를 보고하고 멈춘다. 부모가 모델을 즉석에서 추측해 바꾸지 않는다.
