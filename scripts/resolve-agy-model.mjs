#!/usr/bin/env node
/** Normalize user-facing agy model names to `agy models` slugs. */
const ALIASES = {
  "gemini-3.8-flash": "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium": "gemini-3.8-flash-high",
};

export function resolveAgyModel(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return ALIASES[raw] ?? raw;
}

if (process.argv[1]?.endsWith("resolve-agy-model.mjs")) {
  const arg = process.argv[2] ?? "";
  process.stdout.write(resolveAgyModel(arg));
}
