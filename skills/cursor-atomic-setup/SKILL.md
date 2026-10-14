---
name: cursor-atomic-setup
description: "설치 후 저장소별 atomic-graph-workflow 설정(AGY 단계, 테스트 명령, gitignore, 메모리 hook)을 `.cursor-atomic-workflow.json`에 저장한다. 사용자가 직접 호출할 때만 쓴다."
---

# /atomic-setup

설치 직후 한 번 실행한다. 대화로 저장소 설정을 정리하고 `.cursor-atomic-workflow.json`을 쓴다.

## 절차

1. `node .atomic/scripts/project-setup.mjs --target .` 를 실행할 수 있으면 비대화형으로 먼저 돌리지 말고, 아래 항목을 대화로 확인한다.
2. **AGY 단계 정책** (`agy.plan` / `agy.implement` / `agy.review`): 각각 `ask` | `sdk` | `agy`. 화면에는 「물어보기 / Cursor SDK / AGY 위임」으로 설명하고, `agy` 선택 시 무승인 CLI 경고를 한 줄 넣는다. 추천: plan=`sdk`, implement=`ask`, review=`ask`.
3. **AGY 모델** (`agyModel`): `agy models` 슬러그. 비우면 agy 기본. `invoke-worker`가 프로젝트 설정을 읽는다.
4. **완료 명령** (`testDone`): `package.json`의 `scripts.test` → `npm test`, 없으면 Makefile/pyproject 등을 보고 제안. `profiles`의 `test.done`보다 프로젝트 키가 우선한다.
5. **git**: `.atomic/`, `.agents/skills/`, 하네스 생성 파일을 팀과 공유할지 묻는다. 공유 시 `output.log*`만 `.gitignore`에 추가하는 것을 제안한다 (`runs/`는 workflowHome 아래).
6. **memory sweep hook**: Cursor 전용, 기본 끔. 켜면 `memorySweepHook: true`만 저장(자동 설치는 아직 없음).
7. **단계별 executor** (`executors`): `lite`, `explore`, `plan`, `plan-review`, `task`, `execute`, `review`, `wrapup`, `memory` 각각에 `cursor-subagent` | `cursor-agent` | `cursor-sdk` | `agy` | `codex` | `opencode` | `pi` | `claude`. 값은 문자열 또는 `{ "executor": "agy", "model": "…" }`. 기본은 `.atomic/graph.yaml`의 `executor` 필드와 파이프라인 adapter(`sdk`→`cursor-sdk`, `task-card`→`cursor-subagent`). `cursor-sdk`는 `@cursor/sdk` import 가능할 때만 사용 가능(doctor·런타임 fallback). CLI executor(`agy`·`codex` 등)는 첫 선택 시 위험 플래그를 확인하고 `trustedExecutors`에 저장할 수 있다(또는 TTY에서 `invoke-worker` 신뢰). `agy.plan`/`implement`/`review`가 `agy`이고 해당 단계에 명시 `executors`가 없으면 위 매핑으로 executor가 `agy`로 채워진다(명시 설정이 우선).
8. **타임아웃** (`executorTimeouts`, 선택): 단계 id → 분(기본 45). `pi`·외부 CLI는 `run-stage.mjs`·파이프라인·`memory-sweep`에서 동일하게 적용된다.
9. 설정 JSON을 저장한 뒤 `node .atomic/scripts/doctor.mjs --harness auto --target .` 를 실행하고 결과를 보고한다.

## 스크립트

대화 없이 자동화할 때:

```bash
node .atomic/scripts/project-setup.mjs --target .
```

한국어로 결과를 요약한다.

하네스별 스크립트·서브에이전트 경로는 `cursor-atomic-workflow` 스킬의 [references/harness.md](../cursor-atomic-workflow/references/harness.md)를 따른다.
