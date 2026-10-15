[English](README.md) | 한국어

# atomic-workflow

하네스 중립 Atomic Workflow. 기술 식별자는 `atomic-*`다.

Cursor·AGY·Claude Code·OpenCode·Codex·Pi에서 사용하는 atomic explore → plan → task → execute → review 워크플로.
`/atomic-explore`(선택) → `/atomic-plan` → `/atomic-task` → `/atomic-execute` → `/atomic-review` → `/atomic-wrapup`

슬래시 커맨드는 `atomic-` 접두사를 유지한다. 저장소는 **하네스 중립**(Cursor·opencode·Codex·Pi·AGY, Claude Code는 선택)이다.

---

## 목차

1. [패키지가 설치하는 것](#1-패키지가-설치하는-것)
2. [프로젝트에 설치](#2-프로젝트에-설치)
3. [사용법](#3-사용법)
4. [자동 파이프라인 러너](#4-자동-파이프라인-러너)
5. [모델과 역할](#5-모델과-역할)
6. [하지 말 것](#6-하지-말-것)
7. [번들된 업스트림 스킬](#7-번들된-업스트림-스킬)
8. [패키지 유지보수](#8-패키지-유지보수)
9. [추후 과제](#9-추후-과제)

---

## 1. 패키지가 설치하는 것

저장소 원본(하네스 중립):

| 구성 요소 | 원본 | 역할 |
|---|---|---|
| 스킬 | `skills/atomic-*/SKILL.md` | 슬래시/커맨드 로직 (`name`, `description` frontmatter만) |
| 워크플로 | `skills/atomic-workflow/` | 오케스트레이션 + `references/harness.md` |
| 서브에이전트 | `agents/*.md` | 8종: `explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `atomic-reviewer`, `tester`, `cli-delegate` (+ `memory-curator`), 설치 시 하네스별로 생성 |
| 커맨드 shim | `commands/*.md` | opencode / Pi / Claude용 얇은 래퍼 |
| 엔진 | `scripts/*.mjs` | 설치 시 `<대상>/.atomic/scripts/`에 한 번 복사 |

대상 프로젝트 예시(Cursor):

| 구성 요소 | 위치 | 역할 |
|---|---|---|
| 스킬 | `.agents/skills/` | Cursor·opencode·Codex·Pi·AGY 공통 |
| 런타임 | `.atomic/scripts/`, `.atomic/graph.yaml` | 상태·메모리·러너 |
| Cursor 에이전트 | `.cursor/agents/*.md` | 중립 역할 지침의 하네스별 복사본 |
| 라우터 | `.cursor/rules/atomic-router.mdc` | 메인 채팅 lite/full |
| 지침 | `AGENTS.md` (마커 블록) | 공통 진입 |

Node `>=22.13` 필요. `@cursor/sdk`는 패키지 루트의 optional dependency로 파이프라인 러너의 SDK 어댑터를 구동한다.

번들 snapshot의 원본 저장소, revision, MIT 라이선스는 `THIRD_PARTY_LICENSES/mattpocock-skills-*`에 기록되어 있다.

---

## 2. 프로젝트에 설치

이 저장소(또는 설치된 npm 패키지 디렉터리)에서 실행한다:

```bash
npx github:donggrri/atomic-graph-workflow --target /path/to/project --harness auto --yes
# 또는 클론 후: node scripts/install.mjs --target /path/to/project --harness auto
```

| 옵션 | 의미 |
|---|---|
| `--target <dir>` | 설치 대상 (기본: cwd) |
| `--harness <목록>` | `auto`, `cursor`, `opencode`, `codex`, `pi`, `agy`, `claude`, `hermes`, `all` (쉼표 구분). `auto`/`all`은 `--with-claude` 없으면 Claude 제외 |
| `--migrate` | 기존 `.agents/skills/atomic-*` 설치를 얇은 별칭으로 교체하고 `.cursor/skills/atomic-*`는 백업 후 제거 |
| `--force` | 기존 생성 파일을 패키지 소스로 다시 생성 (에이전트 파일에 모델 핀 없음) |
| `--with-claude` | Claude Code (`.claude/*`, `CLAUDE.md`의 `@AGENTS.md`) |
| `--yes`, `-y` | 비대화형 기본값 (TTY에서는 체크박스 설치기) |
| `--dry-run` | 생성 예정 경로만 출력 |
| `--skip-doctor` | 설치 후 doctor 생략 |
| `-h, --help` | 도움말 |

설치 후 에이전트에서 **`/atomic-setup`** 으로 `.atomic-workflow.json`을 만든다 (AGY 정책, `executors`, `executorTimeouts`, `testDone` 등).

`run-pipeline.mjs`와 `run-stage.mjs`는 `.atomic/graph.yaml`의 단계별 `executor`를 읽고, 프로젝트 `executors`가 graph를 덮어쓴다. 기본 executor는 모델 중립적인 `cursor-subagent`다. 지원 executor: `cursor-subagent`, `cursor-agent`, `cursor-sdk`(명시적 opt-in 및 SDK 모델 필요), `agy`, `codex`, `opencode`, `pi` (비대화형 `pi -p`), `claude`, `hermes` (비대화형 `hermes chat --oneshot`). CLI·SDK가 없으면 런타임 fallback(`run-stage`는 stderr에 로그), doctor가 경고한다. 외부 CLI는 `trustedExecutors` 또는 TTY 신뢰(저장소별 해시)로 승인한다. `executorTimeouts`는 단계 id → 분(기본 45).

**Hermes** (`--harness hermes`): 스킬은 `.hermes/skills/`에 설치한다(`.agents/skills` 아님). 설치 후 저장소에서 `hermes skills trust`를 실행한다. **오케스트레이터**(부모 Hermes 세션)는 `hermes-cursor-provider` 브리지와 `~/.hermes/config.yaml`의 `model.default: grok-4.7-high`를 사용한다(설치는 안내만 출력, 사용자 설정 파일은 수정하지 않음). `fast` 모델은 쓰지 않는다. 스테이지 위임은 `node .atomic/scripts/hermes-delegate.mjs` (`atomic-hermes-delegate` 스킬). `.hermes.md`는 만들지 않는다(`AGENTS.md`를 가린다). 라우팅은 `.atomic/graph.yaml`의 `nodes.<stage>.executor`·`model` 또는 `hermes.routing`, 환경 변수 `ATOMIC_HERMES_ROUTING`으로 덮어쓴다. 허용 `cursor-agent` 모델: `composer-2.5`(기본), `claude-haiku-5-5-high`, `claude-sonnet-5-5-high`, `grok-4.7-high`(별칭 `haiku-5.5-high`, `sonnet-5.5-high`). `fast` 모델은 거부, 알 수 없는 id는 경고 후 `composer-2.5`. 기본: explore·test → haiku; 구현 단계 → composer-2.5(폴백 agy gemini); plan-review → agy gemini(폴백 cursor-agent grok-4.7-high); spec-review·escalate → grok-4.7-high; plan·spec·review → agy gemini, agy 실패 시 cursor-agent sonnet(리뷰는 구현 runner와 분리).

**AGY 정책 vs 단계별 executor:** `agy.plan` / `agy.implement` / `agy.review`는 파이프라인이 AGY 위임을 *물을지*(`ask`), Cursor SDK 역할로 돌릴지(`sdk`), 부모 `/atomic-agy`에 멈출지(`agy`)를 정한다. 정책이 `agy`이고 `executors.<stage>`를 명시하지 않았으면 해당 graph 단계 executor가 `agy`로 채워진다 (`plan` → `explore`·`plan`·`plan-review`; `implement` → `task`·`execute`; `review` → `review`·`wrapup`). 명시한 `executors`가 항상 우선한다. 헤드리스 단계 실행: `node .atomic/scripts/run-stage.mjs <stage> --repo . --slug <slug> --prompt-file <brief.md>`.

에이전트에 붙여 넣을 프롬프트: [INSTALL_PROMPT.md](INSTALL_PROMPT.md).

```bash
node scripts/install.mjs --target /path/to/project --harness cursor --migrate --force
```

검증:

```bash
node .atomic/scripts/doctor.mjs --harness auto --target .
node scripts/check-agents.mjs
node scripts/sync-bundled.mjs --check
```

---

## 3. 사용법

### `cursor-atomic-*`에서 이전 (v0.2+)

공개 이름은 `atomic-*`만 사용한다(예: `/atomic-plan`). 재설치 시 `cursor-atomic-*` 스킬·커맨드·에이전트 별칭을 제거한다. 작업 홈은 `~/.atomic-workflow`(`~/.cursor-atomic-workflow`는 한 번 자동 이전). 프로젝트 설정은 `.atomic-workflow.json`(없을 때만 `.cursor-atomic-workflow.json` 읽기). 환경 변수는 `ATOMIC_*`(`CURSOR_ATOMIC_*`는 읽기 전용 폴백). `CHANGELOG.md` 참고.

### Lite vs 전체 워크플로

| | `/atomic-lite` | 전체 `/atomic-*` 파이프라인 |
|---|---|---|
| 세션 | 부모 한 세션, **서브에이전트 없음** | explore → plan-review → task → worker → reviewer → tester (Task 또는 SDK 러너) |
| 적합 | 작고 범위가 분명한 변경(보통 **파일 5개 미만**), 스키마·인증·보안 작업 없음 | 다파일 리팩터, DB 마이그레이션, 보안, 큰 계획, 병렬 워커 |
| 산출물 | 짧은 `PLAN-<slug>.md`만 (동일 전역 docs 홈) | EXPLORE, PLAN, PLAN-REVIEW, TASKS, REVIEW, evidence |
| 메모리 | 시작 시 `memory.mjs repo .` → `context <shortRepo>`, 끝에 `propose --auto <file.json>` | 같은 볼트; `memory-curator`·파이프라인 캡처 선택 |
| 마무리 | PLAN 완료 기준 대비 테스트·짧은 요약 | `/atomic-wrapup`으로 커밋 + STATUS |

lite에서 **파일 5개 이상**, **DB/스키마**, **인증·보안**, 계획이 짧은 목록을 넘어가면 멈추고 `/atomic-plan` 또는 `/atomic-run`으로 전환한다.

**메인 채팅(슬래시 없음):** `install.mjs`가 `.cursor/rules/atomic-router.mdc`를 복사한다(`alwaysApply`). 에이전트가 동일 신호(모듈 간 설계·요구 불명확 → full, 작고 국소·명확 → lite)로 판정하고 `라우팅: lite|full (이유: …)` 한 줄을 남긴다. `/atomic-*` 명시 시 그 모드가 우선. 상세: 워크플로 스킬 「메인 채팅 라우팅」, `references/routing.md`.

기본(전체): **PLAN만 확정하면** 러너가 **plan-review**(PLAN 비판 검토) → task → execute → review를 자동 실행한다. 커밋은 `/atomic-wrapup`일 때만.

| 커맨드 | 역할 | 산출물 |
|---|---|---|
| `/atomic-lite` | 단일 세션: 짧은 PLAN → 구현 → 메모리 → 테스트 마무리 (서브에이전트 없음) | `~/.atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md` |
| `/atomic-explore` | Phase 0: 코드베이스 및 기술 사전 탐색 (선택) | `~/.atomic-workflow/docs/{shortRepo}/{slug}/EXPLORE-<slug>.md` (레거시: `.docs/<slug>/`) |
| `/atomic-plan` | Phase 1 후 기본 파이프라인 | `~/.atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md` + 자동으로 TASKS/코드/REVIEW |
| `/atomic-task` | Phase 2만 강제하거나 이어서 자동 | `~/.atomic-workflow/docs/{shortRepo}/{slug}/TASKS-<slug>.md` |
| `/atomic-execute` | Phase 3만 강제하거나 이어서 자동 | 코드 변경 + 체크된 TASKS |
| `/atomic-delegate` | Phase 3: 특정 워커에 위임 | 같음 |
| `/atomic-agy` | 사용자 요청을 agy 헤드리스로 위임 (plan: 계획 문서만, implement: 코드 생성) | .cursor/plans/ 계획 파일 또는 코드 변경 |
| `/atomic-review` | Phase 4 | `~/.atomic-workflow/docs/{shortRepo}/{slug}/REVIEW-<slug>.md` |
| `/atomic-wrapup` | Phase 5: 마무리 (커밋, 푸시 없음) | git commit + STATUS |
| `/atomic-run` | 명시적 파이프라인 진입: 트리아지를 건너뛰고 explore부터 실행 | plan과 같음 |
| `/atomic-status` | 진행 상황 보고 (`npm run status` / `STATUS.json`) | 텍스트 요약 / 테이블 |
| `/atomic-config` | 워크플로 모델/스킬 설정 관리 (`/atomic-settings`) | 텍스트/대화형 설정 |
| `/atomic-models` | 모델 설정 안내 (읽기 전용) | 텍스트 안내 |
| `/atomic-doctor` | 스킬 충돌, YAML frontmatter 문법 진단 및 자동 교정(Auto-fix) | 진단 리포트 / 자동 교정 |

산출물은 `~/.atomic-workflow/docs/{shortRepo}/{slug}/` 아래에 쌓인다 (`ATOMIC_WORKFLOW_HOME`으로 홈을 바꿀 수 있다).

문서 위치 (`docsRoot`, `.atomic-workflow.json`): `home`(기본 전역 홈) 또는 저장소 기준 상대 경로(예: `specs`). 프로젝트 파일은 저장소 안에 있어야 한다: `..` 포함 경로는 거부되고, 절대 경로(또는 `~` 시작)는 경고와 함께 무시된다 — 절대 경로는 전역 설정(`~/.atomic-workflow/settings.json`의 `docsRoot`)에 둔다. `runs/`·`memory/`·`evidence/`는 항상 워크플로 홈에 남는다. artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore).

PLAN에 막힌 질문(보안·범위·데이터 손실)이 있으면 거기서 멈춘다. 계획만 쓰려면 `/atomic-plan 계획만`.

---

## 4. 자동 파이프라인 러너

`scripts/run-pipeline.mjs`는 대화 세션 대신 단계를 headless로 실행한다:

```bash
node scripts/run-pipeline.mjs <slug> [--auto] [--resume] [--adapter sdk|task-card] [--profile <id>] [--repo <dir>] [--dry-run]
```

- 기본 adapter는 모델 중립적인 `task-card`이며 부모 세션이 실행할 `next-card.json`을 남긴 뒤 `--resume`한다. `--adapter sdk`는 `@cursor/sdk`를 명시적으로 선택할 때만 사용하며 호출자가 SDK 모델을 제공해야 한다(워크플로가 모델을 고르지 않는다). cost-gate 뒤 **plan-review**가 `plan-reviewer`를 실행해 `PLAN-REVIEW-<slug>.md`를 쓰고, 차단 결함은 planner 1회 자동 수정·재검토 후에도 남으면 종료코드 `20`으로 멈춘다. **Review** 진입(초기·재작업 후)마다 종료코드 `10`이 **`kind: "bugbot"`** 선행 검토 카드일 수 있다. 부모가 Cursor `bugbot`을 실행하고 `~/.atomic-workflow/runs/{shortRepo}/{slug}/bugbot-findings.md`에 결과를 저장(실패 시 `# BUGBOT_FAILED` 마커)한 뒤 `--resume`하고 reviewer가 이어진다.
- 로그는 `~/.atomic-workflow/runs/{shortRepo}/{slug}/pipeline.log`에 쌓이고, 단계별 커맨드 로그 옆에는 `.done.json` 요약이 생긴다. SDK 어댑터는 역할마다 `▶ [phase] role started` / `■ [phase] role done · N s`와 하위 서브에이전트·상태 줄을 남긴다(`tail -f pipeline.log`로 진행 확인). `ATOMIC_PROGRESS=tools`를 주면 툴 호출도 남긴다.
- `--resume`은 실패한 항목만 재시도한다(이미 체크된 항목은 유지).
- `--profile <id>`는 plan·test 지침만 바꾼다. 생략하면 프로젝트 `.atomic-workflow.json`의 `profile`, 그다음 `~/.atomic-workflow/settings.json`의 `profile`, 없으면 `atomic`이다. PLAN·TASKS·REVIEW는 그대로 `~/.atomic-workflow/docs/{shortRepo}/{slug}/`에 둔다. 프로필 JSON은 패키지 `profiles/<id>.json`, `~/.atomic-workflow/profiles/<id>.json`, 저장소 `profiles/<id>.json` 순으로 찾고 나중 위치가 이긴다. JSON에 시크릿을 넣지 않는다. `profiles/bsp.json.example`은 자리 표시 경로만 있는 템플릿이다. `profiles/<id>.json` 또는 `~/.atomic-workflow/profiles/<id>.json`으로 복사한 뒤 `command`를 자신의 파일로 바꾼다. `.example.json`이나 `.json.example`로 끝나는 이름은 불러오지 않는다.

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

## 5. 모델과 역할

워크플로는 **모델을 정하지 않는다.** 서브에이전트, 헤드리스 CLI(`cursor-agent`, `agy` 등), 부모 세션 모두 각 하네스의 기본 모델을 쓰며, 바꾸려면 그 하네스에서 바꾼다. 서브에이전트 호출에는 `model`이 없고, 에이전트 파일에도 `model` frontmatter가 없다. `--set-model`, `invoke-worker --model`, `agyModel`, `executors.<단계>.model`은 사라졌다(설정에 남은 값은 경고와 함께 무시되고, 두 플래그는 아무것도 쓰기 전에 실패한다).

모든 단계는 활성 하네스의 **공용 서브에이전트 하나**로 실행한다. 논리 역할(`explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `reviewer`, `tester`, `cli-delegate`)은 `.atomic/agents/<subagentType>.md`의 프롬프트 계약이며, `reviewer`는 `atomic-reviewer.md`로 매핑된다. 부모가 그 경로·강제 스킬·`docsDir`·산출물을 호출 프롬프트에 넣는다. 서브에이전트가 없는 하네스(Pi)는 부모 세션이 같은 지침을 순서대로 수행한다. 독립 검토는 다른 모델 계열이 아니라 새 컨텍스트와 증거(PLAN·TASKS·diff·테스트)로 보장한다.

| 하네스 | 확인한 서브에이전트 도구 | 비고 |
|---|---|---|
| Claude Code | `Agent` (`general-purpose`) | `subagent_type`을 생략하면 공용 에이전트 |
| Cursor | `Task` | 모델은 Cursor가 정함 |
| AGY | `invoke_subagent` | 규칙만 줘도 호출했음 |
| OpenCode | `subagent` (`agent: general`) | `general`을 명시하지 않으면 모델이 `explore`를 고를 수 있음 |
| Pi | 없음 | 부모가 역할을 순차 수행 |

### 헤드리스 위임 (`cursor-agent`, `agy`)

코드를 수정하는 단계(`lite`, `execute`)는 CLI를 전체 권한 플래그(`cursor-agent --force --trust`, `agy --dangerously-skip-permissions`)로 실행한다. 나머지 단계(explore, plan, plan-review, task, review, wrapup, memory)도 같은 방식으로 실행하되, 프롬프트 맨 앞에 **FORBID 블록**을 붙여 제품 파일 수정, git 상태 변경, 설치·빌드를 금지하고 쓰기를 단계 산출물로 제한한다. 이것은 샌드박스가 아니라 프롬프트 규칙이다. `cursor-agent`도 이제 다른 CLI처럼 저장소별 신뢰 확인(`trustedExecutors`, `ATOMIC_TRUST_COMMANDS=1`)을 거친다.

**AGY** — 계획·구현·리뷰 *정책*(`agy.plan` / `agy.implement` / `agy.review`)마다 러너가 AGY 위임을 물 수 있다. 값은 `ask`(기본, exit 20), `sdk`(Cursor 역할), `agy`(부모가 `/atomic-agy` 또는 `invoke-worker --worker agy`). 정책 `agy`는 위 표와 같이 graph 단계 executor를 `agy`로 채운다(명시 `executors` 제외). TASKS `worker: agy`는 구현 항목 위임(exit 10). `--auto`는 AGY 질문을 모두 `sdk`로 처리한다. `memory-sweep.mjs`의 curator는 graph `memory` 단계 설정 executor를 사용한다.

---

## 6. 하지 말 것

- **푸시 금지**: `git push`는 직접 원할 때만. 에이전트는 푸시하지 않는다.
- **비밀 금지**: 토큰·API 키·`.env`를 커밋하거나 워커 브리프에 넣지 않는다.
- **전체 권한**: 헤드리스 `cursor-agent`·`agy` 실행은 권한 확인을 건너뛴다. 코드를 수정해야 하는 단계만 그렇게 쓰도록 의도했고 나머지는 FORBID 프롬프트 규칙으로 막으므로, 신뢰하는 저장소에서만 쓴다.
- **설치된 패키지 파일 함부로 편집 금지**: 설치된 하네스별 에이전트 복사본과 스킬은 `--force` 재설치와 패키지 업데이트에 덮어쓰인다. 변경은 이 저장소에 하고 재설치한다.

---

## 7. 번들된 업스트림 스킬

이 패키지를 설치하면 아래 스킬도 함께 설치되어 바로 발견된다. 별도 스킬 매니저 설정이 필요 없다.

| 단계 | 실행 주체 | 강제 스킬 |
|---|---|---|
| plan preflight | 부모 오케스트레이터 | `grilling`, `domain-modeling`, `codebase-design`, `wayfinder` |
| plan | `planner` | 같은 스킬 + `atomic-workflow` |
| task | `tasker` | `to-tickets` (산출물은 `TASKS-<slug>.md`) |
| execute | `worker` | `tdd` |
| review | `reviewer` | `code-review` (손자 없이 두 축) |

`grill-me`와 `wayfinder`는 upstream에서 `disable-model-invocation: true`인 사용자 호출용 orchestrator다. 따라서 `/atomic-plan`은 `grill-me`가 위임하는 model-invoked `grilling`을 부모 단계에서 직접 읽고 실행한다. 큰 작업은 기본적으로 tracker 없는 `local-wayfinding`으로 분류하며, upstream `wayfinder` tracker 흐름은 사용자가 명시한 경우에만 사용한다.

번들 snapshot의 원본 저장소, revision, MIT 라이선스는 `THIRD_PARTY_LICENSES/mattpocock-skills-*`에 기록되어 있다. upstream을 갱신할 때는 선정 디렉터리를 함께 갱신하고 `npm test`로 에이전트 참조를 검증한다.

---

## 8. 패키지 유지보수

스킬과 에이전트 파일은 `skills/`, `agents/`에서 고친다. 워크플로 스크립트 `scripts/work-status.mjs`, `scripts/run-done.mjs`, `scripts/memory.mjs`는 `node scripts/sync-bundled.mjs`가 `.atomic/scripts/`로 복사한다.

| 바꿀 것 | 고칠 파일 |
|---|---|
| 커맨드 동작 | `skills/atomic-<이름>/SKILL.md` |
| 에이전트 역할 지침 | `agents/<에이전트>.md` (+ `scripts/lib/roles.mjs`) |
| 하네스 차이 | `skills/atomic-workflow/references/harness.md` |
| 워크플로 스크립트 | `scripts/work-status.mjs`, `scripts/run-done.mjs`, `scripts/memory.mjs`를 고친 뒤 `node scripts/sync-bundled.mjs` |

```bash
npm test                              # 구조·에이전트·산출물 경로·번들 스크립트 동기화 테스트
node scripts/sync-bundled.mjs --check # .atomic/scripts/ 복사본이 어긋나면 실패
node scripts/doctor.mjs               # 충돌, YAML frontmatter, 동기화·설치 상태 점검
```

커맨드를 추가하려면 `skills/atomic-<이름>/SKILL.md`를 만들고 `npm test`를 실행한다. 하네스 전용 frontmatter는 넣지 않는다.

---

## 9. 추후 과제

이번 패키지에서 구현하지 않고 README에만 남긴 항목이다. 우선순위는 [ROADMAP.md](ROADMAP.md)에 있다. ROADMAP은 재편 전 멀티 하네스 서술에 「오래됨」을 달아 두었다.

- **병렬 워크트리 통합**: 형제 워크트리 merge 단계가 없다.

이 저장소의 pull request와 기본 브랜치(`main`) push는 GitHub Actions([`.github/workflows/ci.yml`](.github/workflows/ci.yml))가 실행한다. Node 22를 쓰며, 이는 `engines.node`(`>=22.13`)를 만족한다. 잡은 `npm ci`로 의존성을 설치한 뒤 다음을 실행한다.

- `npm test` (`node --test tests/*.test.mjs`)
- `node scripts/check-agents.mjs` (에이전트 frontmatter `model`이 `scripts/lib/roles.mjs`와 일치하는지)
- `node scripts/sync-bundled.mjs --check` (`work-status.mjs`, `run-done.mjs`, `memory.mjs`가 `scripts/`와 `.atomic/scripts/`에서 같은지)
- 저장소 로컬 doctor 검사: `node scripts/doctor.mjs --json`. 번들 스크립트가 어긋나거나 이 저장소 안의 `SKILL.md` description에 YAML 위험이 있으면 실패한다.

CI에서 실행하지 않는 것:

- **`node scripts/run-pipeline.mjs`**: SDK 어댑터는 Cursor 에이전트를 띄우며 Cursor SDK 자격 증명이 필요하다. `--adapter task-card`는 로컬 파이프라인 런을 쓴다. `--dry-run`도 slug가 필요하다. 어느 것도 저장소 검사가 아니다.
- **`invoke-worker.sh` / `ensure-workers.sh`의 실제 CLI 실행**: `agy`, `opencode`, `codex`, `claude`가 필요하다. `npm test`가 그 스크립트를 CLI 설치 없이 다룬다. `--dry-run`은 명령줄만 로그에 남기며 CLI가 `PATH`에 없어도 된다.
- **doctor의 전역 스킬 충돌 검사**: `~/.agents/skills`와 `~/.cursor/skills`는 그 명령을 실행하는 머신에 있다. CI는 그 결과를 실패로 보지 않는다. `doctor`는 경고만 있을 때 exit 0이므로, 워크플로는 위에서 말한 저장소 로컬 조건만 실패로 삼는다.
