# ROADMAP

이 문서는 `atomic-graph-workflow`에 적용할 개선 항목과 순서를 정리한다.
외부 참고는 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)(구 oh-my-opencode, 이하 OmO) `718ef30`(2026-09-27)의 `ulw-plan`·`ulw-execute` 스킬, 오케스트레이션 가이드, 선언문이다.

## 현재 트리와 맞지 않는 서술

패키지는 Cursor 전용이다. 아래는 이 문서 안에서 지금 코드와 다른 부분이다. 역사 기록은 지우지 않았다.

- **0단계 경로와 생성기 (오래됨)**: `skills/`, `prompts/`, `agents/*.md`, `.opencode/`, `.claude/`, `scripts/sync-harness.mjs`, `scripts/install.mjs --harness cursor,opencode,claude,codex`는 재편 전 구조다. 커맨드와 에이전트 원본은 `.cursor/skills/`와 `.cursor/agents/`다. 루트 `scripts/work-status.mjs`, `scripts/run-done.mjs`, `scripts/memory.mjs`를 스킬 사본과 맞추는 명령은 `node scripts/sync-bundled.mjs`이고, `--check`는 CI에서 돈다.
- **`plan-reviewer` 상태 (일부 오래됨)**: `.cursor/agents/plan-reviewer.md`가 있고 `run-pipeline.mjs`가 cost-gate 뒤에 항상 실행한다. 자동 수정은 1회다. 3단계에 적힌 「최대 3회」와 「HEAVY일 때만」은 아직 없다.
- **`tester` 누락 문장 (오래됨)**: 1단계 「reviewer ↔ tester」의 "Cursor 에이전트 목록에도 없다"는 옛 상태다. `.cursor/agents/tester.md`가 있다. worker → tester → reviewer 순서 고정은 아직 대기이다.
- **README 장 번호 (오래됨)**: 맨 아래 표의 「README 11장」은 현재 README 9장 「추후 과제」다.
- **저장소 CI**: `.github/workflows/ci.yml`이 pull request와 `main` push에서 `npm test`, `check-agents`, `sync-bundled --check`, doctor를 실행한다. `/atomic-wrapup --make-pr`는 아직 없다.
- **증거 경로**: `CONTEXT.md`와 `run-done.mjs`는 `~/.atomic-workflow/runs/{shortRepo}/<slug>/<id>.done.json`으로 맞췄다. 명령 로그는 같은 디렉터리의 `<id>.log`다. 2단계 ledger(`ledger.jsonl`, verdict)는 아직 없다.

## 유지할 원칙

OmO의 "사람 개입은 실패 신호"를 그대로 따르지 않는다. 아래는 이 패키지가 의도적으로 지키는 선택이다.

- 사람 게이트는 PLAN(Phase 1) 하나다.
- 커밋은 `/atomic-wrapup`에서만, 푸시는 사용자가 원할 때만 한다.
- 문서 항목은 부모가 `self`로 처리할 수 있다. 오케스트레이터가 모든 일을 위임할 필요는 없다.

## 우선순위 요약

| 단계 | 항목 | 수정 범위 | 상태 |
|---|---|---|---|
| 0 | 하네스 통합: 스킬을 단일 소스로, 커맨드는 생성된 얇은 shim | `skills/`, `prompts/`, `.cursor/`, `.opencode/`, `.claude/`, `scripts/sync-harness.mjs`, `scripts/install.mjs` | 완료 |
| 1 | LIGHT/HEAVY 작업 등급 | `SKILL.md`, `agents/tasker.md`, `reference.md` | 대기 |
| 1 | reviewer ↔ tester 순서 정리 | `SKILL.md`, `agents/reviewer.md`, `agents/tester.md` | 대기 |
| 1 | 적대적 QA 트리거 맵 | `testing.md`, REVIEW 템플릿 | 대기 |
| 1 | 의도 CLEAR/UNCLEAR 분기 | plan 커맨드, `SKILL.md` Phase 1 | 대기 |
| 1 | 워커 브리프 표준 형식 | `reference.md`, `agents/worker.md` | 대기 |
| 2 | 완료 판정(verdict) 필드 | `scripts/run-done.mjs`, `testing.md`, 테스트 | 대기 |
| 2 | 증거 ledger와 경로 통일 | `scripts/run-done.mjs`, `scripts/work-status.mjs`, `CONTEXT.md` | 경로만 통일, ledger는 대기 |
| 3 | `plan-reviewer` 에이전트 | `agents/`, plan 커맨드 | 일부 구현 (3회·HEAVY 조건은 대기) |
| 3 | 활성 작업 재개와 `/atomic-handoff` | `work-status.mjs`, execute 커맨드, 새 커맨드 | 대기 |
| 3 | 배운 점 누적(`LEARNINGS.md`) | `SKILL.md`, `agents/worker.md` | 대기 |
| 3 | 난이도별 워커 변형 | `agents/` | 대기 |

