---
name: atomic-doctor
description: "atomic-workflow 환경 진단(스킬 충돌, YAML 문법, 설정 필터, 하네스 동기화) 및 자동 교정을 수행한다. 사용자가 직접 호출할 때만 쓴다."
---

# /atomic-doctor

입력: `check` 또는 `fix`. 비어 있으면 `check`로 본다.

`atomic-workflow` 환경 진단 도구를 실행하여 스킬 충돌, YAML frontmatter 문법 오류, 설정 상태, 하네스 파일 동기화를 점검하고 필요시 자동 교정한다. 설치된 프로젝트에서는 `node .atomic/scripts/doctor.mjs`를 쓴다(이 패키지 개발 중에는 루트 `scripts/doctor.mjs`도 동일).

동작 규칙:
1. 입력이 `fix`이거나 사용자가 교정/치료/해결을 요청한 경우:
   - `node .atomic/scripts/doctor.mjs --fix`를 실행하여 스킬 충돌 완화(settings.json 패키지 필터 적용), YAML 문법 교정, 하네스 생성 파일 재생성을 수행한다.
2. 그 외(기본 `check`):
   - `node .atomic/scripts/doctor.mjs`를 실행하여 현재 환경의 충돌 여부 및 구문 상태를 진단한다.
3. 진단 결과 요약:
   - 전역 스킬 디렉터리(`~/.agents/skills/`)와의 충돌 여부 및 패키지 필터 적용 상태
   - 스킬 frontmatter(`SKILL.md`) YAML 문법 에러(unquoted colon 등) 유무
   - 하네스 생성 파일 드리프트와 설치 상태, 레거시 `.cursor/commands/` 잔존 여부
   - 적용된 자동 교정 내역
4. Cursor 세션이면 파일 설치만으로 통과시키지 않는다. `available_subagent_types`에 `explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `atomic-reviewer`, `tester`, `cli-delegate`가 있는지 대조한다. 하나라도 없으면 진단 실패다. `reviewer`만 있고 `atomic-reviewer`가 없으면 옛 설치다. `node .atomic/scripts/install.mjs --harness cursor --target <프로젝트> --force` 뒤 새 세션이 필요하다.
5. 한국어로 친절하고 명확하게 진단 및 교정 결과를 보고한다.
