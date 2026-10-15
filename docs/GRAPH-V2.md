# Graph v2

v2 adds `version: 2` graphs with explicit `edges`, `defaults`, `limits`, `gates`, and `entry`, plus user-defined custom nodes. In this PR v2 is parsed and validated; per-node executor and custom nodes work with `run-stage`. The dynamic engine that follows edges arrives in a later PR.

## Schema reference

```yaml
version: 2
defaults: { executor: cursor-subagent, timeout: 900, max_visits: 3 }
limits: { max_steps: 30, max_loops: { execute: 3, spec: 2 } }
gates:
  merge: { always: true }
  ci: { match: [.github/workflows/**] }
entry: { default: router, by_class: { bug: explore, feature: spec, refactor: plan, trivial: lite, docs: spec } }
nodes:
  security-scan: { skill: security-scan, executor: opencode, timeout: 600, inputs: [diff], outputs: [SECURITY.md] }
edges:
  - { from: review, to: security-scan, on: pass }
```

- `version` must be `2`.
- `nodes` (required): map of node id (`/^[a-z][a-z0-9-]*$/`) to:
  - `skill` (string: skill name or relative path), `prompt` (string: relative path to a prompt `.md` file), `agent` (string), `executor` (one of `cursor-subagent, cursor-agent, cursor-sdk, agy, codex, opencode, pi, claude`), `timeout` (positive integer seconds), `mode` (string), `inputs` (string[]), `outputs` (string[]), `requires_approval` (string[] of gate ids from `gates` or `db, auth, merge, ci, deps`), `max_visits` (positive int), `terminal_hook` (bool), `description` (string), `readonly` (bool).
  - Unknown fields are warnings. A `model` key produces a warning (`model is ignored (model selection was removed)`) rather than an error. A node needs at least one of `skill`, `prompt`, `agent`; `skill` + `prompt` together is an error. `readonly` must be a boolean when present.
  - `defaults.executor/timeout/max_visits` fill nodes that omit them. A `defaults.model` key produces a warning (`model is ignored (model selection was removed)`) rather than an error.
- `limits`: `max_steps` (positive int), `max_loops` (map node id to positive int; nodes must exist).
- `gates`: map gate id to `{ match: string[] }` or `{ always: true }`.
- `entry`: `{ default: <node>, by_class: { bug|feature|refactor|trivial|docs: <node> } }`.
- `edges`: list of `{ from: <node>|"*", to: <node>|$user|$halt|$end|array, on: <outcome>|array, when?: string, priority?: int }`.

Outcomes: `pass, fail, spec_mismatch, needs_info, escalate, blocked, route, approved, rejected`.

Reserved targets: `$user, $halt, $end`.

Warnings: nodes unreachable from `entry.default` (BFS, `"*"` edges ignored); nodes with no outgoing edge.

## Custom nodes (graph.yaml only)

1. Add a node under `nodes:` with a `skill` (or `prompt`), e.g. `security-scan`.
2. Add edges that route into/out of it, e.g. `review -> security-scan` on `pass`, `security-scan -> test` on `pass`.
3. Create the skill file (e.g. `.agents/skills/security-scan/SKILL.md`) or prompt file.
4. Run `node scripts/lib/graph.mjs lint --repo <dir>` until there are no errors.
5. Run it with `node scripts/run-stage.mjs security-scan --repo <dir> --prompt "..."`.

Custom nodes without `agent` run as `worker`. With `readonly: true` they run as the read-only `reviewer` role instead. Prompt is built as: `Skill: <skill>` line, then prompt-file contents, then user prompt, then `Inputs:` / `Outputs:` lines, plus `Mode: read-only. Do not modify files; report findings only.` when `readonly` is true. `readonly: true` is enforced regardless of `agent`: any node (custom or built-in stage) with `readonly: true` runs as the `reviewer` role with the read-only mode line appended.

## Prompt file trust boundary

