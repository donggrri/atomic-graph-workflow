---
name: cursor-atomic-agy
description: "agy(Antigravity CLI)를 헤드리스로 호출해 사용자 요청을 delegate 한다. plan 모드는 계획 문서만, implement 모드는 코드 생성. cli-delegate와 invoke-worker --worker agy만 쓴다. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-agy

사용자 요청(계획 또는 코드 생성)을 Task `cli-delegate`와 `invoke-worker --worker agy`로만 위임한다. 이 스킬은 파이프라인 단계가 아니다. TASKS 항목만 위임할 때는 `/cursor-atomic-delegate`도 가능하다.

`cursor-atomic-workflow` 스킬과 그 디렉터리의 `workers.md`를 읽는다. 서브에이전트 호출은 `references/harness.md` 「Cursor 호출 카드」를 따른다. 부모는 CLI를 직접 띄우지 않는다. bare `agy`를 실행하지 않는다. 줄 전체가 `agy`인 명령도 두지 않는다. agy CLI 플래그를 새로 만들지 않는다. `invoke-worker`에만 `--worker`, `--workspace`, `--prompt-file`, `--log-file`, `--timeout-min`, `--model`, `--skills`와 env `CURSOR_ATOMIC_SKILL_ROOT`(·선택 `CURSOR_ATOMIC_AGY_MODEL`)를 넘긴다.

`agy`의 `--print-timeout`은 반드시 `45m0s` 같은 **단위가 있는 duration**이다. 숫자만 넣으면 CLI가 즉시 실패한다. 부모는 timeout을 직접 만들지 말고 `invoke-worker`의 `--timeout-min`(기본 45)만 쓴다.

## 입력

```
/cursor-atomic-agy plan [model=<agy-slug>] [out=<경로>] <요청>
/cursor-atomic-agy implement [model=<agy-slug>] [격리] <요청>
/cursor-atomic-agy execute [model=<agy-slug>]
/cursor-atomic-agy 다음 진행해
```

첫 토큰이 `plan`, `implement`, `execute`이면 아래 모드로 바로 위임한다(execute는 「TASKS execute」). 요청 본문이 비면 멈춘다. 추측하지 않는다.

`model=<값>`은 **agy CLI 모델 슬러그**다(`agy models`로 확인). 별칭: `gemini-3.8-flash`·`gemini-3.8-flash-medium` → `gemini-3.8-flash-high`. `invoke-worker.sh`의 `resolve-agy-model.mjs`가 정규화한다. 미지정이면 agy 기본 모델.

입력이 `다음 진행해`, `다음 진행`, `이어서`, `계속`, `continue`, `next` 중 하나이면 「이어하기」를 따른다. 그 외이거나 입력이 비면 사용법만 보여 주고 멈춘다.

## execute (TASKS Phase 3)

`execute`는 활성 워크플로 슬러그의 **다음 열린 TASKS 항목 하나**를 implement로 agy에 넘긴다. 판별은 「이어하기」와 같다(`work-status.mjs list` → 단일 진행 중 슬러그).

- 브리프: `~/.cursor-atomic-workflow/runs/{shortRepo}/<workflow-slug>/<task-id>.brief.md`
- 로그: `~/.cursor-atomic-workflow/runs/{shortRepo}/<workflow-slug>/<task-id>.log`
- 브리프 내용은 해당 항목의 제목·`files`·`done`·PLAN 비목표 요약(`workers.md` 템플릿).
- `cli-delegate` 프롬프트 첫 줄은 `cursor-atomic-workflow` 스킬 절대 경로. 이어서 `요청 위임: /cursor-atomic-agy execute (TASKS 항목: <id>)`, `worker: agy`, 브리프·로그·작업공간, `--skills cursor-atomic-workflow,tdd`, `CURSOR_ATOMIC_SKILL_ROOT`, `--timeout-min 45`, 지정 시 `--model <정규화된 슬러그>`.
- 돌아온 뒤 부모가 `run-done.mjs`로 `done`을 재실행하고 통과할 때만 `[x]`.

한 번에 **한 항목**만 위임한다. 여러 항목을 자동 연속 실행하지 않는다.

## 이어하기

상태를 바꾸지 않는다. `node .atomic/scripts/work-status.mjs list`로 현재 저장소와 `repo`가 같은 슬러그만 본다. 진행 중(`phase`가 `complete`가 아님)인 것이 하나면 그 슬러그다. 없으면 「활성 워크플로 없음」이라고 말하고 멈춘다. 둘 이상이면 슬러그를 고르는 질문만 하고, 답을 받기 전에 위임하지 않는다.

