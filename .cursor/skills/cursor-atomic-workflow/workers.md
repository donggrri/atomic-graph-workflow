# 워커

SKILL.md의 오케스트레이션 절을 먼저 읽는다. 위임할 때만 이 문서를 연다. 모델 표는 [models.md](models.md).

## 워크트리 기준 완화

- **기본 (작업공간 진행 권장)**: 단일 워커 순차 작업은 기본 작업공간 및 현재 브랜치에서 진행하여 디렉터리 분리 및 브랜치 전환 오버헤드를 최소화한다 (워크트리 생성 생략 권장).
- **워크트리 생성 (선택/필요 시)**:
  - 다중 에이전트가 동시에 파일을 수정하는 병렬 작업이 필요할 때
  - 현재 작업공간에 이번 작업과 무관한 변경 사항이 있어 충돌 방지 및 작업 격리가 필요할 때
  - 사용자가 명시적으로 격리/병렬 워크트리를 요구할 때

## Structured Validation (장문 로그 출력 금지)

- **채팅창 로그 오염 방지**: 빌드, 테스트, 린트 등 수십~수백 줄에 달하는 raw 로그를 채팅창에 직접 덤프하지 않는다.
- **보고 규정**: 검증 성공/실패 요약, 실패 시 `errorTail`(마지막 20줄), 그리고 전체 출력을 확인할 수 있는 로그 파일 경로(`logPath`)만을 간결하게 보고한다.
- **워커 종료 보고 규정**:
  1. 변경된 파일 목록
  2. 실행한 검증 명령
  3. 실패 내용 (실패 시 `errorTail` 마지막 20줄 기반 요약)
  4. 남은 위험
  5. 로그 파일 경로 (전체 로그 확인용)

## Challenge / Simplify 선택적 지침 (중대 작업 시)

- **일상 작업**: Worker(구현) → Reviewer(검증) 파이프라인으로 직행하며 불필요한 단계를 추가하지 않는다.
- **선택적 적용 대상**: 대규모 아키텍처 개편, 코어 데이터 모델 변경, 공개 API 설계 등 복잡도가 급증하거나 설계 가정이 위험한 중대 작업.
- **지침**:
  - **Simplify (단순화)**: 불필요한 간접 계층(over-engineering)이 없는지 점검하고, 최소한의 개념과 깊은 모듈(deep module)로 단순화하도록 유도한다.
  - **Challenge (설계 도전)**: 핵심 설계 가정, 숨겨진 결함, 엣지 케이스, 비기능 요구사항(동시성·성능·보안)을 비판적으로 도전하여 설계를 검증한다.
  - 부모 세션은 필요 시 Plan 수립 후 또는 대규모 구현 전후에 `oracle` 또는 `scout`를 활용하거나 직접 Challenge/Simplify 점검을 수행할 수 있다.

## 부모 회복 정책

- **리뷰 재작업**: REVIEW 결함을 열린 TASKS로 되돌리거나 새 항목을 붙인 뒤 worker → reviewer를 한 번만 자동 재실행한다. 한 바퀴 후에도 결함이면 멈추고 보고한다 (flake retry 없음).
- **막힘 재개**: 실패한 항목만 재시도한다. 이미 [x]는 유지한다. 재시도 시작 때 그 항목의 `막힘:`만 지운다. 입구는 `/cursor-atomic-execute`이다.
- **사람 게이트**: 사람 게이트는 PLAN(Phase 1)만이다. 리뷰 재작업 1회·막힘 재개는 정책으로 자동 실행된다.

## Cursor

기본 구현 워커는 Task `worker`이다. TASKS `worker:`가 `agy|opencode|codex|claude`이면 Task **`cli-delegate`**로 위임한다. `cli-delegate`만 `invoke-worker` 스크립트를 실행한다. 부모는 bare `agy`를 직접 실행하지 않는다.

돌아온 뒤 (필수):

1. 해당 작업공간/워크트리에서 `git status`, `git diff`
2. 항목의 `done` 조건(테스트)을 오케스트레이터가 `scripts/run-done.mjs`로 재실행하여 검증 (`.done.json` 증거 확인)
3. 통과면 TASKS `[x]`, 아니면 `막힘:` + `errorTail`(마지막 20줄) 요약 및 로그 파일 경로
4. 워커는 커밋하지 않는다. `/cursor-atomic-wrapup`만 커밋한다.

병렬: 파일이 겹치지 않고 워크트리가 다를 때만. **워크트리당 쓰기 워커는 하나.**

### 브리프 (CLI worker 공통)

CLI 워커(agy|opencode|codex|claude)는 **구현(소스·테스트 파일 편집)만** 한다. 빌드·ctest·npm test·항목 `done` 셸은 **부모 오케스트레이터**가 `invoke-worker` 종료 후 `scripts/run-done.mjs`로 실행한다.

