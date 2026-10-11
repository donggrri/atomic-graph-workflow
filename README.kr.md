[English](README.md) | 한국어

# cursor-atomic-workflow

표시 이름은 Cursor SDK workflow(`cursor-sdk`)다. 기술 식별자는 `cursor-atomic-*`다.

Cursor용 atomic explore → plan → task → execute → review 워크플로 (SDK 러너 + Task 서브에이전트).
`/cursor-atomic-explore`(선택) → `/cursor-atomic-plan` → `/cursor-atomic-task` → `/cursor-atomic-execute` → `/cursor-atomic-review` → `/cursor-atomic-wrapup`

슬래시 커맨드는 upstream 워크플로의 `cursor-atomic-` 접두사를 유지하지만, 패키지 자체는 **Cursor 전용**이다.

---

## 목차

1. [패키지가 설치하는 것](#1-패키지가-설치하는-것)
2. [프로젝트에 설치](#2-프로젝트에-설치)
3. [사용법](#3-사용법)
4. [자동 파이프라인 러너](#4-자동-파이프라인-러너)
5. [단계별 모델](#5-단계별-모델)
6. [하지 말 것](#6-하지-말-것)
7. [번들된 업스트림 스킬](#7-번들된-업스트림-스킬)
8. [패키지 유지보수](#8-패키지-유지보수)
9. [추후 과제](#9-추후-과제)

---

## 1. 패키지가 설치하는 것

모두 대상 Cursor 프로젝트에 설치된다:

| 구성 요소 | 위치 | 역할 |
|---|---|---|
| 커맨드 스킬 | `.cursor/skills/cursor-atomic-<이름>/SKILL.md` | 하나하나가 슬래시 커맨드(`/cursor-atomic-plan` 등)이며 커맨드 로직을 담는다 |
| 워크플로 스킬 | `.cursor/skills/cursor-atomic-workflow/` | 오케스트레이션 문서(`CONTEXT.md`, `reference.md`, `workers.md`, `testing.md`, `models.md`), Cursor 하네스 어댑터(`references/harness.md`), `work-status.mjs` / `run-done.mjs` 번들 복사본 |
| 서브에이전트 | `.cursor/agents/*.md` | 에이전트 8종: `explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `cursor-atomic-reviewer`, `tester`, `cli-delegate` |
| 라우터 규칙 | `.cursor/rules/atomic-router.mdc` | 메인 채팅 alwaysApply: 슬래시 없을 때 **lite** vs **full** 자동 판정 |
| 러너 스크립트 | `scripts/` | `install.mjs`, `run-pipeline.mjs`, `doctor.mjs`, `check-agents.mjs`, `work-status.mjs`, `run-done.mjs`, `lib/` |

Node `>=22.13` 필요. `@cursor/sdk`는 패키지 루트의 optional dependency로 파이프라인 러너의 SDK 어댑터를 구동한다.

번들 snapshot의 원본 저장소, revision, MIT 라이선스는 `THIRD_PARTY_LICENSES/mattpocock-skills-*`에 기록되어 있다.

---

## 2. 프로젝트에 설치

이 저장소(또는 설치된 npm 패키지 디렉터리)에서 실행한다:

```bash
node scripts/install.mjs --target /path/to/project
```

| 옵션 | 의미 |
|---|---|
| `--target <dir>` | 설치 대상 프로젝트 (기본: 현재 디렉터리) |
| `--skills-dir <path>` | 스킬 복사 위치 (기본: `.cursor/skills`) |
| `--force` | 기존 파일 덮어쓰기 (없으면 유지) |
| `--set-model <agent>=<model>` | 에이전트 frontmatter에 단계 모델 고정 (여러 번 가능) |
| `--no-skills` / `--no-agents` / `--no-rules` | 구성 요소 건너뛰기 |
| `-h, --help` | 도움말 |

```bash
# 기존 설치 위에 재설치하면서 모델 고정
node scripts/install.mjs --target /path/to/project --force --set-model worker=composer-2.5
```

예전 설치가 남긴 `.cursor/commands/cursor-atomic-*.md`가 있으면 지운다. 이제 커맨드 스킬이 같은 슬래시 커맨드를 제공하므로, 둘 다 두면 커맨드가 두 번씩 보인다. 설치 스크립트와 `doctor`가 해당 파일을 알려 준다.

설치 상태는 언제든 확인할 수 있다:

```bash
node scripts/doctor.mjs        # 스킬 충돌, YAML frontmatter, 번들 스크립트 동기화, 설치 상태 (--fix로 자동 교정)
node scripts/check-agents.mjs  # .cursor/agents 모델이 scripts/lib/roles.mjs와 일치하는지 검사
```

---

## 3. 사용법

### Lite vs 전체 워크플로

| | `/cursor-atomic-lite` | 전체 `/cursor-atomic-*` 파이프라인 |
|---|---|---|
| 세션 | 부모 한 세션, **서브에이전트 없음** | explore → plan-review → task → worker → reviewer → tester (Task 또는 SDK 러너) |
| 적합 | 작고 범위가 분명한 변경(보통 **파일 5개 미만**), 스키마·인증·보안 작업 없음 | 다파일 리팩터, DB 마이그레이션, 보안, 큰 계획, 병렬 워커 |
| 산출물 | 짧은 `PLAN-<slug>.md`만 (동일 전역 docs 홈) | EXPLORE, PLAN, PLAN-REVIEW, TASKS, REVIEW, evidence |
| 메모리 | 시작 시 `memory.mjs context`, 끝에 `propose --auto` | 같은 볼트; `memory-curator`·파이프라인 캡처 선택 |
| 마무리 | PLAN 완료 기준 대비 테스트·짧은 요약 | `/cursor-atomic-wrapup`으로 커밋 + STATUS |

lite에서 **파일 5개 이상**, **DB/스키마**, **인증·보안**, 계획이 짧은 목록을 넘어가면 멈추고 `/cursor-atomic-plan` 또는 `/cursor-atomic-run`으로 전환한다.

**메인 채팅(슬래시 없음):** `install.mjs`가 `.cursor/rules/atomic-router.mdc`를 복사한다(`alwaysApply`). 에이전트가 동일 신호(모듈 간 설계·요구 불명확 → full, 작고 국소·명확 → lite)로 판정하고 `라우팅: lite|full (이유: …)` 한 줄을 남긴다. `/cursor-atomic-*` 명시 시 그 모드가 우선. 상세: 워크플로 스킬 「메인 채팅 라우팅」, `references/routing.md`.

기본(전체): **PLAN만 확정하면** 러너가 **plan-review**(PLAN 비판 검토) → task → execute → review를 자동 실행한다. 커밋은 `/cursor-atomic-wrapup`일 때만.

| 커맨드 | 역할 | 산출물 |
|---|---|---|
| `/cursor-atomic-lite` | 단일 세션: 짧은 PLAN → 구현 → 메모리 → 테스트 마무리 (서브에이전트 없음) | `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md` |
| `/cursor-atomic-explore` | Phase 0: 코드베이스 및 기술 사전 탐색 (선택) | `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/EXPLORE-<slug>.md` (레거시: `.docs/<slug>/`) |
| `/cursor-atomic-plan` | Phase 1 후 기본 파이프라인 | `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md` + 자동으로 TASKS/코드/REVIEW |
| `/cursor-atomic-task` | Phase 2만 강제하거나 이어서 자동 | `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/TASKS-<slug>.md` |
| `/cursor-atomic-execute` | Phase 3만 강제하거나 이어서 자동 | 코드 변경 + 체크된 TASKS |
| `/cursor-atomic-delegate` | Phase 3: 특정 워커에 위임 | 같음 |
| `/cursor-atomic-agy` | 사용자 요청을 agy 헤드리스로 위임 (plan: 계획 문서만, implement: 코드 생성) | .cursor/plans/ 계획 파일 또는 코드 변경 |
| `/cursor-atomic-review` | Phase 4 | `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/REVIEW-<slug>.md` |
| `/cursor-atomic-wrapup` | Phase 5: 마무리 (커밋, 푸시 없음) | git commit + STATUS |
| `/cursor-atomic-run` | 명시적 파이프라인 진입: 트리아지를 건너뛰고 explore부터 실행 | plan과 같음 |
| `/cursor-atomic-status` | 진행 상황 보고 (`npm run status` / `STATUS.json`) | 텍스트 요약 / 테이블 |
| `/cursor-atomic-config` | 워크플로 모델/스킬 설정 관리 (`/cursor-atomic-settings`) | 텍스트/대화형 설정 |
| `/cursor-atomic-models` | 모델 설정 안내 (읽기 전용) | 텍스트 안내 |
| `/cursor-atomic-doctor` | 스킬 충돌, YAML frontmatter 문법 진단 및 자동 교정(Auto-fix) | 진단 리포트 / 자동 교정 |

산출물은 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/` 아래에 쌓인다 (`CURSOR_ATOMIC_WORKFLOW_HOME`으로 홈을 바꿀 수 있다).

PLAN에 막힌 질문(보안·범위·데이터 손실)이 있으면 거기서 멈춘다. 계획만 쓰려면 `/cursor-atomic-plan 계획만`.

---

## 4. 자동 파이프라인 러너

`scripts/run-pipeline.mjs`는 대화 세션 대신 단계를 headless로 실행한다:

```bash
node scripts/run-pipeline.mjs <slug> [--auto] [--resume] [--adapter sdk|task-card] [--profile <id>] [--repo <dir>] [--dry-run]
```

- `--adapter sdk`(기본)는 `@cursor/sdk`로 Cursor Task 서브에이전트를 구동한다. SDK가 없으면 `--adapter task-card`로 떨어져 종료코드 `10`으로 멈추고, 부모 세션이 실행할 `next-card.json`을 남긴다. 이후 `--resume`한다. cost-gate 뒤 **plan-review**가 `plan-reviewer`를 실행해 `PLAN-REVIEW-<slug>.md`를 쓰고, 차단 결함은 planner 1회 자동 수정·재검토 후에도 남으면 종료코드 `20`으로 멈춘다. **Review** 진입(초기·재작업 후)마다 종료코드 `10`이 **`kind: "bugbot"`** 선행 검토 카드일 수 있다. 부모가 Cursor `bugbot`을 실행하고 `~/.cursor-atomic-workflow/runs/{shortRepo}/{slug}/bugbot-findings.md`에 결과를 저장(실패 시 `# BUGBOT_FAILED` 마커)한 뒤 `--resume`하고 reviewer가 이어진다.
- 로그는 `~/.cursor-atomic-workflow/runs/{shortRepo}/{slug}/pipeline.log`에 쌓이고, 단계별 커맨드 로그 옆에는 `.done.json` 요약이 생긴다. SDK 어댑터는 역할마다 `▶ [phase] role started · model=…` / `■ [phase] role done · N s`와 하위 서브에이전트·상태 줄을 남긴다(`tail -f pipeline.log`로 진행 확인). `ATOMIC_PROGRESS=tools`를 주면 툴 호출도 남긴다.
- `--resume`은 실패한 항목만 재시도한다(이미 체크된 항목은 유지).
- `--profile <id>`는 plan·test 지침만 바꾼다. 생략하면 프로젝트 `.cursor-atomic-workflow.json`의 `profile`, 그다음 `~/.cursor-atomic-workflow/settings.json`의 `profile`, 없으면 `atomic`이다. PLAN·TASKS·REVIEW는 그대로 `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/`에 둔다. 프로필 JSON은 패키지 `profiles/<id>.json`, `~/.cursor-atomic-workflow/profiles/<id>.json`, 저장소 `profiles/<id>.json` 순으로 찾고 나중 위치가 이긴다. JSON에 시크릿을 넣지 않는다. `profiles/bsp.json.example`은 자리 표시 경로만 있는 템플릿이다. `profiles/<id>.json` 또는 `~/.cursor-atomic-workflow/profiles/<id>.json`으로 복사한 뒤 `command`를 자신의 파일로 바꾼다. `.example.json`이나 `.json.example`로 끝나는 이름은 불러오지 않는다.

종료 코드:

| 코드 | 의미 |
|---|---|
| 0 | 파이프라인 완료 |
| 2 | 사용법 오류 |
| 10 | 부모 행동 필요 (bugbot 선행 검토 카드, task-card 인계, cli-delegate) |
| 20 | 사람 게이트 (PLAN 승인, plan-review 차단 결함, 비용 확인 등) |
| 30 | 항목 실패 또는 plan-review 단계 실패(PLAN-REVIEW 없음·형식 불량) |
| 40 | 재작업 1회 후에도 결함 |
| 50 | 시작 실패 |

---

## 5. 단계별 모델

단계 모델은 `.cursor/agents/<에이전트>.md` frontmatter의 `model`이며, Task 호출은 항상 이 값을 명시한다. 기본값은 `scripts/lib/roles.mjs`에서 오고, `node scripts/check-agents.mjs`가 파일이 여전히 일치하는지 검사한다:

| 역할 | subagent_type | Task 모델 |
|---|---|---|
| explorer | `explorer` | `claude-haiku-5-5-high` |
| planner | `planner` | `claude-sonnet-5-5-high` |
| plan-reviewer | `plan-reviewer` | `grok-4.7-high` |
| tasker | `tasker` | `composer-2.5` |
| worker | `worker` | `composer-2.5` |
| reviewer | `cursor-atomic-reviewer` | `claude-sonnet-5-5-high` |
| tester | `tester` | `claude-haiku-5-5-high` |
| cli-delegate | `cli-delegate` | `grok-4.7-high` |

모델을 바꾸려면 에이전트 frontmatter를 고치고 `scripts/lib/roles.mjs`와 맞춰 둔다(`check-agents`가 일치하지 않으면 실패한다). 또는 설치 때 `--set-model <agent>=<model>`(여러 번 가능)로 고정한다.

**부모 Composer + 파이프라인 혼합(기본 패키지 구성)** — 채팅(부모)은 Composer 2.5, 파이프라인 역할은 Haiku(탐색·테스트)·Sonnet(계획·리뷰)·Composer(task/worker)·Grok(plan-review·CLI 위임)로 나뉜다. 프로젝트 `.cursor-atomic-workflow.json`에서 `"profile": "composer-parent"`를 쓸 수 있다.

**AGY** — 계획·구현·리뷰 단계마다 러너가 AGY 위임을 물을 수 있다. `agy` 키를 프로젝트 `.cursor-atomic-workflow.json` 또는 `~/.cursor-atomic-workflow/settings.json`에 넣는다. 단계(`plan`, `implement`, `review`) 값은 `ask`(기본, exit 20으로 질문), `sdk`(Cursor 역할), `agy`(부모가 `/cursor-atomic-agy` 또는 `cli-delegate`로 `invoke-worker --worker agy` 실행). TASKS 항목에 `worker: agy`를 쓰면 구현 단계에서 AGY 항목 위임(exit 10)이 가능하다. `--auto`는 모든 AGY 질문을 `sdk`로 처리한다.

---

## 6. 하지 말 것

- **푸시 금지**: `git push`는 직접 원할 때만. 에이전트는 푸시하지 않는다.
- **비밀 금지**: 토큰·API 키·`.env`를 커밋하거나 워커 브리프에 넣지 않는다.
- **Cursor 전용**: 이 패키지는 Cursor 프로젝트에만 설치된다. OpenCode·Claude Code·Codex는 설정하지 않는다.
- **설치된 패키지 파일 함부로 편집 금지**: 설치된 `.cursor/agents/*.md`와 스킬은 `--force` 재설치와 패키지 업데이트에 덮여쓰인다. 변경은 이 저장소에 하고 재설치한다.

---

## 7. 번들된 업스트림 스킬

이 패키지를 설치하면 아래 스킬도 함께 설치되어 바로 발견된다. 별도 스킬 매니저 설정이 필요 없다.

| 단계 | 실행 주체 | 강제 스킬 |
|---|---|---|
| plan preflight | 부모 오케스트레이터 | `grilling`, `domain-modeling`, `codebase-design`, `wayfinder` |
| plan | `planner` | 같은 스킬 + `cursor-atomic-workflow` |
| task | `tasker` | `to-tickets` (산출물은 `TASKS-<slug>.md`) |
| execute | `worker` | `tdd` |
| review | `reviewer` | `code-review` (손자 없이 두 축) |

`grill-me`와 `wayfinder`는 upstream에서 `disable-model-invocation: true`인 사용자 호출용 orchestrator다. 따라서 `/cursor-atomic-plan`은 `grill-me`가 위임하는 model-invoked `grilling`을 부모 단계에서 직접 읽고 실행한다. 큰 작업은 기본적으로 tracker 없는 `local-wayfinding`으로 분류하며, upstream `wayfinder` tracker 흐름은 사용자가 명시한 경우에만 사용한다.

번들 snapshot의 원본 저장소, revision, MIT 라이선스는 `THIRD_PARTY_LICENSES/mattpocock-skills-*`에 기록되어 있다. upstream을 갱신할 때는 선정 디렉터리를 함께 갱신하고 `npm test`로 에이전트 참조를 검증한다.

---

## 8. 패키지 유지보수

스킬과 에이전트 파일은 그 자리에서 고친다. 워크플로 스크립트 `scripts/work-status.mjs`, `scripts/run-done.mjs`, `scripts/memory.mjs`는 `node scripts/sync-bundled.mjs`가 `.cursor/skills/cursor-atomic-workflow/scripts/`로 복사한다.

| 바꿀 것 | 고칠 파일 |
|---|---|
| 커맨드 동작 | `.cursor/skills/cursor-atomic-<이름>/SKILL.md` |
| 에이전트 역할 / 단계 모델 | `.cursor/agents/<에이전트>.md` (+ `scripts/lib/roles.mjs`) |
| 하네스 차이 | `.cursor/skills/cursor-atomic-workflow/references/harness.md` |
| 워크플로 스크립트 | `scripts/work-status.mjs`, `scripts/run-done.mjs`, `scripts/memory.mjs`를 고친 뒤 `node scripts/sync-bundled.mjs` |

```bash
npm test                              # 구조·에이전트·산출물 경로·번들 스크립트 동기화 테스트
node scripts/sync-bundled.mjs --check # 스킬 복사본이 어긋나면 실패
node scripts/doctor.mjs               # 충돌, YAML frontmatter, 동기화·설치 상태 점검
```

커맨드를 추가하려면 `disable-model-invocation: true`와 "사용자가 직접 호출할 때만 쓴다."로 끝나는 description을 넣어 `.cursor/skills/cursor-atomic-<이름>/SKILL.md`를 만들고 `npm test`를 실행한다. 예외: `cursor-atomic-lite`·`cursor-atomic-plan`은 메인 채팅 라우터용으로 **모델 호출 가능**(`disable-model-invocation` 없음, description에 슬래시+라우터 명시).

---

## 9. 추후 과제

이번 패키지에서 구현하지 않고 README에만 남긴 항목이다. 우선순위는 [ROADMAP.md](ROADMAP.md)에 있다. ROADMAP은 재편 전 멀티 하네스 서술에 「오래됨」을 달아 두었다.

- **병렬 워크트리 통합**: 형제 워크트리 merge 단계가 없다.

이 저장소의 pull request와 기본 브랜치(`main`) push는 GitHub Actions([`.github/workflows/ci.yml`](.github/workflows/ci.yml))가 실행한다. Node 22를 쓰며, 이는 `engines.node`(`>=22.13`)를 만족한다. 잡은 `npm ci`로 의존성을 설치한 뒤 다음을 실행한다.

- `npm test` (`node --test tests/*.test.mjs`)
- `node scripts/check-agents.mjs` (에이전트 frontmatter `model`이 `scripts/lib/roles.mjs`와 일치하는지)
- `node scripts/sync-bundled.mjs --check` (`work-status.mjs`, `run-done.mjs`, `memory.mjs` 스킬 복사본이 `scripts/`와 같은지)
- 저장소 로컬 doctor 검사: `node scripts/doctor.mjs --json`. 번들 스크립트가 어긋나거나 이 저장소 안의 `SKILL.md` description에 YAML 위험이 있으면 실패한다.

CI에서 실행하지 않는 것:

- **`node scripts/run-pipeline.mjs`**: SDK 어댑터는 Cursor 에이전트를 띄우며 Cursor SDK 자격 증명이 필요하다. `--adapter task-card`는 로컬 파이프라인 런을 쓴다. `--dry-run`도 slug가 필요하다. 어느 것도 저장소 검사가 아니다.
- **`invoke-worker.sh` / `ensure-workers.sh`의 실제 CLI 실행**: `agy`, `opencode`, `codex`, `claude`가 필요하다. `npm test`가 그 스크립트를 CLI 설치 없이 다룬다. `--dry-run`은 명령줄만 로그에 남기며 CLI가 `PATH`에 없어도 된다.
- **doctor의 전역 스킬 충돌 검사**: `~/.agents/skills`와 `~/.cursor/skills`는 그 명령을 실행하는 머신에 있다. CI는 그 결과를 실패로 보지 않는다. `doctor`는 경고만 있을 때 exit 0이므로, 워크플로는 위에서 말한 저장소 로컬 조건만 실패로 삼는다.
