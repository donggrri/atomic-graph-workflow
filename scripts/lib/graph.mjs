import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal parser for the installed graph.yaml shape (no external YAML dep).
 * @param {string} text
 */
export function parseGraphYaml(text) {
  /** @type {Record<string, Record<string, string | string[]>>} */
  const nodes = {};
  let current = null;
  let version = 1;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const ver = line.match(/^version:\s*(\d+)/);
    if (ver) {
      version = Number(ver[1]);
      continue;
    }
    const nodeHead = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (nodeHead) {
      current = nodeHead[1];
      nodes[current] = {};
      continue;
    }
    const kv = line.match(/^    ([a-zA-Z0-9_-]+):\s*(.+)$/);
    if (!kv || !current) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      nodes[current][key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      nodes[current][key] = val;
    }
  }

  return { version, nodes };
}

/**
 * @param {string} repoRoot
 * @returns {{ version: number, nodes: Record<string, Record<string, unknown>> }}
 */
export function loadGraph(repoRoot) {
  const path = join(repoRoot, ".atomic", "graph.yaml");
  if (!existsSync(path)) {
    return { version: 1, nodes: {} };
  }
  const text = readFileSync(path, "utf8");
  return parseGraphYaml(text);
}

/** Pipeline / setup stage ids (graph node keys). */
export const GRAPH_STAGE_IDS = [
  "lite",
  "explore",
  "plan",
  "plan-review",
  "task",
  "execute",
  "review",
  "wrapup",
  "memory",
];

/** Maps runRoleStep phaseKey → graph node id. */
export const PHASE_TO_GRAPH_STAGE = {
  lite: "lite",
  explore: "explore",
  plan: "plan",
  "plan-review": "plan-review",
  tasker: "task",
  execute: "execute",
  reviewer: "review",
  tester: "wrapup",
  memory: "memory",
};

/**
 * @param {string} phaseKey
 * @returns {string | null}
 */
export function phaseToGraphStage(phaseKey) {
  return PHASE_TO_GRAPH_STAGE[phaseKey] ?? null;
}