고른 슬러그의 `TASKS-<slug>.md`와 `PLAN-<slug>.md`를 `show`가 가리키는 문서 디렉터리에서 읽는다. 다음 단계 하나만 정한다.

- 의존이 끝난 열린 항목(체크되지 않음)이 있으면 파일 순서의 첫 항목. `막힘:`이 있으면 그 항목을 재시도로 본다. 모드는 `implement`. 브리프 요청은 그 항목의 제목, `files`, `done`이다. 브리프·로그 경로는 **execute**와 같이 `runs/<workflow-slug>/<task-id>.*`를 쓴다.
- TASKS도 PLAN도 없으면 모드는 `plan`. 대화나 STATUS에 목표가 있을 때만 그 문장을 요청으로 쓴다. 목표가 없으면 위임하지 않고 목표를 한 줄 묻는다.
- PLAN만 있고 TASKS가 없으면 태스크 분할이다. 리뷰·테스트·커밋도 같다. agy에 넘기지 않는다. 어디까지 왔는지와 다음 커맨드만 말하고 멈춘다.

위임할 단계가 있을 때만 한 번 묻는다. 예/아니오를 고르게 하고, 답을 받기 전에 위임하지 않는다.

```
지금은 <슬러그> <phase>까지 진행했습니다. 다음 단계(<항목 또는 계획>)를 agy에게 위임할까요?
```

- 아니오: 멈춘다.
- 예: 정한 모드의 기존 위임 절차를 그 한 단계에만 쓴다. 뒤 단계는 자동으로 넘기지 않는다. `work-status.mjs sync`는 호출하지 않는다.

- `out=<경로>`는 plan 전용이다. 없으면 `<작업공간>/.cursor/plans/agy-<짧은슬러그>.md`. 짧은슬러그는 요청에서 만든 ASCII kebab-case다.
- plan·단발 implement(요청 문자열) 브리프·로그: `~/.cursor-atomic-workflow/runs/{shortRepo}/agy-<짧은슬러그>/plan.brief.md` 또는 `implement.brief.md` / 같은 디렉터리의 `plan.log`·`implement.log`.
- `out=`이 작업공간 밖이면 agy는 작업공간 안의 기본 경로에 쓰고, 검증 통과 후 부모가 지정 경로로 복사한다.
- `격리`는 implement 전용이다. 있으면 `reference.md` 「워크트리」대로 `../<repo>-agy-<짧은슬러그>`, 브랜치 `feat/agy-<짧은슬러그>`를 만들고 그 경로를 작업공간으로 쓴다. 없으면 현재 작업공간이다.
- 요청 본문이 비면 멈춘다.

plan 산출물은 워크플로 PLAN 홈(`~/.cursor-atomic-workflow/docs/...`)에 쓰지 않는다.

## 사전 확인

1. `git status --porcelain` 결과를 스냅샷으로 보관한다. 작업공간이 git이 아니면 그 사실을 말하고, plan의 소스 변경 검사는 파일 목록 비교로 대신한다.
2. 세션 `available_subagent_types`에 `cli-delegate`가 없으면 멈추고 설치 상태를 보고한다. Task `worker` 등 다른 타입으로 바꾸지 않는다.

## 브리프

`workers.md` 「브리프 (CLI worker 공통)」를 재사용한다. 경로는 위 **execute** / **plan·단발** 규칙을 따른다.

공통: 역할 `cursor-atomic-workflow 위임 워커 (CLI: agy, /cursor-atomic-agy <mode>)`, 작업공간 절대 경로, 요청 원문, 하지 말 것(`git commit`, `git push`, 범위 확대, 비밀 파일, `.env`, PLAN/TASKS 삭제, **cmake/ctest/npm test 등 완료 조건·빌드·테스트 실행**), 끝나면 변경 파일·(소스 편집 외) 실행한 명령·실패 errorTail 요약·남은 위험·로그 경로. **agy는 소스 수정만.** cmake/ctest/npm test 등 완료 조건 명령은 실행하지 않음. 부모가 invoke 종료 후 `run-done.mjs`로 검증.

MUST read 블록에는 절대 경로를 직접 적는다.