- `node.prompt` in `graph.yaml` must stay inside the repo: it is resolved with `assertInsideRepo`, which follows symlinks (nearest existing ancestor is realpath-resolved) and refuses paths escaping the repository or passing through a symlink. `--skill` scaffolds, `--prompt` scaffolds, and `graph.yaml`/`.bak` writes get the same check in `add-node`.
- `--prompt-file` in `scripts/run-stage.mjs` is a trusted CLI argument: any path is accepted (absolute or outside the repo), because the caller invoking the CLI explicitly chooses the file. Never confuse the two: graph-owned `node.prompt` is untrusted repo content, `--prompt-file` is an explicit operator choice.

## add-node command

```
node scripts/lib/graph.mjs add-node <id> --after <node> [--before <node>]
  [--skill <name>|--prompt <relpath>] [--executor <id>]
  [--timeout <s>] [--on pass] [--readonly] [--repo <dir>] [--dry-run]
```

- On a version 1 graph, auto-migrates: builds the v2 doc via `normalizeV1` (keeping node fields), writes a `graph.yaml.v1.bak` backup of the original, prints `migrated graph.yaml v1 -> v2 (backup: graph.yaml.v1.bak)`, then continues adding the node. `--dry-run` never writes files. `--readonly` sets `readonly: true` on the new node.
- v1 migration details (`normalizeV1`): the legacy `next` field is dropped (v2 uses `edges`); any router-like v1 node left without `skill`/`prompt`/`agent` — i.e. the default `router: { next: [lite, explore] }` or any node that only had `next` — gets `skill: atomic-router` so the migrated doc validates. v2 validation itself stays strict (every node still needs one of `skill`, `prompt`, `agent`); no skill-less exception was added. Typed v1 scalars are coerced during normalization (`timeout`/`max_visits` digit strings to numbers, `terminal_hook`/`readonly` `"true"`/`"false"` to booleans). Single kept edge targets collapse to a scalar `to: <node>`.
- The `.v1.bak` backup and the migration log happen only after validation succeeds (and never on `--dry-run` failure), so a failed `add-node` leaves no backup behind and never claims migration succeeded.
- Rewires every `from: <after>` edge whose `on` contains `--on` (default `pass`): with `--before` (a node id or reserved target such as `$end`), only edges targeting `--before`; without it, all such edges. Targets become `<id>`; a new `{ from: <id>, to: <old>, on: pass }` plus `{ from: <id>, to: <after>, on: fail }` is added. Edges whose `on` is an array with other outcomes are split so the other outcomes keep their original route. With no match, adds `{ from: <after>, to: <id>, on: <on> }` and `{ from: <id>, to: $end, on: pass }`; if `--before` was given but no edge links `<after>` to it, exits 1 without writing.
- Scaffolds `.agents/skills/<name>/SKILL.md` (default name = id) or the `--prompt` file when missing.
- Re-validates; refuses to write on errors. Keeps `graph.yaml.bak` (v1 migrations keep `graph.yaml.v1.bak` instead). `--dry-run` prints YAML only and writes nothing.
- Exit codes: 0 ok, 1 validation error, 2 usage.

## lint command

```
node scripts/lib/graph.mjs lint [--repo <dir>] [--json]
```

Prints `error:` / `warning:` lines (or JSON with `--json`). Exit 1 on errors, 0 otherwise.

## Validation error examples

```
graph.yaml: nodes.security-scan.executor "foo" is not one of cursor-subagent, cursor-agent, ...
graph.yaml: edges[3].to "plann" is not a defined node (did you mean "plan"?)
graph.yaml: edges[0].on "bogus" is not a known outcome (must be one of pass, fail, ...)
graph.yaml: nodes.my-node cannot have both skill and prompt
graph.yaml: nodes.my-node must have at least one of skill, prompt, agent
graph.yaml: nodes.my-node.timeout must be a positive integer seconds
graph.yaml: nodes.my-node.requires_approval "x" is not a defined gate (...)
graph.yaml: limits.max_loops."nope" is not a defined node
graph.yaml: node "orphan" is unreachable from entry.default "router"
```