0단계를 먼저 한 이유: 1~3단계는 모두 커맨드와 에이전트 본문을 고친다. 통합 전 구조에서는 같은 수정을 원본과 Cursor 생성본, (추가될) OpenCode 파일에 각각 반영해야 했다. 이제 커맨드는 `skills/atomic-<이름>/SKILL.md`, 에이전트는 `agents/<에이전트>.md` 한 곳만 고친다.

---

## 0단계: 하네스 통합

> 오래됨. 아래 트리와 명령 이름은 Cursor 전용 재편 전이다. 맞는 경로는 위 「현재 트리와 맞지 않는 서술」을 본다.

### 통합 전 문제

- 커맨드 로직이 `prompts/*.md`에 있고, `scripts/sync-cursor.mjs`가 문자열 치환 규칙 16개(`PI_TO_CURSOR_PHRASES`)로 `.cursor/commands/`를 만든다. 원본 문구가 조금만 바뀌어도 치환이 조용히 빠진다.
- OpenCode(`.opencode/commands/`), Claude Code(`.claude/`)를 지원하려면 치환 규칙 세트가 하네스마다 늘어난다.
- 에이전트(`agents/*.md`)도 같은 방식으로 `.cursor/agents/`를 생성하고, `tester`는 Cursor 목록에서 빠져 있다.

### 조사 결과

각 하네스 공식 문서 기준(2026-09 확인):

| 하네스 | `.agents/skills/` 읽기 | 스킬을 슬래시로 호출 | 전용 커맨드 위치 | 인자 전달 |
|---|---|---|---|---|
| Cursor | 예 | `/<name>` (`disable-model-invocation: true`면 슬래시 전용) | `.cursor/commands/`(레거시) | 뒤 텍스트가 메시지로 붙음 |
| Codex | 예 (cwd → 저장소 루트) | `$<name>`, `/skills` | 없음 | 프롬프트에 함께 |
| OpenCode | 예 (`.agents/skills/`, `~/.agents/skills/`) | 아니오 (`skill` 도구로만 로드) | `.opencode/commands/` | `$ARGUMENTS`, `$1` |
| Claude Code | 아니오 (`.claude/skills/`만) | `/<name>` (커맨드가 스킬에 통합됨) | `.claude/commands/`(레거시) | `$ARGUMENTS` |

결론:

- 스킬 형식(`SKILL.md`)은 조사한 하네스가 읽는다. 그래서 커맨드 로직을 스킬로 옮기면 단일 소스가 된다.
- Cursor·Codex·Claude Code는 스킬 자체가 커맨드라서 별도 파일이 필요 없다. Claude Code는 `.claude/skills` 위치만 맞춰 주면 된다(심볼릭 링크 또는 설치 시 복사).
- OpenCode만 커맨드 이름(`/atomic-plan`)을 유지하려면 shim이 필요하다. shim은 "이 스킬을 읽고 따르라 + 인자"만 담으므로 로직이 바뀌어도 다시 고칠 일이 없다.
- 하네스별 차이(서브에이전트 호출법, 인자 문법)는 문자열 치환이 아니라, 스킬 안의 하네스 어댑터 표 하나로 흡수한다. OmO도 각 스킬 머리에 "Harness Tool Compatibility" 표를 두는 같은 방식을 쓴다.

### 구현된 구조

```text
skills/                                   # 단일 소스 (설치 시 <project>/.agents/skills/ 또는 .claude/skills/)
├── atomic-graph-workflow/
│   ├── SKILL.md
│   ├── references/harness.md             # 하네스 판별 + 위임/입력/스크립트 경로/전용 도구 표
│   └── scripts/{work-status,run-done}.mjs # 생성: scripts/ 원본의 복사본
├── atomic-plan/SKILL.md      # disable-model-invocation: true, 커맨드 로직 본문
├── atomic-execute/SKILL.md
└── ...                                   # 커맨드마다 스킬 1개 (12개)
agents/*.md                               # 에이전트 단일 소스: frontmatter + 역할 본문
.opencode/commands/*.md                   # 생성: OpenCode shim (`$ARGUMENTS` 전달)
.cursor/agents/*.md                       # 생성: Cursor frontmatter + 같은 본문
.opencode/agents/*.md                     # 생성: OpenCode frontmatter(mode: subagent) + 같은 본문
.claude/agents/*.md                       # 생성: Claude Code frontmatter(skills, background) + 같은 본문
```

