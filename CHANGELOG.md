# Changelog

## Unreleased

### Breaking / migration

- Removed installed `cursor-atomic-*` aliases; use `atomic-*` skills and commands.
- Workflow home: `~/.atomic-workflow` (auto-migrate from `~/.cursor-atomic-workflow`).
- Project settings: `.atomic-workflow.json` (read fallback: `.cursor-atomic-workflow.json`).
- Environment: `ATOMIC_*` (read fallback: `CURSOR_ATOMIC_*`).
- Default `graph.yaml` is version 2; Linux/macOS only (`invoke-worker.sh`, no `.ps1` workers).
