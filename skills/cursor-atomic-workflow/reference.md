# cursor-atomic-workflow 템플릿

SKILL.md를 먼저 읽는다. 파일을 쓸 때만 이 문서를 연다.

## 워크트리

단일 워커 순차 작업은 기본 작업공간/현재 브랜치에서 진행하여 오버헤드를 최소화한다 (워크트리 생성 생략 권장).
동시 병렬 수정(다중 에이전트 동시 변경)이나 무관한 변경과의 충돌 방지·격리가 필요한 경우에만 아래와 같이 워크트리를 생성한다.

### bash

저장소 루트에서:

```bash
repoRoot=$(git rev-parse --show-toplevel)
repoName=$(basename "$repoRoot")
slug="example-slug"   # PLAN과 동일한 슬러그
branch="feat/$slug"
wt="../$repoName-$slug"

# 이미 있으면 add 하지 않고 재사용
if [ -d "$wt" ]; then
  echo "Worktree already exists: $wt"
else
  git fetch origin 2>/dev/null || true
  git worktree add -b "$branch" "$wt" HEAD
fi
```

생성된 워크트리 경로(`$wt`)를 작업 디렉터리로 사용한다.

형제 워크트리 목록:

```bash
git worktree list
```

### Cursor (PowerShell)

저장소 루트에서:

```powershell
$repoRoot = git rev-parse --show-toplevel
$repoName = Split-Path $repoRoot -Leaf
$parent = Split-Path $repoRoot -Parent
$slug = "example-slug"   # PLAN과 동일한 슬러그
$branch = "feat/$slug"
$wt = Join-Path $parent "$repoName-$slug"

git fetch origin 2>$null
git worktree add -b $branch $wt HEAD
```

이미 `$wt`가 있으면 `add` 하지 말고 그 경로를 재사용한다. 만든 직후 `move_agent_to_root`의 `rootPath`에 `$wt`를 넣는다.

형제 워크트리 목록:

```powershell
git worktree list
```

## EXPLORE-\<slug\>.md

```markdown
# EXPLORE: <짧은 제목>

상태: Phase 0
슬러그: <slug>
기준: <커밋 해시 또는 브랜치>

## 한 줄 요약

<탐색 목적 및 핵심 발견 요약>

## 분석 대상 파일 및 디렉터리

1. `path/to/file.ts` (lines 10-50) - <역할 및 관련 내용>
2. `path/to/other.ts` - <역할 및 관련 내용>

## 핵심 코드 및 인터페이스

```typescript
// 발견된 주요 타입, 인터페이스, 시그니처
```

## 아키텍처 및 흐름

<컴포넌트 간 상호작용 및 데이터 흐름 요약>

## 제약 사항 및 리스크

- <의존성 제약, 호환성 문제, 잠재 위험>

## PLAN을 위한 권장 사항

1. <Phase 1 Plan 수립 시 반영할 구체적 방향>
2. <설계 및 테스트 시 유의할 점>
```

## PLAN-\<slug\>.md