```markdown
역할: cursor-atomic-workflow 구현 워커 (CLI: <worker>) — **코드만, 검증은 부모**.
MUST read skills (first tool calls):
- <abs>/.agents/skills/cursor-atomic-workflow/SKILL.md
- (선택) <abs>/.agents/skills/tdd/SKILL.md — 설계·실패 테스트 작성 참고만; invoke 세션에서 테스트 실행 금지
작업공간: <절대 경로>
항목: T1 <제목>
할 일: <구체적>
파일: <건드릴 경로>
부모 검증용 (워커는 실행하지 않음 — 부모가 run-done.mjs):
<TASKS done 셸 또는 확인 명령, 참고용만>
FORBID (invoke 세션): cmake, ctest, npm test, make, ninja, 항목 done 셸 실행, 빌드/테스트로 green 확인
하지 말 것: git commit, git push, 범위 확대, 비밀 파일, PLAN/TASKS 삭제
끝나면: 변경 파일, (편집 외) 실행한 명령, 실패(errorTail 요약), 남은 위험을 짧게 보고 (장문 로그 직접 덤프 금지, 로그 경로 안내).
```

`--skills cursor-atomic-workflow,tdd` 또는 `--skills-file`을 쓰면 `invoke-worker`가 위 블록을 brief 앞에 자동 prepend한다. `--dry-run`은 실제 CLI 대신 최종 명령줄만 로그에 남긴다.

### Bash (WSL / Linux / macOS)

- `scripts/ensure-workers.sh` — PATH에 CLI가 있는지 확인
- `scripts/invoke-worker.sh` — 비대화형 실행 (단일 진입점)

| 워커 | CLI | 비고 |
|---|---|---|
| `agy` | `agy -p …` | `--add-dir`로 workspace·skills |
| `codex` | `codex exec` | stdin + workspace-write |
| `opencode` | `opencode run --auto` | `--dir` workspace |
| `claude` | `claude -p` | `--add-dir` + skills prepend |
| `cli-delegate` | (위임 전용) | brief 작성 후 `invoke-worker.sh`만 Shell |
| `self` | (없음) | 현재 에이전트가 구현 |

```bash
SKILL=".agents/skills/cursor-atomic-workflow/scripts"
RUNS="$HOME/.cursor/cursor-atomic-workflow/runs/<slug>"
mkdir -p "$RUNS"

bash "$SKILL/invoke-worker.sh" \
  --worker agy \
  --workspace "<worktree>" \
  --prompt-file "$RUNS/T1.brief.md" \
  --log-file "$RUNS/T1.log" \
  --timeout-min 45 \
  --model gemini-3.8-flash-high \
  --skills cursor-atomic-workflow,tdd
```

`agy`의 `--print-timeout`은 `45m0s`처럼 단위가 있는 duration이다. `invoke-worker`가 `--timeout-min`(기본 45)을 `Nm0s`로 넣는다. 모델은 `--model` 또는 env `CURSOR_ATOMIC_AGY_MODEL`(별칭은 `scripts/resolve-agy-model.mjs`).

### PowerShell (Windows)

- `scripts/ensure-workers.ps1` — 없으면 설치
- `scripts/invoke-worker.ps1` — 비대화형 실행 (`-Skills` 동일 계약)

절대 경로: `$env:USERPROFILE\.agents\skills\cursor-atomic-workflow\scripts\...`

| 워커 | CLI | 비대화형 |
|---|---|---|
| `agy` | `agy` | `-p --mode accept-edits --dangerously-skip-permissions` |
| `codex` | `codex exec` | stdin + `--sandbox workspace-write` + `approval_policy=never` |
| `claude` | `claude` | `-p --dangerously-skip-permissions` |
| `cursor` | `cursor-agent` | `-p --force --trust --workspace` (v1 TASKS roster 밖) |
| `opencode` | `opencode run` | `--dir --auto` |
| `self` | (없음) | 현재 에이전트가 구현 |

`agy`를 인자 없이 실행하지 않는다. TUI가 떠서 멈춘다.

설치:

```powershell
& "$env:USERPROFILE\.agents\skills\cursor-atomic-workflow\scripts\ensure-workers.ps1" -Workers agy,codex
```

없는 것만 설치한다.

- agy: `irm https://antigravity.google/cli/install.ps1 | iex`
- codex: `winget install --id OpenAI.Codex -e`
- opencode: `npm install -g opencode-ai`
- cursor-agent: 자동 설치하지 않는다. 없으면 사용자에게 알린다.

인증 오류는 설치로 덮지 않는다.

- `codex login` (이미 ChatGPT면 `codex login status`)
- agy는 최초 한 번 대화형 로그인이 필요할 수 있다.

브리프는 `~/.cursor/cursor-atomic-workflow/runs/<slug>/<task-id>.brief.md`.

```powershell
$skill = Join-Path $env:USERPROFILE ".agents\skills\cursor-atomic-workflow\scripts"
$runs = Join-Path $env:USERPROFILE ".cursor\cursor-atomic-workflow\runs\<slug>"
New-Item -ItemType Directory -Force -Path $runs | Out-Null

& "$skill\invoke-worker.ps1" `
  -Worker agy `
  -Workspace "<worktree>" `
  -PromptFile "$runs\T1.brief.md" `
  -LogFile "$runs\T1.log" `
  -TimeoutMin 45
```

코딩 작업은 오래 걸린다. 셸 `block_until_ms`를 충분히 잡거나 백그라운드로 돌리고 로그를 본다.

돌아온 뒤 워커 「완료」로그를 믿지 않고, `run-done` 재실행 증거와 `errorTail`로 직접 검증한다.
