# 범용 워크플로 적용 가능성 (2026-10-13 조사)

**결론: 가능.** 모든 대상 하네스가 (1) Agent Skills 표준(`<name>/SKILL.md` + `name`/`description` frontmatter), (2) 셸에서 `node` 실행을 지원합니다. 특히 **`.agents/skills/`** 는 Cursor·opencode·Codex·Pi·AGY 5개가 공통으로 읽으므로 스킬 원본 1벌로 대부분 해결됩니다. Claude Code만 `.claude/skills/` 복사(또는 심링크)가 필요합니다.

## 호환성 표
| 하네스 (박스 버전) | 프로젝트 스킬 | 슬래시 커맨드 | 서브에이전트 | 프로젝트 지침 | node 실행 |
|---|---|---|---|---|---|
| Cursor (cursor-agent 2026.10.01) | `.cursor/skills/`, **`.agents/skills/`** (+ `.claude/skills`, `.codex/skills` 호환) | 스킬이 `/skill-name` 으로 호출 | `.cursor/agents/*.md` (+ `.claude/agents`, `.codex/agents` 호환) | `AGENTS.md`, `.cursor/rules/*.mdc` | ✅ |
| opencode (1.19.0) | `.opencode/skills/`, **`.agents/skills/`**, `.claude/skills/` | `.opencode/commands/*.md` (또는 스킬 `metadata.opencode/slash: "true"`) | `.opencode/agents/*.md` | `AGENTS.md` (+ `opencode.json` `instructions`) | ✅ |
| Codex CLI (0.149.1) | **`.agents/skills/`** (cwd→repo root), `~/.agents/skills` | `~/.codex/prompts` **v0.117에서 제거됨** → 스킬을 `$name` 또는 `/skills`로 호출 | ⚠️ 미검증 (`.codex/agents/` 존재 — Cursor 문서가 호환 경로로 언급) | `AGENTS.md` (32KiB 한도) | ✅ |
| Pi (pi-mono; 박스에 미설치) | `.pi/skills/`, **`.agents/skills/`** (프로젝트 trust 필요) | `.pi/prompts/*.md` → `/name`; 스킬은 `/skill:name` | ❌ 내장 없음 (extension으로 구현 가능, 미검증) | `AGENTS.md` 또는 `CLAUDE.md`, `.pi/APPEND_SYSTEM.md` | ✅ |
| AGY / Antigravity (agy 1.3.4) | **`.agents/skills/`** (`.agent/skills` 레거시) | 스킬이 자동으로 `/name` | 플러그인 `agents/` (`~/.gemini/antigravity-cli/plugins/<p>/agents/`) — 형식 미검증 | `AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md` | ✅ |
| Claude Code (박스에 미설치) | `.claude/skills/` 만 | `.claude/commands/*.md` | `.claude/agents/*.md` | `CLAUDE.md` (AGENTS.md 직접 안 읽음 → `CLAUDE.md`에 `@AGENTS.md` 한 줄) | ✅ |

주의: AGY의 레거시 Workflows(`.agents/workflows/`)는 **2026-10-19 종료** 예정 → 스킬로만 배포해야 함.

## 결과 정리
- **스킬**: `.agents/skills/` 하나로 Claude 외 전부 커버됨. 단계별 스킬 = 그래프 노드 지침.
- **커맨드**: 하네스마다 형식이 제일 다른 부분. Cursor·AGY·Codex는 스킬 자체가 커맨드라 별도 파일이 필요 없음. opencode·Pi·Claude만 얇은 래퍼(`/cursor-atomic-plan` → "스킬 X를 로드해 실행")를 생성하면 됨.
- **서브에이전트**: 모양이 제일 제각각이라 **선택 기능**으로 두는 게 맞음. 역할 정의는 중립 `agents/*.md`에 두고 Cursor/opencode/Claude에만 변환. 서브에이전트가 없는 하네스(Pi, Codex 미검증)는 같은 역할 지침을 메인 세션이 순차로 읽거나, 기존 `invoke-worker.mjs`/cli-delegate로 외부 CLI를 호출하게 함.
- **.mjs**: Node >=22.13만 있으면 전부 동일하게 동작. 상태(`state.json`)·메모리·다음 노드 판단을 여기서 하므로 하네스를 바꿔도 이어서 작업 가능.
- **스킬 frontmatter**: 공통 최소값 `name`(소문자-하이픈, 폴더명과 일치), `description`만 사용. `disable-model-invocation` 같은 하네스 전용 필드는 쓰지 않음 (이전 lite 버그 재발 방지). 하네스 전용 메타데이터는 `metadata:` 아래 문자열로만.

## 미검증 / 불확실
- Codex 프로젝트 서브에이전트 형식(`.codex/agents/` md vs toml) — 미검증.
- Pi 서브에이전트: 공식 기능 없음, extension 예제만 존재 추정 — 미검증. 박스에 pi 미설치로 실행 확인 못 함.
- AGY 플러그인 `agents/` 템플릿 형식 — 미검증.
- Claude Code 경로는 기존 지식 기반(이번에 웹 재확인 안 함).
- 로컬 CLI는 `--version`만 확인했고, 실제 스킬 로드 테스트는 안 함.

## 출처
- Cursor Skills: https://cursor.com/docs/skills , https://cursor.com/help/customization/skills
- Cursor Subagents: https://cursor.com/docs/subagents.md
- opencode Skills: https://opencode.ai/docs/skills/ ; 커맨드/에이전트 경로: https://github.com/anomalyco/opencode/blob/dev/packages/core/src/plugin/skill/customize-opencode.md
- Codex Skills: https://developers.openai.com/codex/skills ; AGENTS.md: https://developers.openai.com/codex/guides/agents-md ; Customization: https://developers.openai.com/codex/concepts/customization ; prompts 제거(비공식 정리): https://codex.danielvaughan.com/2026/04/10/migrating-custom-prompts-to-skills/
- Pi: https://pi.dev/docs/latest/configuration , https://pi.dev/docs/latest/prompt-templates , https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md
- Antigravity: https://antigravity.google/docs/skills/ , https://antigravity.google/docs/rules/ , https://antigravity.google/docs/cli/plugins/ , https://antigravity.google/docs/migration/workflows-to-skills/