```markdown
# PLAN: <짧은 제목>

상태: Phase 1
슬러그: <slug>
워크트리: <경로 또는 (없음)>
브랜치: <feat/slug 또는 (현재)>
기준: <커밋 해시 또는 (git 아님)>

## 한 줄 목표

<한 문장>

## 계획 정제

- route: bounded | local-wayfinding | explicit-wayfinder
- skills: grilling, domain-modeling, codebase-design
- decision rounds: <횟수 또는 추가 결정 없음>
- settled decisions: <요약>
- remaining fog: <없음 또는 항목>

## 하지 않을 것

- <이번 범위 밖>

## 막힌 질문

없음. 또는:
- <답 없이 구현하면 안 되는 것>

## 의존 순서

1. <먼저>
2. <그다음>

## 설계

<파일·API·데이터. 짧게>

## 검증

- 자동: `npm test`
- mutation: `/cursor-atomic-review`에서 이번 로직 파일만 (`npx stryker run --mutate <파일>`)
- 수동: <있을 때만 `tests/release/*.md`>

## 문서

<docs/README.md 표에 따라 고칠 파일. 워크플로-only면 "제품 문서 없음">

## 오케스트레이션

기본 워커: worker (Cursor Task)
허용 워커: worker, reviewer, self, cli-delegate, agy, opencode, codex, claude
```

## PLAN-REVIEW-\<slug\>.md

`run-pipeline.mjs` plan-review(Phase 1.5) 산출물. `plan-reviewer`만 작성한다.

```markdown
# PLAN-REVIEW: <제목>

PLAN: PLAN-<slug>.md
라운드: <n>
상태: Phase 1.5

## 검토 관점
- 설계 / 가정 / 과잉·과소 / NON-GOALS / 의존 순서 / 테스트 전략 / 기존 계약 / 상태 호환: 확인함

## 계획 결함

없음. 또는:
- [<관점>] <근거: 파일:줄 · 계약 · 테스트> — <영향> — <고칠 방향>

## 개선 제안
- <비차단>

## 수용된 위험
- <「계획 정제」에서 사용자가 확정한 것. 결함으로 올리지 않음>
```

## TASKS-\<slug\>.md

```markdown
# TASKS: <제목>

PLAN: PLAN-<slug>.md
상태: Phase 2

## 진행

- [ ] Ttest <실패해야 할 동작>
  - id: Ttest
  - files: `tests/mcp/server.test.mjs`
  - depends: (없음)
  - parallel: no
  - worker: self
  - done: `npm test` 해당 케이스 red 후 구현에서 green

- [ ] T1 <한 검증 단위>
  - id: T1
  - files: `path`
  - depends: (없음)
  - parallel: no
  - worker: self
  - done: <테스트나 확인>

- [ ] T2 ...
  - id: T2
  - files: `path`
  - depends: T1
  - parallel: no
  - worker: agy
  - done: ...

- [ ] Tdoc 문서 갱신
  - id: Tdoc
  - files: `docs/FEATURES.md`, `docs/CONTINUE.md`
  - depends: <구현 항목>
  - parallel: no
  - worker: self
  - done: FEATURES 상태가 코드와 같음
```

독립이고 파일이 안 겹치면 `parallel: yes`. Execute는 `[x]`로만 완료 표시한다. 막히면 항목 아래에 `막힘:` 한 줄을 남긴다.

## REVIEW-\<slug\>.md

Reviewer는 작업자의 대화 맥락을 상속받지 않는 독립 **fresh 컨텍스트**로 실행된다. 작업자 설명에 의존하지 않고 PLAN, TASKS 명세와 실제 `git diff`, 실행 테스트 결과만을 대조하여 Standards(표준/품질)와 Spec(명세 일치도) 두 축을 객관적으로 독립 검증한다.

```markdown
# REVIEW: <제목>

TASKS: TASKS-<slug>.md
상태: Phase 4

## 원칙 (Fresh Context 독립 검증)
<!-- Reviewer는 작업자 대화 맥락 없이 독립 fresh 컨텍스트로 실행되어, PLAN/TASKS 명세와 실제 git diff만을 대조하여 검증합니다. -->

## 명령

- `<테스트>` → 통과/실패 (요약)
- mutation `<파일>` → 점수 / survived 요약 / 건너뜀 이유
- `<린트>` → 통과/실패/없음

## TASKS 대조 (Spec 검증)

- T1: 충족 / 빠짐
- T2: ...

## 결함

없음. 또는:
- <파일:증상> (bugbot에서 채택한 지적은 여기에 적고, 재작업 TASKS가 분명하면 `T#` 포함)

## Bugbot 트리아지

파이프라인 Review에서만 해당. 수동 review면 「해당 없음」.

- **BUGBOT_FAILED**인 경우: 실패 사실과 `reason:` 등 기록된 사유만 적는다. 두 축 검증은 위 절들에 그대로.
- **정상 findings**인 경우:
  - **채택**: <지적 요약> — 사유: <diff·PLAN·TASKS 대조 근거> (채택 내용은 `## 결함`에도 반영, T#는 결함 절에만)
  - **기각**: <지적 요약> — 사유: <기각 근거> (기각 항목에는 T# 쓰지 않음)

## 문서

<갱신함 / 해당 없음 / 아직>

## 다음

`/cursor-atomic-wrapup` 가능. 또는 고칠 항목.
```

## 증거 아카이브

단일 전역 홈: `~/.cursor-atomic-workflow/docs/{shortRepo}/{slug}/` (레거시: `<workspace>/.docs/<slug>/`, `docs/<slug>/`)

### bash

```bash
stamp=$(date +%Y-%m-%d)
repoRoot=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
shortRepo=$(basename "$repoRoot" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | cut -c 1-24 | sed -E 's/-+$//')
dest="$HOME/.cursor-atomic-workflow/evidence/$shortRepo/$stamp-<slug>"
src="$HOME/.cursor-atomic-workflow/docs/$shortRepo/<slug>"

mkdir -p "$dest"
cp "$src"/STATUS.json "$src"/EXPLORE-<slug>.md "$src"/PLAN-<slug>.md "$src"/TASKS-<slug>.md "$src"/REVIEW-<slug>.md "$dest"/ 2>/dev/null || true
```

### Cursor (PowerShell)

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd"
$repoRoot = git rev-parse --show-toplevel 2>$null; if (!$repoRoot) { $repoRoot = Get-Location }
$shortRepo = (Split-Path $repoRoot -Leaf).ToLower() -replace '[^a-z0-9]+', '-'
if ($shortRepo.Length -gt 24) { $shortRepo = $shortRepo.Substring(0, 24).TrimEnd('-') }
$dest = Join-Path $HOME ".cursor-atomic-workflow\evidence\$shortRepo\$stamp-<slug>"
$src = Join-Path $HOME ".cursor-atomic-workflow\docs\$shortRepo\<slug>"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $src "STATUS.json"), (Join-Path $src "EXPLORE-<slug>.md"), (Join-Path $src "PLAN-<slug>.md"), (Join-Path $src "TASKS-<slug>.md"), (Join-Path $src "REVIEW-<slug>.md") $dest -ErrorAction SilentlyContinue
```

원본은 슬러그 폴더에 남긴다. `~/.gemini/evidence`는 쓰지 않는다.
