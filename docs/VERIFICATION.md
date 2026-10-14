# Verification checklist (universal-harness)

Run with Node >=22.13. Use an isolated `CURSOR_ATOMIC_WORKFLOW_HOME` and a scratch git repo. Each step has a hard timeout (model steps 15 min). Record PASS/FAIL + evidence (log path, file produced).

Priority harnesses: **agy** (cheap Flash model) and **cursor-agent** (composer-2.5). opencode: filesystem/listing only (no model calls). Claude Code: generated files only (optional harness).

## A. Package / CI
- [ ] A1 `npm test` green
- [ ] A2 `node scripts/check-agents.mjs`
- [ ] A3 `node scripts/sync-bundled.mjs --check`
- [ ] A4 GitHub Actions CI green on branch head

## B. Install / doctor (per harness: cursor, opencode, agy, claude[optional], codex, pi)
- [ ] B1 fresh install exit 0; files land (`.agents/skills` x24, `.atomic/scripts`, `.atomic/graph.yaml`, `AGENTS.md` marker block, harness extras)
- [ ] B2 `node .atomic/scripts/doctor.mjs --harness <h> --target .` exit 0
- [ ] B3 `--migrate` removes legacy `.cursor/skills/cursor-atomic-*`
- [ ] B4 `--harness all` does NOT install Claude; `--with-claude` does (`.claude/{skills,commands,agents}`, `CLAUDE.md` with `@AGENTS.md`)
- [ ] B5 doctor fails clearly on Node <22.13
- [ ] B6 CLI lists skills: cursor-agent, agy (prompted listing), opencode (`opencode debug skill`, `opencode agent list`)

## C. Skills end-to-end (each harness: agy, cursor-agent) — all 24
Workflow: cursor-atomic-workflow (router), cursor-atomic-lite, cursor-atomic-explore, cursor-atomic-plan (incl. plan-review), cursor-atomic-task, cursor-atomic-execute, cursor-atomic-run, cursor-atomic-review, cursor-atomic-wrapup
Utility: cursor-atomic-status, cursor-atomic-config, cursor-atomic-settings, cursor-atomic-models, cursor-atomic-doctor, cursor-atomic-agy, cursor-atomic-delegate
General: code-review, codebase-design, domain-modeling, grill-me, grilling, tdd, to-tickets, wayfinder
- [ ] C1 lite: small task -> PLAN file written, code+test changed, tests pass, memory proposed
- [ ] C2 full: explore -> plan -> plan-review -> task -> execute/run -> review -> wrapup produce EXPLORE/PLAN/PLAN-REVIEW/TASKS/REVIEW docs, STATUS updated, tests pass
- [ ] C3 utility skills each run without error (status/config/settings/models/doctor print expected output; agy/delegate produce a valid worker invocation, dry-run)
- [ ] C4 general skills load and produce their first step (non-interactive)

## D. Memory
- [ ] D1 `memory.mjs repo` / `context <shortRepo>` / `propose --auto` via installed scripts
- [ ] D2 save in agy session -> visible in cursor-agent session (`context`)
- [ ] D3 save in cursor-agent -> visible in agy
- [ ] D4 reload in a new session of the same harness

## E. State / graph
- [ ] E1 `work-status.mjs list|show|sync` reflect phases after each stage
- [ ] E2 `run-done.mjs "<cmd>" <log>` writes `.done.json` with exit code (pass and fail case)

## F. Router / escalation
- [ ] F1 small task, no mode named -> agent states "lite" + reason in one line
- [ ] F2 large task (DB/auth/5+ files) -> "full" + reason
- [ ] F3 lite mid-task discovers bigger scope -> stops & recommends full
- [ ] F4 explicit command overrides router

## Results — 2026-10-14 (box, Node v22.23.3, agy `gemini-3.8-flash-high`, cursor-agent `composer-2.5`)
Scratch repos: tiny `calc` npm project; isolated `CURSOR_ATOMIC_WORKFLOW_HOME`; per-step timeout 600–900 s.

| Item | agy | cursor-agent | Evidence / notes |
|---|---|---|---|
| A1–A4 npm test / check-agents / sync-bundled / CI | PASS (223 tests) | — | CI green on 95ec4a9 |
| B1–B2 install + doctor (cursor, opencode, agy, codex, pi, claude) | PASS | PASS | all 6 harnesses exit 0, 24 skills, AGENTS.md marker |
| B3 --migrate | PASS | PASS | legacy `.cursor/skills/cursor-atomic-*` removed |
| B4 claude optional | PASS | PASS | `all` → no `.claude`; `--with-claude` → `.claude/*` + `CLAUDE.md` `@AGENTS.md` |
| B5 doctor on Node 20 | PASS | PASS | exit 1 with clear `Node >=22.13 required` |
| B6 skill listing | PASS (24) | PASS (24) | opencode: `debug skill` 24 + 9 subagents (no model calls) |
| C1 lite (router) | PASS | PASS | router printed `lite` + reason; PLAN + STATUS; tests pass |
| C2 full explore→wrapup | PASS | PASS | EXPLORE/PLAN/PLAN-REVIEW/TASKS/REVIEW, STATUS `complete`, local commit, tests pass |
| C3 utility (status, config, settings, models, doctor, agy, delegate, run) | PASS | PASS* | *one-shot batch timed out; split batches pass. doctor correctly FAILs under cursor-agent shell using system Node 20 |
| C4 general (code-review, codebase-design, domain-modeling, grill-me, grilling, tdd, to-tickets, wayfinder) | PASS | PASS | first step of each executed |
| D1 memory repo/context/propose | PASS | PASS | test + E2E |
| D2/D3 cross-harness memory | PASS | PASS | agy saved `marker A1` → cursor read; cursor saved `marker C1` → agy read (new sessions, same repo) |
| E1 work-status list/show/sync/path | PASS | PASS | phases updated by skills |
| E2 run-done pass/fail | PASS | PASS | `.done.json` ok/exitCode correct |
| F1 router → lite | PASS | PASS | |
| F2 router → full (DB/auth) | PASS | PASS | |
| F3 lite escalation | PASS | PASS | stops and recommends full (when told not to auto-approve) |
| F4 explicit command overrides | PASS | PASS | `/cursor-atomic-explore`, `/cursor-atomic-lite` honored |

Bugs found & fixed: docs paths hardcoded `~/.cursor-atomic-workflow` (agents ignored `CURSOR_ATOMIC_WORKFLOW_HOME`) → added `work-status.mjs path <slug>` and `<docsDir>` in skills/agents (6f6cb53); doctor `--harness` reset the Node failure (a831095).
Known: agy network timeouts (retryable) on first attempts; agy may create `GEMINI.md` in repo; cursor-agent shells may use system Node (<22.13) unless PATH is set.
