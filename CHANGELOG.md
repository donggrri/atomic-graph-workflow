# Changelog

## Unreleased

### Added

- **Hermes Agent harness** (`--harness hermes`): installs skills under `.hermes/skills/` (command + role skills), `atomic-hermes-delegate` skill, `hermes-delegate.mjs` stage router, `hermes` pipeline executor, and doctor checks (`hermes --version`, `hermes status`, `.hermes.md` warning, `hermes skills trust` reminder).
- **Hermes delegation routing**: default stages use `cursor-agent` only (`agy` via explicit graph/env overrides); opencode runner with single-run lock for fallbacks; `hermes.fallback: false` / per-stage fallback disable; failure detection for empty stdout and permission-denied stderr; orchestrator docs recommend `grok-4.7-medium`.

### Breaking / migration

- Removed installed `cursor-atomic-*` aliases; use `atomic-*` skills and commands.
- Workflow home: `~/.atomic-workflow` (auto-migrate from `~/.cursor-atomic-workflow`).
- Project settings: `.atomic-workflow.json` (read fallback: `.cursor-atomic-workflow.json`).
- Environment: `ATOMIC_*` (read fallback: `CURSOR_ATOMIC_*`).
- Default `graph.yaml` is version 2; Linux/macOS only (`invoke-worker.sh`, no `.ps1` workers).
