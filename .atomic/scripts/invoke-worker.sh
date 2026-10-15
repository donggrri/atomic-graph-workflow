#!/usr/bin/env bash
# atomic-workflow: run agy / opencode / codex / claude headlessly.
set -euo pipefail

WORKER=""
WORKSPACE=""
PROMPT_FILE=""
LOG_FILE=""
TIMEOUT_MIN=45
SKILLS=""
SKILLS_FILE=""
DRY_RUN=0

ATOMIC_SKILL_ROOT="${ATOMIC_SKILL_ROOT:-$HOME/.agents/skills/atomic-workflow}"

usage() {
  cat <<'EOF'
Usage: invoke-worker.sh --worker <name> --workspace <path> --prompt-file <path> --log-file <path> [--timeout-min N] [--skills a,b] [--skills-file path] [--dry-run]
Workers: agy, opencode, codex, claude
The workflow sets no model: each CLI uses its own default (configure it in the CLI).
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

resolve_bin() {
  local names=("$@")
  local name
  for name in "${names[@]}"; do
    if command -v "$name" >/dev/null 2>&1; then
      command -v "$name"
      return 0
    fi
  done
  return 1
}

find_skill_root() {
  local ws="$1"
  local dir="$ws"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.agents/skills" ]]; then
      echo "$dir/.agents/skills"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  if [[ -d "$ATOMIC_SKILL_ROOT" ]]; then
    dirname "$ATOMIC_SKILL_ROOT"
    return 0
  fi
  return 1
}

merge_skills_csv() {
  local base="$1" extra="$2"
  if [[ -z "$base" ]]; then
    echo "$extra"
  elif [[ -z "$extra" ]]; then
    echo "$base"
  else
    echo "$base,$extra"
  fi
}

build_skills_block() {
  local ws="$1" skills_csv="$2"
  local skill_root block=""
  skill_root="$(find_skill_root "$ws" || true)"
  [[ -n "$skills_csv" && -n "$skill_root" ]] || return 0
  block="MUST read skills (first tool calls):"
  local name
  IFS=',' read -ra names <<< "$skills_csv"
  for name in "${names[@]}"; do
    name="${name// /}"
    [[ -n "$name" ]] || continue
    local skill_file="$skill_root/$name/SKILL.md"
    if [[ -f "$skill_file" ]]; then
      block+=$'\n'"- $skill_file"
    fi
  done
  if [[ "$block" == "MUST read skills (first tool calls):" ]]; then
    return 0
  fi
  printf '%s\n\n' "$block"
}

skill_parent_dirs() {
  local ws="$1" skills_csv="$2"
  local -A seen=()
  local skill_root dir name
  skill_root="$(find_skill_root "$ws" || true)"
  local -a dirs=("$ws")
  seen["$ws"]=1
  if [[ -d "$ws/.atomic" && -z "${seen[$ws/.atomic]:-}" ]]; then
    dirs+=("$ws/.atomic")
    seen["$ws/.atomic"]=1
  fi
  if [[ -n "$skill_root" && -z "${seen[$skill_root]:-}" ]]; then
    dirs+=("$skill_root")
    seen["$skill_root"]=1
  fi
  IFS=',' read -ra names <<< "$skills_csv"
  for name in "${names[@]}"; do
    name="${name// /}"
    [[ -n "$name" ]] || continue
    dir="$skill_root/$name"
    if [[ -n "$skill_root" && -d "$dir" && -z "${seen[$dir]:-}" ]]; then
      dirs+=("$dir")
      seen["$dir"]=1
    fi
  done
  printf '%s\n' "${dirs[@]}"
}

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${TIMEOUT_MIN}m" "$@"
  else
    "$@"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker) WORKER="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    --prompt-file) PROMPT_FILE="$2"; shift 2 ;;
    --log-file) LOG_FILE="$2"; shift 2 ;;
    --timeout-min) TIMEOUT_MIN="$2"; shift 2 ;;
    --model) die "--model is no longer supported: the workflow does not select models; configure the model in the CLI itself" ;;
    --skills) SKILLS="$(merge_skills_csv "$SKILLS" "$2")"; shift 2 ;;
    --skills-file)
      [[ -f "$2" ]] || die "skills file not found: $2"
      SKILLS="$(merge_skills_csv "$SKILLS" "$(tr '\n' ',' <"$2" | sed 's/,$//')")"
      shift 2
      ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$WORKER" && -n "$WORKSPACE" && -n "$PROMPT_FILE" && -n "$LOG_FILE" ]] || {
  usage
  exit 2
}

case "$WORKER" in
  agy|opencode|codex|claude) ;;
  *) echo "unknown worker: $WORKER" >&2; exit 2 ;;
esac

[[ -d "$WORKSPACE" ]] || die "workspace not found: $WORKSPACE"
[[ -f "$PROMPT_FILE" ]] || die "prompt file not found: $PROMPT_FILE"

mkdir -p "$(dirname "$LOG_FILE")"
WS="$(cd "$WORKSPACE" && pwd)"
PROMPT="$(cat "$PROMPT_FILE")"
[[ -n "${PROMPT//[[:space:]]/}" ]] || die "prompt file is empty: $PROMPT_FILE"

if [[ -z "$SKILLS" ]]; then
  SKILLS="atomic-workflow,tdd"