`.cursor/commands/`는 제거했다. 같은 이름의 스킬과 커맨드가 함께 있으면 Cursor 슬래시 메뉴에 두 번 뜬다.

설계에서 바꾼 점:

- 에이전트 본문을 `references/roles/`로 옮기지 않았다. 에이전트 본문은 이미 `agents/*.md` 하나에서 생성되고 있었고, 포인터로 바꾸면 서브에이전트가 역할 파일을 한 번 더 읽어야 해서 지시 누락 위험만 늘어난다. 생성기가 frontmatter만 하네스별로 바꾼다.
- 커맨드 shim은 스킬 이름이 아니라 "`atomic-graph-workflow` 스킬과 같은 폴더의 `<커맨드>/SKILL.md`"를 가리킨다. `disable-model-invocation: true`인 스킬은 모델 목록에서 빠져 경로를 알 수 없지만, 워크플로 스킬 위치(`<location>`)는 모델에 보이기 때문이다.
- 커맨드 기본 입력값은 shim이 아니라 커맨드 스킬 본문 "입력:" 줄에 둔다. 스킬을 직접 호출하는 Cursor·Claude Code·Codex에서도 같은 기본값이 적용된다.
- `tester`와 `cli-delegate`를 포함한 에이전트 7종을 모두 생성한다. Claude Code용 `.claude/agents/`도 생성한다.

### 작업 목록

- [x] `references/harness.md` 작성: 하네스 판별(사용 가능한 도구와 에이전트 목록), 서브에이전트 호출법(Cursor Task 백그라운드), 커맨드 입력, 스크립트 경로, 하네스 전용 도구.
- [x] `prompts/*.md` 12개 본문을 `skills/atomic-<cmd>/SKILL.md`로 옮기고 하네스 중립 문구로 바꿨다. frontmatter는 `name`, `description`(끝에 "사용자가 직접 호출할 때만 쓴다."), `disable-model-invocation: true`, `metadata.argument-hint`.
- [x] ~~에이전트 본문을 `references/roles/<역할>.md`로 옮긴다.~~ 하지 않기로 했다(위 「설계에서 바꾼 점」).
- [x] `scripts/sync-cursor.mjs`를 `scripts/sync-harness.mjs`로 교체했다. 치환 규칙 `PI_TO_CURSOR_PHRASES`는 없앴다. 원본이 사라진 생성물은 쓰기 모드에서 지우고 `--check`에서 보고한다.
- [x] `scripts/install-cursor.mjs`를 `scripts/install.mjs --harness cursor,opencode,claude,codex`로 일반화했다. Claude Code는 `.claude/skills`에 복사한다. `--link`(심볼릭 링크)는 넣지 않았다.
- [x] `doctor.mjs` 3번 섹션을 하네스 전체 진단으로 바꾸고, 레거시 `.cursor/commands/atomic-*.md` 잔존 경고를 추가했다.
- [x] 테스트 `tests/harness-sync.test.mjs`: 커맨드 스킬의 `disable-model-invocation`·description 가드, shim이 스킬만 가리키는지, 생성물 일치와 옛 생성물 삭제, 하네스별 설치, doctor 진단.
- [x] README 두 언어의 설치·유지보수 섹션을 새 구조로 갱신했다.

완료 기준: 커맨드 로직을 바꿀 때 `skills/` 아래 파일만 수정하고 `node scripts/sync-harness.mjs --check && npm test`가 통과한다.

### 검증한 것과 남은 확인

- OpenCode 1.18.32로 설치 프로젝트에서 확인: 에이전트 7종이 subagent로 뜨고, `cli-delegate`는 `edit` 권한이 `deny`다. 커맨드 12개와 스킬 13개(커맨드 12 + 워크플로)가 인식된다.
- OpenCode는 `disable-model-invocation`을 모르므로 커맨드 스킬이 모델에 보인다. `permission.skill` deny 대신 description 끝의 "사용자가 직접 호출할 때만 쓴다." 가드로 자동 선택을 막았다. 자동 선택이 실제로 생기면 그때 permission 예시를 추가한다.
- 실제 대화 세션에서 확인하지 못한 것: Cursor·Claude Code의 슬래시 메뉴 표시와 생성된 에이전트 로드. Claude Code 에이전트 frontmatter는 공식 문서 필드(`name`, `description`, `skills`, `disallowedTools`, `model`, `background`)만 쓴다.
- 프로젝트 `.cursor/commands/` 복사본이 새 스킬을 가린다. doctor 경고, 설치 스크립트 안내, README 삭제 안내로 대응한다.

