# Changelog

## Unreleased

### Added

- **Hermes Agent harness** (`--harness hermes`): installs skills under `.hermes/skills/` (command + role skills), `atomic-hermes-delegate` skill, `hermes-delegate.mjs` stage router, `hermes` pipeline executor, and doctor checks (`hermes --version`, `hermes status`, `.hermes.md` warning, `hermes skills trust` reminder).

### Breaking / migration

- Removed installed `cursor-atomic-*` aliases; use `atomic-*` skills and commands.
- Workflow home: `~/.atomic-workflow` (auto-migrate from `~/.cursor-atomic-workflow`).
- Project settings: `.atomic-workflow.json` (read fallback: `.cursor-atomic-workflow.json`).
- Environment: `ATOMIC_*` (read fallback: `CURSOR_ATOMIC_*`).
- Default `graph.yaml` is version 2; Linux/macOS only (`invoke-worker.sh`, no `.ps1` workers).
