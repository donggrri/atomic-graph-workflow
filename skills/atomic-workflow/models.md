# atomic-workflow 단계와 역할

SKILL.md를 먼저 읽는다. 단계별로 누가 무엇을 하는지 확인할 때만 연다.

## 모델은 워크플로가 정하지 않는다

워크플로는 어떤 단계에도 모델을 지정하지 않는다. 서브에이전트·외부 CLI·부모 세션 모두 **하네스(또는 CLI)의 기본 모델**을 쓴다. 모델을 바꾸려면 해당 하네스 설정에서 바꾼다. 서브에이전트 호출에 `model` 인자를 넣지 않는다. 세션이나 CLI에 없는 모델을 즉석에서 추측해 넣지도 않는다.

독립 검토는 **모델 계열이 다른 것**이 아니라 **새 컨텍스트와 증거(PLAN·TASKS·diff·테스트)** 로 보장한다. reviewer는 worker의 대화를 이어받지 않고 산출물만 읽는다.

## 공용 서브에이전트

모든 단계는 같은 공용 서브에이전트로 실행한다. 역할 지침은 `.atomic/agents/<subagentType>.md`이고, 부모가 호출 프롬프트에 그 경로와 강제 스킬, `docsDir`, 산출물 파일명, 하지 않을 것을 넣는다. 서브에이전트가 없는 하네스는 부모 세션이 같은 지침을 순서대로 수행한다.

## 단계 기본값

| 단계 | 역할 지침 | 강제 스킬 |
|---|---|---|
| explore / recon | `explorer` | `atomic-workflow` |
| plan | `planner` | `atomic-workflow`, `codebase-design`, `domain-modeling`, `grilling`, `wayfinder` |
| plan-review | `plan-reviewer` | `atomic-workflow`, `codebase-design`, `tdd` |
| task | `tasker` | `atomic-workflow`, `to-tickets` |
| execute | `worker` | `atomic-workflow`, `tdd` |
| review | `reviewer` (`atomic-reviewer`) | `atomic-workflow`, `code-review` |
| test | `tester` | `atomic-workflow`, `tdd`, `codebase-design` |
| CLI 위임 | `cli-delegate` | `atomic-workflow` |
| commit/status/config | parent | (없음, 현재 세션) |