---

## 1단계: 문서만 수정

### LIGHT/HEAVY 작업 등급

- 무엇: `tasker`가 TASKS 항목마다 `tier: light|heavy`를 적는다. HEAVY는 가리킬 수 있는 사실이 있을 때만 붙인다(새 모듈·추상화, 인증·보안·세션, 외부 연동, DB 스키마·마이그레이션, 동시성·트랜잭션, 도메인 간 리팩터, PLAN이나 사용자가 주의를 요청). 애매하면 HEAVY, 한 번 올리면 내리지 않는다.
- 왜: 지금 "중대 작업일 때만 Challenge/Simplify"는 판단 기준이 없다.
- 적용: HEAVY일 때만 Challenge/Simplify, 항목별 독립 검증(2단계 verdict), `tester`를 실행한다. LIGHT는 worker → run-done → reviewer로 끝난다.

### reviewer ↔ tester 순서 정리

- 문제: `tester`는 REVIEW 파일이 있어야 실행되는데, `reviewer`는 tester 결과를 재검증하라고 되어 있어 순환한다. ~~`tester`는 Cursor 에이전트 목록에도 없다.~~ (오래됨: `.cursor/agents/tester.md`가 있다.)
- 적용: 순서를 worker → (HEAVY면 tester) → reviewer로 고정한다. reviewer는 최종 게이트 하나로 남는다. `tester`의 "REVIEW 필요" 조건을 삭제한다. (`tester`는 0단계에서 모든 하네스 생성 목록에 들어갔다.)

### 적대적 QA 트리거 맵

`testing.md`와 REVIEW 템플릿에 아래 표를 넣는다. 조건이 맞는 분류만 검사하고, 나머지는 "적용 안 됨 + 한 줄 이유"를 REVIEW에 적는다.

| 조건 | 검사할 것 |
|---|---|
| 새 입력 파싱 | 잘못된 입력 |
| 외부에서 들어온 텍스트 | 프롬프트 인젝션 |
| 재개 가능하거나 오래 도는 흐름 | 취소·재개 |
| 생성·캐시 산출물 | 오래된 상태 |
| 작업 범위에 커밋 안 된 사용자 파일 | 더러운 워크트리 |
| 긴 외부 명령 | 멈춤·장시간 실행 |
| 새 테스트나 타이밍 민감 테스트 | flaky |
| 로그로 성공을 주장 | 오해를 부르는 성공 출력 |
| 작업 도중 중단 가능 | 반복 중단 |

### 의도 CLEAR/UNCLEAR 분기

- 무엇: planning preflight에서 탐색을 먼저 하고, 원하는 결과가 분명하면(CLEAR) 저장소로 답할 수 없는 선택지만 묻는다. 결과가 흐릿하면(UNCLEAR) 모범 기본값을 채택했다고 알리고 추가 질문 없이 진행한다. 판단이 애매하면 CLEAR로 보고 질문 하나만 한다.
- 예외: 되돌릴 수 없는 결정, 파괴적 결정, 비용이 드는 결정은 어느 경우든 질문으로 남긴다. "질문 그만"이라고 해도 이 결정들은 마지막에 승인 블록 하나로 모아 확인한다.
- 판정과 이유를 사용자에게 한 줄로 알린다.

### 워커 브리프 표준 형식

`reference.md`에 템플릿을 둔다.

```markdown
TASK: <명령형 한 줄>
DELIVERABLE: <만들 파일·결과>
SCOPE: <건드려도 되는 파일, 건드리면 안 되는 것>
VERIFY: <done 명령>
STOP WHEN: <멈추고 보고할 조건>
```

워커는 긴 작업 중 `WORKING: <항목> - <현재 단계>`를, 진행이 멈췄을 때만 `BLOCKED: <이유>`를 보고한다. 범위 밖 결함을 발견하면 고치지 않고 보고하며, 부모가 TASKS에 새 항목으로 붙인다.

---

## 2단계: 스크립트 수정

### 완료 판정(verdict) 필드

- 무엇: `.done.json`에 `verdict: confirmed | false-positive | needs-fix | needs-human-review`와 `evidence` 배열을 추가한다. `confirmed`만 통과다.
- 왜: `run-done`은 종료 코드만 본다. 동어반복 테스트도 통과한다.
- 적용: LIGHT는 run-done 통과 시 `confirmed`로 기록한다. HEAVY는 워커와 다른 컨텍스트(fresh `reviewer`)가 판정해야 `confirmed`가 된다. 비통과 판정이면 실패 내용을 붙여 워커에 다시 보낸다.

