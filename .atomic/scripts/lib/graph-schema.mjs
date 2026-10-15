import { isAbsolute } from "node:path";
import { EXECUTOR_IDS } from "./executors/constants.mjs";

export const KNOWN_OUTCOMES = [
  "pass",
  "fail",
  "spec_mismatch",
  "needs_info",
  "escalate",
  "blocked",
  "route",
  "approved",
  "rejected",
];

export const RESERVED_TARGETS = ["$user", "$halt", "$end"];

export const GATE_IDS_DEFAULT = ["db", "auth", "merge", "ci", "deps"];

export const NODE_ID_RE = /^[a-z][a-z0-9-]*$/;

const NODE_FIELDS = new Set([
  "skill",
  "prompt",
  "agent",
  "executor",
  "timeout",
  "mode",
  "inputs",
  "outputs",
  "requires_approval",
  "max_visits",
  "terminal_hook",
  "description",
  "readonly",
]);

const ENTRY_CLASSES = new Set(["bug", "feature", "refactor", "trivial", "docs"]);

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggest(name, candidates) {
  if (!candidates || candidates.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(String(name), String(c));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (bestDist <= 3) return best;
  return null;
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}

/**
 * @param {unknown} doc
 * @param {{ executorIds?: string[] }} [opts]
 */
export function validateGraphV2(doc, opts = {}) {
  const executorIds = opts.executorIds ?? EXECUTOR_IDS;
  const errors = [];
  const warnings = [];

  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
    return { errors: ["graph.yaml: root must be a mapping"], warnings };
  }
  const d = /** @type {Record<string, unknown>} */ (doc);

  if (d.version !== 2) {
    errors.push(`graph.yaml: version must be 2 (got ${JSON.stringify(d.version)})`);
  }

  // nodes
  if (d.nodes == null || typeof d.nodes !== "object" || Array.isArray(d.nodes)) {
    errors.push("graph.yaml: nodes is required and must be a mapping");
  }
  const nodes = (d.nodes != null && typeof d.nodes === "object" && !Array.isArray(d.nodes)
    ? d.nodes
    : {});
  const nodeIds = Object.keys(nodes);

  // gates (needed for requires_approval check)
  let allowedGates = [...GATE_IDS_DEFAULT];
  /** @type {Record<string, unknown>} */
  let gates = {};
  if (d.gates !== undefined) {
    if (d.gates == null || typeof d.gates !== "object" || Array.isArray(d.gates)) {
      errors.push("graph.yaml: gates must be a mapping");
    } else {
      gates = /** @type {Record<string, unknown>} */ (d.gates);
      allowedGates = [...new Set([...GATE_IDS_DEFAULT, ...Object.keys(gates)])];
      for (const [gid, gval] of Object.entries(gates)) {
        if (gval == null || typeof gval !== "object" || Array.isArray(gval)) {
          errors.push(`graph.yaml: gates.${gid} must be a mapping`);
          continue;
        }
        const g = /** @type {Record<string, unknown>} */ (gval);
        const hasMatch = "match" in g;
        const hasAlways = "always" in g;
        const extra = Object.keys(g).filter((k) => k !== "match" && k !== "always");
        for (const k of extra) {
          warnings.push(`graph.yaml: gates.${gid}.${k} is unknown (ignored)`);
        }
        if (hasMatch && hasAlways) {
          errors.push(`graph.yaml: gates.${gid} must have only one of match, always`);
          continue;
        }
        if (!hasMatch && !hasAlways) {
          errors.push(`graph.yaml: gates.${gid} must have match or always`);
          continue;
        }
        if (hasAlways && g.always !== true) {
          errors.push(`graph.yaml: gates.${gid}.always must be true`);
        }
        if (hasMatch && !isStringArray(g.match)) {
          errors.push(`graph.yaml: gates.${gid}.match must be a string array`);
        }
      }
    }
  }

  for (const id of nodeIds) {
    if (!NODE_ID_RE.test(id)) {
      errors.push(`graph.yaml: invalid node id "${id}" (must match /^[a-z][a-z0-9-]*$/)`);
    }
    const raw = nodes[id];
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`graph.yaml: nodes.${id} must be a mapping`);
      continue;
    }
    const node = /** @type {Record<string, unknown>} */ (raw);
    for (const k of Object.keys(node)) {
      if (k === "model") {
        warnings.push(`graph.yaml: nodes.${id}.model is ignored (model selection was removed)`);
        continue;
      }
      if (!NODE_FIELDS.has(k)) {
        warnings.push(`graph.yaml: nodes.${id}.${k} is unknown (ignored)`);
      }
    }
    if (typeof node.skill !== "undefined" && typeof node.skill !== "string") {
      errors.push(`graph.yaml: nodes.${id}.skill must be a string`);
    }
    if (typeof node.prompt !== "undefined" && typeof node.prompt !== "string") {
      errors.push(`graph.yaml: nodes.${id}.prompt must be a string`);
    }
    if (typeof node.skill === "string" && node.skill !== "") {
      if (isAbsolute(node.skill) || node.skill.split(/[\\/]/).includes("..")) {
        errors.push(`graph.yaml: nodes.${id}.skill "${node.skill}" must be a relative path without '..' segments`);
      }
    }
    if (typeof node.prompt === "string" && node.prompt !== "") {
      if (isAbsolute(node.prompt) || node.prompt.split(/[\\/]/).includes("..")) {
        errors.push(`graph.yaml: nodes.${id}.prompt "${node.prompt}" must be a relative path without '..' segments`);
      }
    }
    if (typeof node.agent !== "undefined" && typeof node.agent !== "string") {
      errors.push(`graph.yaml: nodes.${id}.agent must be a string`);
    }
    if (typeof node.executor !== "undefined") {
      if (typeof node.executor !== "string" || !executorIds.includes(node.executor)) {
        errors.push(
          `graph.yaml: nodes.${id}.executor "${String(node.executor)}" is not one of ${executorIds.join(", ")}`,
        );
      }
    }
    if (typeof node.timeout !== "undefined" && !isPositiveInt(node.timeout)) {
      errors.push(`graph.yaml: nodes.${id}.timeout must be a positive integer seconds`);
    }
    if (typeof node.mode !== "undefined" && typeof node.mode !== "string") {
      errors.push(`graph.yaml: nodes.${id}.mode must be a string`);
    }
    if (typeof node.inputs !== "undefined" && !isStringArray(node.inputs)) {
      errors.push(`graph.yaml: nodes.${id}.inputs must be a string array`);
    }
    if (typeof node.outputs !== "undefined" && !isStringArray(node.outputs)) {
      errors.push(`graph.yaml: nodes.${id}.outputs must be a string array`);
    }
    if (typeof node.requires_approval !== "undefined") {
      if (!isStringArray(node.requires_approval)) {
        errors.push(`graph.yaml: nodes.${id}.requires_approval must be a string array`);
      } else {
        for (const g of node.requires_approval) {
          if (!allowedGates.includes(g)) {
            errors.push(
              `graph.yaml: nodes.${id}.requires_approval "${g}" is not a defined gate (${allowedGates.join(", ")})`,
            );
          }
        }
      }
    }
    if (typeof node.max_visits !== "undefined" && !isPositiveInt(node.max_visits)) {
      errors.push(`graph.yaml: nodes.${id}.max_visits must be a positive integer`);
    }
    if (typeof node.terminal_hook !== "undefined" && typeof node.terminal_hook !== "boolean") {
      errors.push(`graph.yaml: nodes.${id}.terminal_hook must be a boolean`);
    }
    if (typeof node.description !== "undefined" && typeof node.description !== "string") {
      errors.push(`graph.yaml: nodes.${id}.description must be a string`);
    }
    if (typeof node.readonly !== "undefined" && typeof node.readonly !== "boolean") {
      errors.push(`graph.yaml: nodes.${id}.readonly must be a boolean`);
    }
    const hasSkill = typeof node.skill === "string" && node.skill !== "";
    const hasPrompt = typeof node.prompt === "string" && node.prompt !== "";
    const hasAgent = typeof node.agent === "string" && node.agent !== "";
    if (!hasSkill && !hasPrompt && !hasAgent) {
      errors.push(`graph.yaml: nodes.${id} must have at least one of skill, prompt, agent`);
    }
    if (hasSkill && hasPrompt) {
      errors.push(`graph.yaml: nodes.${id} cannot have both skill and prompt`);
    }
  }

  // defaults
  if (d.defaults !== undefined) {
    if (d.defaults == null || typeof d.defaults !== "object" || Array.isArray(d.defaults)) {
      errors.push("graph.yaml: defaults must be a mapping");
    } else {
      const defs = /** @type {Record<string, unknown>} */ (d.defaults);
      for (const k of Object.keys(defs)) {
        if (k === "model") {
          warnings.push("graph.yaml: defaults.model is ignored (model selection was removed)");
          continue;
        }
        if (!["executor", "timeout", "max_visits"].includes(k)) {
          warnings.push(`graph.yaml: defaults.${k} is unknown (ignored)`);
        }
      }
      if ("executor" in defs && (typeof defs.executor !== "string" || !executorIds.includes(defs.executor))) {
        errors.push(
          `graph.yaml: defaults.executor "${String(defs.executor)}" is not one of ${executorIds.join(", ")}`,
        );
      }
      if ("timeout" in defs && !isPositiveInt(defs.timeout)) {
        errors.push("graph.yaml: defaults.timeout must be a positive integer seconds");
      }
      if ("max_visits" in defs && !isPositiveInt(defs.max_visits)) {
        errors.push("graph.yaml: defaults.max_visits must be a positive integer");
      }
    }
  }

  // limits
  if (d.limits !== undefined) {
    if (d.limits == null || typeof d.limits !== "object" || Array.isArray(d.limits)) {
      errors.push("graph.yaml: limits must be a mapping");
    } else {
      const lim = /** @type {Record<string, unknown>} */ (d.limits);
      for (const k of Object.keys(lim)) {
        if (!["max_steps", "max_loops"].includes(k)) {
          warnings.push(`graph.yaml: limits.${k} is unknown (ignored)`);
        }
      }
      if ("max_steps" in lim && !isPositiveInt(lim.max_steps)) {
        errors.push("graph.yaml: limits.max_steps must be a positive integer");
      }
      if ("max_loops" in lim) {
        if (lim.max_loops == null || typeof lim.max_loops !== "object" || Array.isArray(lim.max_loops)) {
          errors.push("graph.yaml: limits.max_loops must be a mapping");
        } else {
          for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (lim.max_loops))) {
            if (!nodeIds.includes(k)) {
              const s = suggest(k, nodeIds);
              errors.push(
                `graph.yaml: limits.max_loops."${k}" is not a defined node${s ? ` (did you mean "${s}"?)` : ""}`,
              );
            }
            if (!isPositiveInt(v)) {
              errors.push(`graph.yaml: limits.max_loops."${k}" must be a positive integer`);
            }
          }
        }
      }
    }
  }

  // entry
  /** @type {string | null} */
  let entryDefault = null;
  if (d.entry !== undefined) {
    if (d.entry == null || typeof d.entry !== "object" || Array.isArray(d.entry)) {
      errors.push("graph.yaml: entry must be a mapping");
    } else {
      const entry = /** @type {Record<string, unknown>} */ (d.entry);
      for (const k of Object.keys(entry)) {
        if (!["default", "by_class"].includes(k)) {
          warnings.push(`graph.yaml: entry.${k} is unknown (ignored)`);
        }
      }
      if ("default" in entry) {
        if (typeof entry.default !== "string") {
          errors.push("graph.yaml: entry.default must be a node id");
        } else {
          entryDefault = entry.default;
          if (!nodeIds.includes(entry.default)) {
            const s = suggest(entry.default, nodeIds);
            errors.push(
              `graph.yaml: entry.default "${entry.default}" is not a defined node${s ? ` (did you mean "${s}"?)` : ""}`,
            );
          }
        }
      }
      if ("by_class" in entry) {
        if (entry.by_class == null || typeof entry.by_class !== "object" || Array.isArray(entry.by_class)) {
          errors.push("graph.yaml: entry.by_class must be a mapping");
        } else {
          for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (entry.by_class))) {
            if (!ENTRY_CLASSES.has(k)) {
              errors.push(
                `graph.yaml: entry.by_class."${k}" is not a valid class (must be one of bug, feature, refactor, trivial, docs)`,
              );
            }
            if (typeof v !== "string") {
              errors.push(`graph.yaml: entry.by_class."${k}" must be a node id`);
            } else if (!nodeIds.includes(v)) {
              const s = suggest(v, nodeIds);
              errors.push(
                `graph.yaml: entry.by_class."${k}" "${v}" is not a defined node${s ? ` (did you mean "${s}"?)` : ""}`,
              );
            }
          }
        }
      }
    }
  }

  // edges
  /** @type {Array<Record<string, unknown>>} */
  let edges = [];
  if (d.edges !== undefined) {
    if (!Array.isArray(d.edges)) {
      errors.push("graph.yaml: edges must be a list");
    } else {
      edges = /** @type {Array<Record<string, unknown>>} */ (d.edges);
      edges.forEach((edge, i) => {
        if (edge == null || typeof edge !== "object" || Array.isArray(edge)) {
          errors.push(`graph.yaml: edges[${i}] must be a mapping`);
          return;
        }
        for (const k of Object.keys(edge)) {
          if (!["from", "to", "on", "when", "priority"].includes(k)) {
            warnings.push(`graph.yaml: edges[${i}].${k} is unknown (ignored)`);
          }
        }
        // from
        if (!("from" in edge)) {
          errors.push(`graph.yaml: edges[${i}].from is required`);
        } else if (typeof edge.from !== "string") {
          errors.push(`graph.yaml: edges[${i}].from must be a node id or "*"`);
        } else if (edge.from !== "*" && !nodeIds.includes(edge.from)) {
          const s = suggest(edge.from, nodeIds);
          errors.push(
            `graph.yaml: edges[${i}].from "${edge.from}" is not a defined node${s ? ` (did you mean "${s}"?)` : ""}`,
          );
        }
        // to
        if (!("to" in edge)) {
          errors.push(`graph.yaml: edges[${i}].to is required`);
        } else {
          const tos = Array.isArray(edge.to) ? edge.to : [edge.to];
          if (Array.isArray(edge.to) && edge.to.length === 0) {
            errors.push(`graph.yaml: edges[${i}].to must not be empty`);
          }
          for (const t of tos) {
            if (typeof t !== "string") {
              errors.push(`graph.yaml: edges[${i}].to must be a node id, reserved target, or array of those`);
              break;
            }
            if (RESERVED_TARGETS.includes(t)) continue;
            if (!nodeIds.includes(t)) {
              const s = suggest(t, [...nodeIds, ...RESERVED_TARGETS]);
              errors.push(
                `graph.yaml: edges[${i}].to "${t}" is not a defined node${s ? ` (did you mean "${s}"?)` : ""}`,
              );
            }
          }
        }
        // on
        if (!("on" in edge)) {
          errors.push(`graph.yaml: edges[${i}].on is required`);
        } else {
          if (Array.isArray(edge.on) && edge.on.length === 0) {
            errors.push(`graph.yaml: edges[${i}].on must not be empty`);
          }
          const ons = Array.isArray(edge.on) ? edge.on : [edge.on];
          for (const o of ons) {
            if (typeof o !== "string" || !KNOWN_OUTCOMES.includes(o)) {
              errors.push(
                `graph.yaml: edges[${i}].on "${String(o)}" is not a known outcome (must be one of ${KNOWN_OUTCOMES.join(", ")})`,
              );
            }
          }
        }
        if ("when" in edge && typeof edge.when !== "string") {
          errors.push(`graph.yaml: edges[${i}].when must be a string`);
        }
        if ("priority" in edge && !Number.isInteger(edge.priority)) {
          errors.push(`graph.yaml: edges[${i}].priority must be an integer`);
        }
      });
    }
  }

  // warnings: reachability + dangling
  if (entryDefault && nodeIds.includes(entryDefault)) {
    const adj = new Map();
    for (const id of nodeIds) adj.set(id, new Set());
    for (const edge of edges) {
      if (edge == null || typeof edge !== "object" || Array.isArray(edge)) continue;
      const from = edge.from;
      if (typeof from !== "string" || from === "*") continue;
      if (!nodeIds.includes(from)) continue;
      const tos = Array.isArray(edge.to) ? edge.to : [edge.to];
      for (const t of tos) {
        if (typeof t === "string" && nodeIds.includes(t)) {
          adj.get(from).add(t);
        }
      }
    }
    const visited = new Set([entryDefault]);
    const queue = [entryDefault];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    for (const id of nodeIds) {
      if (!visited.has(id)) {
        warnings.push(`graph.yaml: node "${id}" is unreachable from entry.default "${entryDefault}"`);
      }
    }
  }

  // non-terminal nodes with no outgoing edge
  {
    const hasOutgoing = new Set();
    for (const edge of edges) {
      if (edge != null && typeof edge === "object" && !Array.isArray(edge) && typeof edge.from === "string") {
        hasOutgoing.add(edge.from);
      }
    }
    for (const id of nodeIds) {
      if (!hasOutgoing.has(id)) {
        warnings.push(`graph.yaml: node "${id}" has no outgoing edge`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Convert legacy v1 nodes to a v2 doc with fixed edges.
 * @param {Record<string, Record<string, unknown>>} v1nodes
 */
export function normalizeV1(v1nodes) {
  const nodes = {};
  for (const [k, v] of Object.entries(v1nodes ?? {})) {
    nodes[k] = { ...(v ?? {}) };
  }
  // v1 used a legacy `next` field for routing (e.g. `router: { next: [lite, explore] }`).
  // v2 expresses routing via `edges`, so drop `next` and coerce typed scalars.
  // Any v1 node left without skill/prompt/agent (typically `router` with only
  // `next`) is router-like: give it `skill: atomic-router` so the
  // migrated doc passes v2 validation. This keeps validation strict for v2
  // (no exception for skill-less nodes) while making default v1 graphs migrate
  // cleanly.
  for (const [id, node] of Object.entries(nodes)) {
    if (node == null || typeof node !== "object" || Array.isArray(node)) continue;
    const hadNext = "next" in node;
    if (hadNext) delete node.next;
    for (const f of ["timeout", "max_visits"]) {
      const raw = node[f];
      if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
        node[f] = Number(raw.trim());
      }
    }
    for (const f of ["terminal_hook", "readonly"]) {
      const raw = node[f];
      if (typeof raw === "string") {
        const t = raw.trim();
        if (t === "true") node[f] = true;
        else if (t === "false") node[f] = false;
      }
    }
    const hasSkill = typeof node.skill === "string" && node.skill !== "";
    const hasPrompt = typeof node.prompt === "string" && node.prompt !== "";
    const hasAgent = typeof node.agent === "string" && node.agent !== "";
    // Router-like v1 nodes (only `next`, e.g. default `router`) have no
    // skill/prompt/agent; give them the router skill so migration validates.
    if (!hasSkill && !hasPrompt && !hasAgent && (hadNext || id === "router")) {
      node.skill = "atomic-router";
    }
  }
  const has = (id) => Object.prototype.hasOwnProperty.call(nodes, id);
  const isReserved = (t) => RESERVED_TARGETS.includes(t);
  const exists = (t) => isReserved(t) || has(t);

  /** @type {Array<Record<string, unknown>>} */
  const candidates = [
    { from: "router", to: ["lite", "explore"], on: "route" },
    { from: "explore", to: "plan", on: "pass" },
    { from: "plan", to: "plan-review", on: "pass" },
    { from: "plan-review", to: "task", on: "pass" },
    { from: "plan-review", to: "plan", on: "fail" },
    { from: "task", to: "execute", on: "pass" },
    { from: "execute", to: "review", on: "pass" },
    { from: "review", to: "wrapup", on: "pass" },
    { from: "review", to: "execute", on: "fail" },
    ...(has("memory")
      ? [
          { from: "wrapup", to: "memory", on: "pass" },
          { from: "memory", to: "$end", on: "pass" },
        ]
      : [{ from: "wrapup", to: "$end", on: "pass" }]),
    { from: "lite", to: "$end", on: "pass" },
  ];

  const edges = [];
  for (const e of candidates) {
    if (!has(e.from)) continue;
    const tos = Array.isArray(e.to) ? e.to : [e.to];
    const kept = tos.filter(exists);
    if (kept.length === 0) continue;
    edges.push({
      from: e.from,
      to: kept.length === 1 ? kept[0] : kept,
      on: e.on,
    });
  }
  // Fix single vs array: if original was array keep array (even length 1? keep array only if >1 original and kept>1?).
  // For router edge keep array form when both exist; if only one exists use single string.
  // Above logic handles: if original array with 2 and kept 1 -> single. Good.

  return {
    version: 2,
    legacy: true,
    nodes,
    edges,
    defaults: {},
    limits: { max_steps: 30, max_loops: { execute: 1 } },
    gates: {},
    entry: { default: "router" },
  };
}
