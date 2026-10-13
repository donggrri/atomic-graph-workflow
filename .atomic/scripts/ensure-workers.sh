#!/usr/bin/env bash
# cursor-atomic-workflow: check headless CLI workers on PATH.
set -euo pipefail

WORKERS=(agy opencode codex claude)
if [[ $# -gt 0 ]]; then
  IFS=',' read -ra WORKERS <<< "$1"
fi

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

worker_bins() {
  case "$1" in
    agy) echo "agy agy.exe" ;;
    opencode) echo "opencode opencode.exe" ;;
    codex) echo "codex codex.exe" ;;
    claude) echo "claude claude.exe" ;;
    *) return 1 ;;
  esac
}

missing=0
for w in "${WORKERS[@]}"; do
  w="${w// /}"
  [[ -n "$w" ]] || continue
  bins=($(worker_bins "$w" || true))
  if [[ ${#bins[@]} -eq 0 ]]; then
    echo "$w: unknown"
    missing=1
    continue
  fi
  if path="$(resolve_bin "${bins[@]}")"; then
    echo "$w: ok ($path)"
  else
    echo "$w: missing (not on PATH)"
    missing=1
  fi
done

exit "$missing"