### 증거 ledger와 경로 통일

- 무엇: `~/.atomic-workflow/runs/{shortRepo}/{slug}/ledger.jsonl`에 한 줄에 JSON 하나씩 추가만 한다. 필드는 `event`, `task`, `tier`, `session_id`, `commands`, `verdict`, `artifact`, `adversarial`.
- 부수 효과: 경로 불일치는 맞춰 두었다. 증거는 `~/.atomic-workflow/runs/{shortRepo}/<slug>/<id>.done.json`이고 로그는 `<id>.log`다. ledger와 `work-status.mjs show` 요약은 아직 없다.

---

## 3단계: 새 에이전트와 커맨드

### `plan-reviewer` 에이전트

> 일부만 오래됨. 에이전트와 항상 실행·자동 수정 1회는 구현되어 있다. 최대 3회와 HEAVY일 때만 켜기는 아직 없다.

- 무엇: 읽기 전용 에이전트. PLAN 저장 후 `tasker` 전에 실행한다. 승인 쪽으로 기울어 있고, 확인된 막힘만 거절한다. 참조 파일이 실제로 있는지, 모든 항목에 실행 가능한 `done`이 있는지, 항목끼리 모순이 없는지, 구현자가 판단할 거리가 남지 않았는지를 본다.
- 라운드는 최대 3회. 거절 사유를 고쳐 다시 제출한다. HEAVY 항목이 있거나 사용자가 "고정밀"을 요청했을 때 기본으로 켠다.

### 활성 작업 재개와 `/atomic-handoff`

- 활성 작업: `STATUS.json`의 `sessionId`를 기준으로, 인자 없는 `/atomic-execute`가 이 세션의 열린 slug를 자동으로 고른다. 여러 개면 질문 하나로 고른다.
- `/atomic-handoff`: 한 일, 남은 항목, 막힘, 관련 파일 경로를 `HANDOFF-<slug>.md`로 남겨 새 세션에서 바로 이어가게 한다.

### 배운 점 누적

- 슬러그 폴더에 `LEARNINGS.md`를 둔다. 워커는 끝날 때 발견한 관례·함정·결정을 한 줄씩 추가하고, 부모는 다음 워커 브리프에 이 파일을 넣는다.
- 저장소 단위 `~/.atomic-workflow/docs/{shortRepo}/LEARNINGS.md`로 승격하는 규칙은 wrapup에서 정한다.

### 난이도별 워커 변형

- `worker-quick`, `worker-deep` 변형을 둔다. `tasker`가 `category: quick|standard|deep`을 붙인다.
- 쪼갤 수 있는 일은 `quick` 여러 개를 병렬로, 하나의 통찰로 묶인 어려운 일은 `deep` 하나에 통째로 맡긴다.

---

## 선택 항목

- AI 흔적 점검: 장황한 주석, 불필요한 방어 코드, 과한 추상화를 reviewer Standards 축 체크리스트에 추가.
- 병렬 워크트리 병합 규칙: 검증된 단위부터 바로 병합, 병합과 충돌 해결은 부모만.
- `/atomic-wrapup --make-pr`: 사용자가 명시했을 때만 푸시와 PR 생성.

## 도입하지 않는 것

- 오케스트레이터 직접 구현 전면 금지: 문서 항목의 `self` 처리가 더 효율적이다.
- Team mode, DAG 워크플로 도구, hashline 편집, LSP/AST 도구, 유휴 턴 자동 재주입 훅: 하네스(엔진) 기능이라 패키지 범위를 넘는다.

## 기존 추후 과제와의 대응

README 9장(옛 표의 「11장」은 오래됨)의 항목은 아래 단계에서 함께 처리한다.

| README 추후 과제 | 처리 단계 |
|---|---|
| Cursor 동기화 드리프트(`tester` 누락) | 0단계에서 해결 (에이전트 7종 모두 생성). `tester` 파일은 지금 있다 |
| README 에이전트 키 누락 | 0단계 README 갱신 |
| CONTEXT.md vs `run-done` 증거 경로 | 경로 통일 완료. ledger는 2단계 대기 |
| 병렬 워크트리 통합 | 선택 항목 병합 규칙 |
| PR/CI | 저장소 CI 완료 (`.github/workflows/ci.yml`, `sync-bundled --check`). `--make-pr`는 선택 항목으로 대기 |
