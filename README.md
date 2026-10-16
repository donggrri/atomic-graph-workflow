English | [한국어](README.kr.md)

# atomic-workflow

Harness-neutral Atomic Workflow. Technical identifiers stay `atomic-*`.

Atomic explore → plan → task → execute → review workflow for Cursor, AGY, Claude Code, OpenCode, Codex, Pi, and Hermes Agent.
`/atomic-explore` (optional) → `/atomic-plan` → `/atomic-task` → `/atomic-execute` → `/atomic-review` → `/atomic-wrapup`

Slash commands keep the `atomic-` prefix. The repository is **harness-neutral** (Cursor, opencode, Codex, Pi, AGY; Claude Code optional).

---

## Table of contents

1. [What this package installs](#1-what-this-package-installs)
2. [Install into a project](#2-install-into-a-project)
3. [Usage](#3-usage)
4. [Automated pipeline runner](#4-automated-pipeline-runner)
5. [Models and roles](#5-models-and-roles)
6. [Don'ts](#6-donts)
7. [Bundled upstream skills](#7-bundled-upstream-skills)
8. [Maintaining this package](#8-maintaining-this-package)
9. [Future work](#9-future-work)

---

## 1. What this package installs

Source in this repo (harness-neutral):

| Component | Source | Role |
|---|---|---|
| Skills | `skills/atomic-*/SKILL.md` | Slash/command logic (`name` + `description` frontmatter only) |
| Workflow skill | `skills/atomic-workflow/` | Orchestration docs + `references/harness.md` |
| Subagents | `agents/*.md` | 8 agents: `explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `atomic-reviewer`, `tester`, `cli-delegate` (+ `memory-curator`); generated per harness on install |
| Commands (shims) | `commands/*.md` | opencode / Pi / Claude thin wrappers |
| Engine | `scripts/*.mjs` | Copied once to `<target>/.atomic/scripts/` on install |

Into a target project (example: Cursor):

| Component | Location | Role |
|---|---|---|
| Skills | `.agents/skills/` | Shared across Cursor, opencode, Codex, Pi, AGY |
| Runtime | `.atomic/scripts/`, `.atomic/graph.yaml` | `work-status`, `run-done`, `memory`, pipeline helpers |
| Cursor agents | `.cursor/agents/*.md` | Harness-specific copies of the neutral role instructions |
| Router rule | `.cursor/rules/atomic-router.mdc` | Main-chat lite vs full routing |
| Instructions | `AGENTS.md` (marker block) | Harness-agnostic entry |

Requires Node `>=22.13`. `@cursor/sdk` is an optional dependency at the package root and powers the SDK adapter of the pipeline runner.

The bundled upstream skills snapshot records its source, revision, and MIT license in `THIRD_PARTY_LICENSES/mattpocock-skills-*`.

---

## 2. Install into a project

From this repository (or an installed npm package directory), run:

```bash
npx github:donggrri/atomic-graph-workflow --target /path/to/project --harness auto --yes
# or from a clone: node scripts/install.mjs --target /path/to/project --harness auto
```

| Option | Meaning |
|---|---|
| `--target <dir>` | Target project (default: current directory) |
| `--harness <list>` | `auto`, `cursor`, `opencode`, `codex`, `pi`, `agy`, `claude`, `hermes`, `all` (comma-separated). `auto`/`all` omit Claude unless `--with-claude` |
| `--migrate` | Replace old `.agents/skills/atomic-*` installs with thin aliases (backup legacy `.cursor/skills/atomic-*`) |
| `--force` | Regenerate existing generated files from the package source (agent files carry no model pin) |
| `--with-claude` | Include Claude Code (`.claude/*`, `CLAUDE.md` with `@AGENTS.md`) |
| `--yes`, `-y` | Non-interactive defaults (TTY without `--yes` opens the checkbox installer) |
| `--dry-run` | Print what would be created |
| `--skip-doctor` | Skip post-install doctor |
| `-h, --help` | Help |

After install, run **`/atomic-setup`** in your agent to write `.atomic-workflow.json` (AGY stages, `testDone`, per-stage `executors`, gitignore policy).

`run-pipeline.mjs` and `run-stage.mjs` read `.atomic/graph.yaml` for each stage’s default `executor`. Project `executors` in `.atomic-workflow.json` override the graph. Supported executors: `cursor-subagent`, `cursor-agent`, `cursor-sdk` (explicit opt-in only; it requires a configured SDK model), `agy`, `codex`, `opencode`, `pi` (headless `pi -p`), `claude`, `hermes` (headless `hermes chat --oneshot`). The model-neutral default is `cursor-subagent`; missing CLIs/SDK fall back at runtime (`run-stage` logs to stderr); doctor warns. External CLIs can be pre-approved via `trustedExecutors` or interactive trust (per-repo hash). Optional `executorTimeouts` maps stage ids (`lite`, `explore`, `plan`, …) to timeout minutes (default 45).

**Hermes** (`--harness hermes`): skills install to `.hermes/skills/` (not `.agents/skills`). Command and role skills are generated on install; run `hermes skills trust` in the repo afterward. The **orchestrator** (parent Hermes session) should use the `hermes-cursor-provider` bridge with `model.default: grok-4.7-medium` in `~/.hermes/config.yaml` (install prints a reminder only; it does not edit user config). Never use `*fast*` orchestrator models. Hermes workflows delegate stages via `node .atomic/scripts/hermes-delegate.mjs` (see `atomic-hermes-delegate` skill). Do not create `.hermes.md` (it shadows `AGENTS.md`). Stage routing defaults to `cursor-agent` with per-stage models (`agy` only when explicitly set in `graph.yaml` or `ATOMIC_HERMES_ROUTING`). Override in `.atomic/graph.yaml` (`nodes.<stage>.executor` / `model`, or `hermes.routing`), or `ATOMIC_HERMES_ROUTING` JSON. Disable fallbacks with `hermes.fallback: false` or per-stage `fallback: false`. Allowed `cursor-agent` model ids: `composer-2.5`, `claude-haiku-5-5-high`, `claude-sonnet-5-5-high`, `grok-4.7-high`; fallbacks use `opencode` (`opencode/deepseek-v4.1-flash-free`, `opencode/glm-5.3-flash-free`) with a repo lock. Defaults: explore/test → haiku; implement/docs → composer-2.5; plan/spec/review → sonnet; plan-review/spec-review/escalate → grok-4.7-high.

**AGY policy vs per-stage executors:** `agy.plan` / `agy.implement` / `agy.review` control whether the pipeline *asks* to delegate to AGY (`ask`), runs Cursor SDK roles (`sdk`), or stops for parent `/atomic-agy` (`agy`). When a policy is `agy` and you have **not** set an explicit `executors.<stage>`, the runner fills matching graph stages with executor `agy` (`plan` → `explore`, `plan`, `plan-review`; `implement` → `task`, `execute`; `review` → `review`, `wrapup`). Explicit `executors` always win. Headless stage runs: `node .atomic/scripts/run-stage.mjs <stage> --repo . --slug <slug> --prompt-file <brief.md>` (explore, plan, lite, memory, …).

Paste prompt for an installing agent: [INSTALL_PROMPT.md](INSTALL_PROMPT.md).

```bash
node scripts/install.mjs --target /path/to/project --harness cursor,opencode --migrate --force
```

Verify:

```bash
node .atomic/scripts/doctor.mjs --harness auto --target .
node scripts/check-agents.mjs   # source agents/ vs scripts/lib/roles.mjs
node scripts/sync-bundled.mjs --check   # maintainer: scripts/ vs .atomic/scripts/
```

---

## 3. Usage

### Migration from `cursor-atomic-*` (v0.2+)

Public names are `atomic-*` only (for example `/atomic-plan`). Reinstall removes installed `cursor-atomic-*` skill, command, and agent aliases. Workflow home is `~/.atomic-workflow` (one-time migrate from `~/.cursor-atomic-workflow`). Project settings use `.atomic-workflow.json` (read-only fallback to `.cursor-atomic-workflow.json`). Environment variables use `ATOMIC_*`; `CURSOR_ATOMIC_*` is read as fallback only. See `CHANGELOG.md`.

### Lite vs full workflow

| | `/atomic-lite` | Full `/atomic-*` pipeline |
|---|---|---|
| Session | One parent session, **no subagents** | Explore → plan-review → task → worker → reviewer → tester (Task subagents or SDK runner) |
| Best for | Small, bounded changes (typically **&lt;5 files**), no schema/auth/security work | Multi-file refactors, DB migrations, security, large plans, parallel workers |
| Artifacts | Short `PLAN-<slug>.md` only (same global docs home) | `EXPLORE`, `PLAN`, `PLAN-REVIEW`, `TASKS`, `REVIEW`, evidence |
| Memory | `memory.mjs repo .` then `context <shortRepo>` at start; `propose --auto <file.json>` at end | Same vault; optional `memory-curator` / pipeline capture |
| Finish | Run tests vs plan done criteria; short summary | `/atomic-wrapup` for commit + STATUS |

If lite hits **5+ files**, **DB/schema**, **auth/security**, or the plan outgrows a short list, stop and switch to `/atomic-plan` or `/atomic-run`.

**Main chat (no slash command):** `install.mjs` copies `.cursor/rules/atomic-router.mdc` (`alwaysApply`). The agent judges lite vs full using the same signals (plus cross-module design and unclear requirements → full; small, local, well-specified → lite), posts one line `라우팅: lite|full (이유: …)`, and honors an explicit `/atomic-*` override. Details: workflow skill 「메인 채팅 라우팅」 and `references/routing.md`.

Default full path: once **PLAN is confirmed**, the pipeline runner runs **plan-review** (critical PLAN critique) → task → execute → review automatically. Commit only happens with `/atomic-wrapup`.

| Command | Role | Output |
|---|---|---|
| `/atomic-lite` | Single-session plan → implement → memory → test wrapup (no subagents) | `~/.atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md` |
| `/atomic-explore` | Phase 0: explore the codebase and tech in advance (optional) | `~/.atomic-workflow/docs/{shortRepo}/{slug}/EXPLORE-<slug>.md` (legacy: `.docs/<slug>/`) |
| `/atomic-plan` | Default pipeline after Phase 1 | `~/.atomic-workflow/docs/{shortRepo}/{slug}/PLAN-<slug>.md` + TASKS/code/REVIEW automatically |
| `/atomic-task` | Force Phase 2 only, or continue automatically | `~/.atomic-workflow/docs/{shortRepo}/{slug}/TASKS-<slug>.md` |
| `/atomic-execute` | Force Phase 3 only, or continue automatically | code changes + checked-off TASKS |
| `/atomic-delegate` | Phase 3: delegate to a specific worker | same |
| `/atomic-agy` | Delegate a user request to agy headless (plan: plan doc only, implement: code) | plan file under .cursor/plans/ or code changes |
| `/atomic-review` | Phase 4 | `~/.atomic-workflow/docs/{shortRepo}/{slug}/REVIEW-<slug>.md` |
| `/atomic-wrapup` | Phase 5: wrapup (commit, no push) | git commit + STATUS |
| `/atomic-run` | Explicit pipeline entry: skip triage and run the workflow from explore | same as plan |
| `/atomic-status` | Progress report (`npm run status` / `STATUS.json`) | text summary / table |
| `/atomic-config` | Show or change the workflow home (`/atomic-settings`) | text/interactive settings |
| `/atomic-models` | Stage roles and model policy guide (read-only) | text guide |
| `/atomic-doctor` | Diagnose skill collisions, YAML frontmatter syntax, and apply auto-fix | text report / auto-fix |

Artifacts live under `~/.atomic-workflow/docs/{shortRepo}/{slug}/` (override the home with `ATOMIC_WORKFLOW_HOME`).

Docs location (`docsRoot` in `.atomic-workflow.json`): `home` (default global home) or a repo-relative path (e.g. `specs`). The project file must stay inside the repository: values with a `..` segment are rejected, and absolute (or `~`-leading) values are ignored with a warning — put an absolute path in global settings (`~/.atomic-workflow/settings.json` `docsRoot`) instead. `runs/`, `memory/`, and `evidence/` always stay in the workflow home. artifacts: specs/ is inside the repo; commit it with your code (do not add it to .gitignore).

If PLAN has blocking questions (security, scope, data loss), it stops there. To write a plan only, use `/atomic-plan 계획만`.

---

## 4. Automated pipeline runner

`scripts/run-pipeline.mjs` runs the phases headlessly instead of driving them from a chat session:

```bash
node scripts/run-pipeline.mjs <slug> [--auto] [--resume] [--adapter sdk|task-card] [--profile <id>] [--repo <dir>] [--dry-run]
```

- The default adapter is model-neutral `task-card`; it leaves `next-card.json` for the parent session to execute and `--resume`. `--adapter sdk` is an explicit opt-in for `@cursor/sdk` and requires an SDK model supplied by the caller; it does not select a model. After the cost gate, **plan-review** runs `plan-reviewer` (writes `PLAN-REVIEW-<slug>.md`); blocking defects trigger one planner auto-revision and re-review, then exit `20` if defects remain. On **Review** entry (initial and after rework), exit `10` may be a **`kind: "bugbot"`** card first: the parent runs Cursor `bugbot`, saves output to `~/.atomic-workflow/runs/{shortRepo}/{slug}/bugbot-findings.md` (or a `# BUGBOT_FAILED` marker on failure), then `--resume` before the reviewer runs.
- The log lives at `~/.atomic-workflow/runs/{shortRepo}/{slug}/pipeline.log`; per-step command logs get a `.done.json` summary next to them. Every role logs `▶ [phase] role started` and `■ [phase] role done · Ns`, plus nested subagent/status lines (`tail -f pipeline.log` to follow). Set `ATOMIC_PROGRESS=tools` to also log each tool call.
- `--resume` retries failed items (already checked items stay done).
- `--profile <id>` swaps only the plan and test instructions. Omit it and the runner uses the project file `.atomic-workflow.json`, then `~/.atomic-workflow/settings.json`, then `atomic`. PLAN, TASKS, and REVIEW stay under `~/.atomic-workflow/docs/{shortRepo}/{slug}/`. A profile JSON lives in `profiles/<id>.json` (package), `~/.atomic-workflow/profiles/<id>.json`, or the repo `profiles/<id>.json`. Later locations win. Do not put secrets in that JSON. `profiles/bsp.json.example` is a template with placeholder paths: copy it to `profiles/<id>.json` or `~/.atomic-workflow/profiles/<id>.json` and point `command` at your own files. Names ending in `.example.json` or `.json.example` are not loaded.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Pipeline finished |
| 2 | Usage error |
| 10 | Parent action required (bugbot pre-review card, task-card hand-off, or cli-delegate) |
| 20 | Human gate (PLAN approval, plan-review blocking defects after auto-revision, cost ack, …) |
| 30 | A task item failed, or plan-review step failed (missing/malformed PLAN-REVIEW) |
| 40 | Defects remained after the one rework round |
| 50 | Startup failure |

---

## 5. Models and roles

The workflow **does not choose a model.** Subagents, headless CLIs (`cursor-agent`, `agy`, ...) and the parent session all use the default model of their own harness; change it in that harness. Subagent calls carry no `model`, agent files have no `model` frontmatter, and `--set-model` / `invoke-worker --model` / `agyModel` / `executors.<stage>.model` are gone (a legacy value in settings is ignored with a warning; the two flags fail before anything is written).

Every stage runs on **one generic subagent** of the active harness. The role (`explorer`, `planner`, `plan-reviewer`, `tasker`, `worker`, `reviewer`, `tester`, `cli-delegate`) is a prompt contract in `.atomic/agents/<role>.md`, and the parent puts its path, the required skills, `docsDir`, and the deliverable into the call prompt. A harness without subagents (Pi) has the parent session run the same instructions in order. Independent review comes from a fresh context plus evidence (PLAN, TASKS, diff, tests), not from a different model family.

| Harness | Subagent tool verified | Notes |
|---|---|---|
| Claude Code | `Agent` (`general-purpose`) | omit `subagent_type` for the generic agent |
| Cursor | `Task` | model chosen by Cursor |
| AGY | `invoke_subagent` | also called when only a rule asks for it |
| OpenCode | `subagent` (`agent: general`) | name `general`, the model may pick `explore` otherwise |
| Pi | none | parent runs the roles sequentially |

### Headless delegation (`cursor-agent`, `agy`)

Stages that edit code (`lite`, `execute`) run the CLI with its full-permission flags (`cursor-agent --force --trust`, `agy --dangerously-skip-permissions`). Every other stage (explore, plan, plan-review, task, review, wrapup, memory) runs the same CLI the same way, but its prompt starts with a **FORBID block** that bans edits to product files, git state changes, installs and builds, and limits writes to the stage deliverable. This is a prompt rule, not a sandbox. `cursor-agent` now asks for the same per-repo trust confirmation as the other CLIs (`trustedExecutors`, `ATOMIC_TRUST_COMMANDS=1`).

---

## 6. Don'ts

- **No push**: `git push` only when you explicitly want it. The agent does not push.
- **No secrets**: Do not commit tokens, API keys, or `.env`, and do not put them in worker briefs.
- **Full permissions**: headless `cursor-agent` and `agy` runs bypass permission prompts. Only stages that must edit code are meant to; the others are held back by the FORBID prompt rule, so use them in repositories you trust.
- **Do not edit installed package files casually**: installed harness agent copies and skills are overwritten by `--force` reinstalls and package updates. Keep changes in this repository and reinstall.

---

## 7. Bundled upstream skills

Installing this package also installs the skills below, so they are discovered immediately — no separate skill-manager setup needed.

| Phase | Who runs it | Required skills |
|---|---|---|
| plan preflight | parent orchestrator | `grilling`, `domain-modeling`, `codebase-design`, `wayfinder` |
| plan | `planner` | the same skills + `atomic-workflow` |
| task | `tasker` | `to-tickets` (output is `TASKS-<slug>.md`) |
| execute | `worker` | `tdd` |
| review | `reviewer` | `code-review` (two axes, no grandchildren) |

`grill-me` and `wayfinder` are upstream user-invoked orchestrators with `disable-model-invocation: true`. So `/atomic-plan` reads and runs the model-invoked `grilling` skill that `grill-me` would otherwise delegate, at the parent stage. Large work is classified as tracker-less `local-wayfinding` by default. The upstream `wayfinder` tracker flow is used only when the user asks for it.

The bundled snapshot's source repository, revision, and MIT license are recorded in `THIRD_PARTY_LICENSES/mattpocock-skills-*`. When you refresh upstream, update the selected directories together and run `npm test` to verify agent references.

---

## 8. Maintaining this package

Edit `skills/` and `agents/` in place. Runtime scripts under `scripts/` are mirrored to `.atomic/scripts/` (and the maintainer copy in this repo) via `node scripts/sync-bundled.mjs`.

| Change | Edit |
|---|---|
| Command behavior | `skills/atomic-<name>/SKILL.md` |
| Agent role instructions (no model) | `agents/<agent>.md` (+ `scripts/lib/roles.mjs`) |
| Harness differences | `skills/atomic-workflow/references/harness.md` |
| Workflow scripts | `scripts/*.mjs` → `node scripts/sync-bundled.mjs` → `.atomic/scripts/` |

```bash
npm test                              # structure, agent, artifact-path and bundled-script sync tests
node scripts/sync-bundled.mjs --check # fail if the skill copies drifted
node scripts/doctor.mjs               # collisions, YAML frontmatter, sync + install state
```

To add a command, create `skills/atomic-<name>/SKILL.md` with `name` and `description` frontmatter only, add `commands/atomic-<name>.md` if opencode/Pi/Claude need a shim, then run `npm test`.

---

## 9. Future work

These items are documented only. They are not implemented in this package yet. Priorities live in [ROADMAP.md](ROADMAP.md) (Korean). ROADMAP marks the sections that still describe the pre-rewrite multi-harness layout.

- **Parallel worktree integration**: there is no merge step for sibling worktrees.

Pull requests and pushes to the default branch (`main`) run GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). The job uses Node 22, which satisfies `engines.node` (`>=22.13`), installs dependencies with `npm ci`, and runs:

- `npm test` (`node --test tests/*.test.mjs`)
- `node scripts/check-agents.mjs` (agent frontmatter models match `scripts/lib/roles.mjs`)
- `node scripts/sync-bundled.mjs --check` (skill copies of `work-status.mjs`, `run-done.mjs`, and `memory.mjs` match `scripts/`)
- a repository-local doctor check: `node scripts/doctor.mjs --json`, which fails the job when bundled scripts are out of sync or a `SKILL.md` in this repository has an unsafe YAML description

CI does not run these:

- **`node scripts/run-pipeline.mjs`**: the SDK adapter starts a Cursor agent and needs Cursor SDK credentials. `--adapter task-card` writes a local pipeline run. `--dry-run` still needs a slug. None of those is a repository check.
- **Live `invoke-worker.sh` / `ensure-workers.sh`**: they need the external CLIs `agy`, `opencode`, `codex`, or `claude`. `npm test` covers the scripts without those binaries. `--dry-run` logs the command line and does not need the CLI on `PATH`.
- **Doctor's global skill-collision scan**: `doctor` also reads `~/.agents/skills` and `~/.cursor/skills` on the machine running it. CI ignores that part. `doctor` exits 0 when it only prints warnings, so the workflow applies the repository-local failures above.