- **plan**: MUST read는 `cursor-atomic-workflow`만. `산출물: <plan 경로>`. 이 파일 하나만 생성·수정한다. 제품 소스·테스트·설정 수정 금지. 코드 블록은 문서 안 예시로만. 완료 조건은 산출물 파일 존재와 그 외 변경 없음.
- **implement**·**execute**: MUST read는 `cursor-atomic-workflow` (필수). `tdd`는 **선택** — 설계·red 테스트 작성 참고용으로만 읽고, **invoke 세션에서 테스트·빌드 명령을 실행하지 않는다**. 요청에서 파일을 알 수 있으면 `파일:`에 적는다. `부모 검증용 (agy는 실행하지 않음):`에 TASKS `done` 셸을 **참고용으로만** 적는다(부모가 `invoke-worker` 종료 후 `node .atomic/scripts/run-done.mjs`로 실행). 브리프에 **FORBID** 블록을 넣는다: `cmake`, `ctest`, `npm test`, `make`, 항목 `done` 셸, 그 밖의 완료 조건 검증 명령 실행 금지. agy는 **소스·테스트 파일 수정만** 한다.

브리프에 비밀·토큰·`.env` 내용을 넣지 않는다.

invoke-worker는 agy를 항상 `--mode accept-edits --dangerously-skip-permissions`와 `--print-timeout <timeout-min>m0s`로 띄운다. plan의 소스 수정 금지는 프롬프트로만 강제되고, 부모가 porcelain 비교로 사후에 탐지한다.

## Task `cli-delegate`

백그라운드로 띄운다. model은 `composer-2.5` (`references/harness.md` 표). 세션 `available_subagent_models`에 그 슬러그가 없으면 멈추고 목록을 보고한다. `inherit`로 바꾸지 않는다. (Task `model`은 **cli-delegate 래퍼**용이며, agy 작업 모델은 `invoke-worker --model`이다.)

프롬프트 첫 줄은 `cursor-atomic-workflow` 스킬 절대 경로. 이어서:

- `요청 위임: /cursor-atomic-agy <mode> …` (execute·이어하기 TASKS면 `(TASKS 항목: <id>)` 포함)
- `worker: agy`, 브리프 경로, 로그 경로, 작업공간 절대 경로
- `--skills`: plan은 `cursor-atomic-workflow`, implement·execute는 `cursor-atomic-workflow,tdd`
- `CURSOR_ATOMIC_SKILL_ROOT=<해석한 cursor-atomic-workflow 스킬 디렉터리>`
- `--timeout-min` 기본 45
- 사용자가 `model=`을 주었으면 `invoke-worker`에 `--model <정규화된 슬러그>` 전달 (또는 env `CURSOR_ATOMIC_AGY_MODEL`)

`cli-delegate`는 **반드시** `invoke-worker.sh`(bash) 또는 `invoke-worker.ps1`(Windows)만 실행한다.

`invoke-worker`는 작업공간 루트의 `bash .atomic/scripts/invoke-worker.sh` (Windows: `pwsh -File .atomic/scripts/invoke-worker.ps1`)만 쓴다.

## 돌아온 뒤

자식의 완료 문장은 증거가 아니다.

1. 로그의 `exit=`을 확인한다.
2. `git status --porcelain`을 스냅샷과 비교하고 `git diff`를 본다.
3. **plan**: 새로 생기거나 바뀐 경로가 산출물 하나뿐이어야 한다. `.cursor/plans/`는 미추적일 수 있으므로 `git diff`만으로 판단하지 않는다. 다른 변경이 있으면 실패로 보고하고 목록을 보여 준다. `git checkout`이나 삭제로 되돌리지 않고 사용자에게 묻는다. 산출물이 없거나 비면 실패다. 작업공간 밖 `out=`이면 검증 통과 후에만 복사한다.
4. **implement**·**execute**: 변경 파일을 확인하고, 완료 조건 명령을 부모가 `node .atomic/scripts/run-done.mjs`로 재실행해 `.done.json`을 확인한다. 실패면 errorTail 요약과 로그 경로를 보고한다.

`work-status.mjs sync`는 호출하지 않는다. 이어하기의 `list`/`show`는 읽기만 한다. 커밋·푸시하지 않는다. 커밋이 필요하면 `/cursor-atomic-wrapup` 또는 사용자 지시를 안내한다.

## 보고

한국어로 모드, 산출물 또는 변경 파일, 검증 결과, 로그 경로를 보고한다.
