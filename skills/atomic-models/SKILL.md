---
name: atomic-models
description: "atomic-workflow 단계별 역할과 모델 정책을 안내한다. 사용자가 직접 호출할 때만 쓴다."
---

# /atomic-models

이 안내는 **읽기 전용**이다. 파일을 고치지 말고, 아래 내용을 사용자에게 설명한다.

## 모델 정책

워크플로는 모델을 지정하지 않는다. 서브에이전트, `cursor-agent`·`agy` 같은 외부 CLI, 부모 세션 모두 해당 하네스(CLI)의 기본 모델을 쓴다. 모델을 바꾸려면 그 하네스의 설정에서 바꾼다. `install.mjs --set-model`, `invoke-worker --model`, 저장소 설정의 `agyModel`·`executors.*.model`은 더 이상 쓰지 않는다(설정 값은 무시되고 경고만 나온다).

## 단계별 역할

| 단계 | 역할 지침 | 강제 스킬 |
|---|---|---|
| explore / recon | `explorer` | `atomic-workflow` |
| plan | `planner` | `codebase-design`, `domain-modeling`, `grilling`, `wayfinder` |
| plan-review | `plan-reviewer` | `codebase-design`, `tdd` |
| task | `tasker` | `to-tickets` |
| execute | `worker` | `tdd` |
| test | `tester` | `tdd`, `codebase-design` |
| review | `atomic-reviewer` | `code-review` |
| CLI 위임 | `cli-delegate` | `atomic-workflow` |
| commit/status/config | (현재 세션) | — |

모든 단계는 같은 공용 서브에이전트가 역할 지침(`.atomic/agents/<subagentType>.md`)을 프롬프트로 받아 수행한다. 논리 역할 `reviewer`는 `atomic-reviewer.md`로 매핑된다. 호출 방법은 `atomic-workflow` 스킬의 `references/harness.md`를 따른다.
