---
name: cursor-atomic-config
description: "cursor-atomic-workflow 설정(작업 홈, 에이전트 모델)을 조회하고 변경한다. 사용자가 직접 호출할 때만 쓴다."
---

# /cursor-atomic-config

입력: `show`, `home`, `home <경로>`, 또는 `<agent> <model>`. 비어 있으면 `show`.

`.atomic/scripts/work-status.mjs`의 `getWorkflowRoot`와 `.cursor/agents/*.md` frontmatter를 따른다. 서브에이전트를 띄우는 법은 `cursor-atomic-workflow`의 `references/harness.md`를 따른다.

## 작업 홈

적용 우선순위:

1. 환경 변수 `CURSOR_ATOMIC_WORKFLOW_HOME`
2. `${XDG_CONFIG_HOME:-~/.config}/cursor-atomic-workflow/config.json`의 `home`
3. 기본값 `~/.cursor-atomic-workflow`

`home` 값의 선행 `~`는 사용자 홈으로 확장한다.

- `show`: 지금 적용 중인 경로와, 위 세 단계 중 어디에서 결정됐는지 보여 준다.
- `home`: 설정 파일 내용과 적용 중인 경로를 보여 준다. 환경 변수가 있으면 설정 파일보다 우선한다고 적는다.
- `home <경로>`: 그 설정 파일에 `{ "home": "<경로>" }`를 저장한다. 다른 키는 유지한다. 디렉터리는 만들지 않고 경로만 기록한다. 저장 전에 JSON이 유효한지 확인한다.

## Cursor 모델

1. 현재 프로젝트 `.cursor/agents/`를 읽고 에이전트별 `model` frontmatter를 표로 보여 준다. 대상은 `explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `cursor-atomic-reviewer`, `tester`, `cli-delegate`다. `model`이 없거나 `inherit`이면 세션 모델을 따른다고 적는다.
2. `<agent> <model>`이면 그 파일의 `model` frontmatter만 바꾼다. 본문은 고치지 않는다.
3. `node scripts/install.mjs --target <프로젝트> --force`는 이 변경을 덮어쓴다. 설치할 때 고정하려면 `--set-model <agent>=<model>`을 쓴다.

한국어로 명확하게 결과를 보고한다.