fi

SKILLS_BLOCK="$(build_skills_block "$WS" "$SKILLS")"
if [[ -n "$SKILLS_BLOCK" ]]; then
  # $(...) strips the trailing blank line from build_skills_block, so re-add it.
  PROMPT="${SKILLS_BLOCK}"$'\n\n'"${PROMPT}"
fi

EFFECTIVE_PROMPT_FILE="${LOG_FILE%.log}.effective-prompt.md"
printf '%s' "$PROMPT" >"$EFFECTIVE_PROMPT_FILE"

LAST_MESSAGE_FILE="${LOG_FILE%.log}.last.md"
AGY_TIMEOUT="${TIMEOUT_MIN}m0s"
EXIT_CODE=1

{
  echo "worker=$WORKER workspace=$WS started=$(date -Iseconds) dry_run=$DRY_RUN"
} >"$LOG_FILE"

dry_run_agy() {
  # Print the command only. Real runs still require agy via run_agy.
  local line="agy --output-format text --mode accept-edits --dangerously-skip-permissions --print-timeout $AGY_TIMEOUT"
  local add_dir
  while IFS= read -r add_dir; do
    [[ -n "$add_dir" ]] || continue
    line+=" --add-dir $(printf '%q' "$add_dir")"
  done < <(skill_parent_dirs "$WS" "$SKILLS")
  line+=" -p $(printf '%q' "$PROMPT")"
  echo "dry-run: $line" | tee -a "$LOG_FILE"
}

run_agy() {
  local bin
  local -a cmd
  bin="$(resolve_bin agy agy.exe)" || die "agy not on PATH. Run ensure-workers.sh"
  cmd=( "$bin" --output-format text --mode accept-edits --dangerously-skip-permissions --print-timeout "$AGY_TIMEOUT" )
  local add_dir
  while IFS= read -r add_dir; do
    [[ -n "$add_dir" ]] || continue
    cmd+=( --add-dir "$add_dir" )
  done < <(skill_parent_dirs "$WS" "$SKILLS")
  cmd+=( -p "$PROMPT" )
  run_with_timeout "${cmd[@]}" 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

dry_run_codex() {
  echo "dry-run: cat $(printf '%q' "$EFFECTIVE_PROMPT_FILE") | codex exec - --sandbox workspace-write -c approval_policy=never -C $(printf '%q' "$WS") --color never -o $(printf '%q' "$LAST_MESSAGE_FILE")" | tee -a "$LOG_FILE"
}

run_codex() {
  local bin
  bin="$(resolve_bin codex codex.exe)" || die "codex not on PATH. Run ensure-workers.sh"
  run_with_timeout bash -c 'cat "$1" | "$2" exec - --sandbox workspace-write -c '\''approval_policy="never"'\'' -C "$3" --color never -o "$4"' \
    _ "$EFFECTIVE_PROMPT_FILE" "$bin" "$WS" "$LAST_MESSAGE_FILE" 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

dry_run_opencode() {
  echo "dry-run: opencode run --dir $(printf '%q' "$WS") --auto --title atomic-workflow $(printf '%q' "$PROMPT")" | tee -a "$LOG_FILE"
}

run_opencode() {
  local bin
  local -a cmd
  bin="$(resolve_bin opencode opencode.exe)" || die "opencode not on PATH. Run ensure-workers.sh"
  run_with_timeout "$bin" run --dir "$WS" --auto --title "atomic-workflow" "$PROMPT" 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

dry_run_claude() {
  local line="claude -p --dangerously-skip-permissions"
  local add_dir
  while IFS= read -r add_dir; do
    [[ -n "$add_dir" ]] || continue
    line+=" --add-dir $(printf '%q' "$add_dir")"
  done < <(skill_parent_dirs "$WS" "$SKILLS")
  line+=" $(printf '%q' "$PROMPT")"
  echo "dry-run: cd $(printf '%q' "$WS") && $line" | tee -a "$LOG_FILE"
}

run_claude() {
  local bin
  local -a cmd
  bin="$(resolve_bin claude claude.exe)" || die "claude not on PATH. Run ensure-workers.sh"
  cmd=( "$bin" -p --dangerously-skip-permissions )
  local add_dir
  while IFS= read -r add_dir; do
    [[ -n "$add_dir" ]] || continue
    cmd+=( --add-dir "$add_dir" )
  done < <(skill_parent_dirs "$WS" "$SKILLS")
  cmd+=( "$PROMPT" )
  ( cd "$WS" && run_with_timeout "${cmd[@]}" ) 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

if [[ "$DRY_RUN" == "1" ]]; then
  case "$WORKER" in
    agy) dry_run_agy ;;
    codex) dry_run_codex ;;
    opencode) dry_run_opencode ;;
    claude) dry_run_claude ;;
  esac
  EXIT_CODE=0
else
  (
    cd "$WS"
    case "$WORKER" in
      agy) run_agy ;;
      codex) run_codex ;;
      opencode) run_opencode ;;
      claude) run_claude ;;
    esac
  ) && EXIT_CODE=0 || EXIT_CODE=$?
fi

echo "finished=$(date -Iseconds) exit=$EXIT_CODE" >>"$LOG_FILE"
echo "log=$LOG_FILE"
echo "exit=$EXIT_CODE"
exit "$EXIT_CODE"
