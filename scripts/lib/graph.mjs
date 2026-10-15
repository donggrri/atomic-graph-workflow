import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { parseYamlLite } from "./yaml-lite.mjs";
import { validateGraphV2, normalizeV1, RESERVED_TARGETS } from "./graph-schema.mjs";
import { EXECUTOR_IDS } from "./executors/constants.mjs";
import { canonicalName } from "./legacy-aliases.mjs";

/**
 * @param {string} repoRoot
 * @param {string} targetPath
 * @param {string} [label]
 * @returns {string} absolute path inside repoRoot
 */
export function assertInsideRepo(repoRoot, targetPath, label = "path") {
  const base = resolve(repoRoot);
  const absTarget = resolve(base, targetPath);
  const rel = relative(base, absTarget);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} "${targetPath}" escapes repository root`);
  }
  return absTarget;
}

/**
 * @param {string} s
 */
export function isSimpleSkillName(s) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(s);
}

/**
 * Relative path that stays inside the repo (not absolute, no '..' segments).
 * @param {string} p
 */
export function isSafeRelativePath(p) {
  if (!p || typeof p !== "string") return false;
  if (isAbsolute(p)) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  const segs = p.split(/[\\/]/);
  if (segs.includes("..")) return false;
  return true;
}

/**
 * @param {string} val
 */
export function stripYamlInlineComment(val) {
  let inQuote = null;
  for (let i = 0; i < val.length; i++) {
    const ch = val[i];
    if (inQuote) {
      if (inQuote === '"') {
        if (ch === '"' && !isEscapedPos(val, i)) inQuote = null;
      } else {
        if (ch === "'") {
          if (val[i + 1] === "'") {
            i++;
            continue;
          }
          inQuote = null;
        }
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(val[i - 1] ?? ""))) {
      return val.slice(0, i).trim();
    }
  }
  return val.trim();
}

/**
 * @param {string} s
 * @param {number} pos
 */
function isEscapedPos(s, pos) {
  let bs = 0;
  for (let i = pos - 1; i >= 0 && s[i] === "\\"; i--) bs++;
  return bs % 2 === 1;
}

function parseV1(text) {
  /** @type {Record<string, Record<string, string | string[]>>} */
  const nodes = {};
  let current = null;
  let version = 1;

  /** @type {string[]} */
  const warnings = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
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
    if (!kv) {
      if (/^\s{4}\S/.test(line)) {
        warnings.push(`graph.yaml: ignored line (bad indent or syntax): ${trimmed}`);
      } else if (/^\s{2}\S/.test(line) && !nodeHead) {
        warnings.push(`graph.yaml: expected 4-space node field: ${trimmed}`);
      }
      continue;
    }
    if (!current) {
      warnings.push(`graph.yaml: field before any node: ${trimmed}`);
      continue;
    }
    const key = kv[1];
    let val = stripYamlInlineComment(kv[2].trim());
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      nodes[current][key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => {
          const t = s.trim();
          if (
            (t.startsWith('"') && t.endsWith('"')) ||
            (t.startsWith("'") && t.endsWith("'"))
          ) {
            return t.slice(1, -1);
          }
          return t;
        })
        .filter(Boolean);
    } else {
      nodes[current][key] = val;
    }
  }

  return { version, nodes, warnings };
}

/**
 * Minimal parser for the installed graph.yaml shape (no external YAML dep).
 * v1 uses the legacy line parser; v2 uses yaml-lite + schema validation.
 * @param {string} text
 * @param {Record<string, unknown>} [opts]
 */
export function parseGraphYaml(text, opts = {}) {
  const verMatch = text.match(/^\s*version:\s*(\d+)/m);
  const detected = verMatch ? Number(verMatch[1]) : 1;
  if (detected !== 2) {
    const v1 = parseV1(text);
    const doc = normalizeV1(/** @type {Record<string, Record<string, unknown>>} */ (v1.nodes));
    return {
      version: v1.version,
      nodes: v1.nodes,
      warnings: v1.warnings,
      errors: [],
      edges: doc.edges,
      defaults: doc.defaults,
      limits: doc.limits,
      gates: doc.gates,
      entry: doc.entry,
      doc,
    };
  }

  const { value, errors: parseErrs } = parseYamlLite(text);
  const parseErrStrings = parseErrs.map((e) => `graph.yaml: line ${e.line}: ${e.message}`);
  const executorIds = opts.executorIds ?? EXECUTOR_IDS;
  const { errors: verrs, warnings } = validateGraphV2(value, { executorIds });

  /** @type {Record<string, unknown>} */
  const raw = value != null && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = raw.defaults != null && typeof raw.defaults === "object" && !Array.isArray(raw.defaults) ? { ...raw.defaults } : {};
  const limits = raw.limits != null && typeof raw.limits === "object" && !Array.isArray(raw.limits) ? { ...raw.limits } : {};
  const gates = raw.gates != null && typeof raw.gates === "object" && !Array.isArray(raw.gates) ? { ...raw.gates } : {};
  const entry = raw.entry != null && typeof raw.entry === "object" && !Array.isArray(raw.entry) ? { ...raw.entry } : {};
  const rawNodes = raw.nodes != null && typeof raw.nodes === "object" && !Array.isArray(raw.nodes) ? raw.nodes : {};
  const edges = Array.isArray(raw.edges) ? [...raw.edges] : [];

  // apply defaults into nodes for runtime consumers only;
  // doc.nodes stays pristine so serialize does not bake defaults.
  /** @type {Record<string, Record<string, unknown>>} */
  const nodes = {};
  for (const [id, nv] of Object.entries(rawNodes)) {
    const n = nv != null && typeof nv === "object" && !Array.isArray(nv) ? { ...nv } : {};
    if (defaults.executor !== undefined && n.executor === undefined) n.executor = defaults.executor;
    if (defaults.timeout !== undefined && n.timeout === undefined) n.timeout = defaults.timeout;
    if (defaults.max_visits !== undefined && n.max_visits === undefined) n.max_visits = defaults.max_visits;
    nodes[id] = n;
  }

  const doc = {
    version: 2,
    defaults,
    limits,
    gates,
    entry,
    nodes: rawNodes,
    edges,
  };

  return {
    version: 2,
    nodes,
    edges,
    defaults,
    limits,
    gates,
    entry,
    errors: [...parseErrStrings, ...verrs],
    warnings,
    doc,
  };
}

/**
 * @param {string} repoRoot
 */
export function loadGraph(repoRoot) {
  const path = join(repoRoot, ".atomic", "graph.yaml");
  if (!existsSync(path)) {
    const doc = normalizeV1({});
    return {
      version: 1,
      nodes: {},
      warnings: [],
      errors: [],
      edges: [],
      defaults: doc.defaults,
      limits: doc.limits,
      gates: doc.gates,
      entry: doc.entry,
      doc,
    };
  }
  const text = readFileSync(path, "utf8");
  const parsed = parseGraphYaml(text);
  for (const node of Object.values(parsed.nodes)) {
    if (typeof node.skill === "string") node.skill = canonicalName(node.skill);
    if (typeof node.agent === "string") node.agent = canonicalName(node.agent);
  }
  // ensure all expected keys exist for both versions
  return {
    version: parsed.version,
    nodes: parsed.nodes,
    warnings: parsed.warnings ?? [],
    errors: parsed.errors ?? [],
    edges: parsed.edges ?? [],
    defaults: parsed.defaults ?? {},
    limits: parsed.limits ?? {},
    gates: parsed.gates ?? {},
    entry: parsed.entry ?? {},
    doc: parsed.doc,
  };
}

/**
 * @param {{ nodes: Record<string, unknown> }} graph
 */
export function graphNodeIds(graph) {
  return Object.keys(graph?.nodes ?? {});
}

// ---- serializer ----

function serializeScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (v === "") return '""';
    if (/^(true|false|null|~)$/i.test(v)) return JSON.stringify(v);
    if (/^-?(\d+|\d*\.\d+)([eE][+-]?\d+)?$/.test(v)) return JSON.stringify(v);
    if (/^\s|\s$/.test(v)) return JSON.stringify(v);
    if (/[:#,[\]{}&*!|>'"%@`$]/.test(v)) return JSON.stringify(v);
    if (/^[A-Za-z0-9_./+<>-][A-Za-z0-9_./+<>-]*$/.test(v)) return v;
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map(serializeScalar).join(", ")}]`;
  }
  if (typeof v === "object") {
    const parts = Object.entries(v).map(([k, val]) => `${k}: ${serializeScalar(val)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return JSON.stringify(String(v));
}

const NODE_FIELD_ORDER = [
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
];

const EDGE_FIELD_ORDER = ["from", "to", "on", "when", "priority"];

/**
 * @param {Record<string, unknown>} doc
 */
export function serializeGraphV2(doc) {
  const lines = [];
  lines.push("version: 2");
  const defaults = doc.defaults ?? {};
  if (defaults && typeof defaults === "object" && Object.keys(defaults).length > 0) {
    const ordered = {};
    for (const k of ["executor", "timeout", "max_visits"]) {
      if (k in defaults) ordered[k] = defaults[k];
    }
    for (const k of Object.keys(defaults)) {
      if (!(k in ordered)) ordered[k] = defaults[k];
    }
    lines.push(`defaults: ${serializeScalar(ordered)}`);
  }
  const limits = doc.limits ?? {};
  if (limits && typeof limits === "object" && Object.keys(limits).length > 0) {
    const ordered = {};
    if ("max_steps" in limits) ordered.max_steps = limits.max_steps;
    if ("max_loops" in limits) ordered.max_loops = limits.max_loops;
    for (const k of Object.keys(limits)) {
      if (!(k in ordered)) ordered[k] = limits[k];
    }
    lines.push(`limits: ${serializeScalar(ordered)}`);
  }
  const gates = doc.gates ?? {};
  if (gates && typeof gates === "object" && Object.keys(gates).length > 0) {
    lines.push("gates:");
    for (const gid of Object.keys(gates)) {
      lines.push(`  ${gid}: ${serializeScalar(gates[gid])}`);
    }
  }
  const entry = doc.entry ?? {};
  if (entry && typeof entry === "object" && Object.keys(entry).length > 0) {
    const ordered = {};
    if ("default" in entry) ordered.default = entry.default;
    if ("by_class" in entry) ordered.by_class = entry.by_class;
    for (const k of Object.keys(entry)) {
      if (!(k in ordered)) ordered[k] = entry[k];
    }
    lines.push(`entry: ${serializeScalar(ordered)}`);
  }
  const nodes = doc.nodes ?? {};
  if (nodes && typeof nodes === "object" && !Array.isArray(nodes) && Object.keys(nodes).length === 0) {
    lines.push("nodes: {}");
  } else {
    lines.push("nodes:");
    for (const id of Object.keys(nodes)) {
      const n = nodes[id] ?? {};
      const ordered = {};
      if (n && typeof n === "object" && !Array.isArray(n)) {
        for (const k of NODE_FIELD_ORDER) {
          if (k in n) ordered[k] = n[k];
        }
        for (const k of Object.keys(n)) {
          if (!(k in ordered)) ordered[k] = n[k];
        }
      }
      lines.push(`  ${id}: ${serializeScalar(ordered)}`);
    }
  }
  const edges = Array.isArray(doc.edges) ? doc.edges : [];
  if (edges.length === 0) {
    lines.push("edges: []");
  } else {
    lines.push("edges:");
    for (const e of edges) {
      const ordered = {};
      if (e && typeof e === "object" && !Array.isArray(e)) {
        for (const k of EDGE_FIELD_ORDER) {
          if (k in e) ordered[k] = e[k];
        }
        for (const k of Object.keys(e)) {
          if (!(k in ordered)) ordered[k] = e[k];
        }
      }
      lines.push(`  - ${serializeScalar(ordered)}`);
    }
  }
  return lines.join("\n") + "\n";
}

// ---- CLI ----

function cliUsage() {
  return `Usage:
  node graph.mjs lint [--repo <dir>] [--json]
  node graph.mjs add-node <id> --after <node> [--before <node>] [--skill <name>|--prompt <relpath>] [--executor <id>] [--timeout <s>] [--on <outcome>] [--readonly] [--repo <dir>] [--dry-run]`;
}

function getFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

async function cliLint(rest) {
  let repo = process.cwd();
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--repo" && rest[i + 1]) repo = resolve(rest[++i]);
    else if (a === "--json") json = true;
    else {
      console.error(cliUsage());
      return 2;
    }
  }
  const gpath = join(repo, ".atomic", "graph.yaml");
  if (!existsSync(gpath)) {
    const msg = `graph.yaml not found: ${gpath}`;
    if (json) console.log(JSON.stringify({ errors: [msg], warnings: [] }, null, 2));
    else console.error(`error: ${msg}`);
    return 1;
  }
  const g = loadGraph(repo);
  const errors = g.errors ?? [];
  const warnings = g.warnings ?? [];
  if (json) {
    console.log(JSON.stringify({ errors, warnings }, null, 2));
  } else {
    for (const e of errors) console.log(`error: ${e}`);
    for (const w of warnings) console.log(`warning: ${w}`);
    if (errors.length === 0 && warnings.length === 0) console.log("ok");
  }
  return errors.length > 0 ? 1 : 0;
}

function buildSkillFile(skillName, nodeId) {
  return `---\nname: ${skillName}\ndescription: ${nodeId} custom node skill\n---\n# ${skillName}\n\n## Inputs\n\n- Describe inputs here.\n\n## Steps\n\n1. Read inputs.\n2. Perform the task.\n3. Write output report.\n\n## Output\n\n- Write the report file listed in outputs.\n- Finish with the required JSON block:\n\n\`\`\`json\n{"atomic_result": 1, "node": "${nodeId}", "outcome": "pass|fail|needs_info|blocked", "next": "<node>", "reason": "..."}\n\`\`\`\n`;
}

function buildPromptFile(nodeId) {
  return `# ${nodeId} prompt\n\n## Inputs\n\n- Describe inputs here.\n\n## Steps\n\n1. Read inputs.\n2. Perform the task.\n3. Write output report.\n\n## Output\n\n- Write the report file listed in outputs.\n- Finish with the required JSON block:\n\n\`\`\`json\n{"atomic_result": 1, "node": "${nodeId}", "outcome": "pass|fail|needs_info|blocked", "next": "<node>", "reason": "..."}\n\`\`\`\n`;
}

async function cliAddNode(rest) {
  if (rest.length === 0 || rest[0].startsWith("--")) {
    console.error(cliUsage());
    return 2;
  }
  const id = rest[0];
  const args = rest.slice(1);
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error(`error: invalid node id "${id}"`);
    return 2;
  }
  // parse flags
  let after = null;
  let before = null;
  let skill = null;
  let skillGiven = false;
  let prompt = null;
  let executor = null;
  let timeout = null;
  let on = "pass";
  let readonly = false;
  let repo = process.cwd();
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--after") {
      after = args[++i];
      if (!after || after.startsWith("--")) {
        console.error(cliUsage());
        return 2;
      }
    } else if (a === "--before") {
      before = args[++i];
      if (!before || before.startsWith("--")) {
        console.error(cliUsage());
        return 2;
      }
    } else if (a === "--skill") {
      skillGiven = true;
      const nxt = args[i + 1];
      if (nxt && !nxt.startsWith("--")) {
        skill = nxt;
        i++;
      } else {
        skill = id;
      }
    } else if (a === "--prompt") {
      prompt = args[++i];
      if (!prompt || prompt.startsWith("--")) {
        console.error(cliUsage());
        return 2;
      }
    } else if (a === "--executor") {
      executor = args[++i];
      if (!executor) {
        console.error(cliUsage());
        return 2;
      }
    } else if (a === "--timeout") {
      const t = args[++i];
      if (!t) {
        console.error(cliUsage());
        return 2;
      }
      const n = Number(t);
      timeout = Number.isInteger(n) ? n : t;
    } else if (a === "--on") {
      on = args[++i];
      if (!on) {
        console.error(cliUsage());
        return 2;
      }
    } else if (a === "--readonly") {
      readonly = true;
    } else if (a === "--repo") {
      repo = resolve(args[++i] ?? "");
      if (!repo) {
        console.error(cliUsage());
        return 2;
      }
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      console.error(cliUsage());
      return 2;
    }
  }
  if (!after) {
    console.error(cliUsage());
    return 2;
  }
  if (!prompt && !skillGiven) {
    skill = id;
    skillGiven = true;
  }
  if (skillGiven) {
    const skillName = String(skill ?? id);
    if (!isSimpleSkillName(skillName) && !isSafeRelativePath(skillName)) {
      console.error(`error: invalid --skill "${skillName}" (must match /^[a-z0-9][a-z0-9_-]*$/ or be a relative path inside repo)`);
      return 2;
    }
    if (!isSafeRelativePath(skillName)) {
      console.error(`error: --skill "${skillName}" escapes repository root`);
      return 2;
    }
  }
  if (prompt) {
    if (!isSafeRelativePath(prompt)) {
      console.error(`error: --prompt "${prompt}" escapes repository root`);
      return 2;
    }
    try {
      assertInsideRepo(repo, prompt, "--prompt");
    } catch (err) {
      console.error(`error: ${err.message}`);
      return 2;
    }
  }

  const gpath = join(repo, ".atomic", "graph.yaml");
  if (!existsSync(gpath)) {
    console.error(`error: graph.yaml not found: ${gpath}`);
    return 1;
  }
  const text = readFileSync(gpath, "utf8");
  const parsed = parseGraphYaml(text);
  let doc;
  let migrated = false;
  if (parsed.version !== 2) {
    const v1nodes = parsed.nodes ?? {};
    doc = normalizeV1(/** @type {Record<string, Record<string, unknown>>} */ (v1nodes));
    migrated = true;
    // Sanitize normalizeV1 defaults for minimal v1 graphs so the migrated
    // doc validates: drop max_loops entries for missing nodes and point
    // entry.default at an existing node when router is absent.
    {
      const nodeIds = Object.keys(doc.nodes ?? {});
      if (doc.limits && typeof doc.limits === "object" && !Array.isArray(doc.limits)) {
        const ml = doc.limits.max_loops;
        if (ml && typeof ml === "object" && !Array.isArray(ml)) {
          for (const k of Object.keys(ml)) {
            if (!nodeIds.includes(k)) delete ml[k];
          }
        }
      }
      if (doc.entry && typeof doc.entry === "object" && !Array.isArray(doc.entry)) {
        if (typeof doc.entry.default !== "string" || !nodeIds.includes(doc.entry.default)) {
          if (after && nodeIds.includes(after)) doc.entry.default = after;
          else if (nodeIds.length > 0) doc.entry.default = nodeIds[0];
          else delete doc.entry.default;
        }
      }
    }
    // Backup and migration notice are deferred until validation succeeds
    // (see write step below) so failed commands leave no `.v1.bak` behind
    // and never claim migration succeeded.
  } else {
    doc = parsed.doc;
  }
  if (doc.nodes[id]) {
    console.error(`error: node "${id}" already exists`);
    return 1;
  }
  if (!doc.nodes[after]) {
    console.error(`error: graph.yaml: node "${after}" is not defined`);
    return 1;
  }
  if (before && !doc.nodes[before] && !RESERVED_TARGETS.includes(before)) {
    console.error(`error: graph.yaml: node "${before}" is not defined`);
    return 1;
  }

  /** @type {Record<string, unknown>} */
  const newNode = {};
  if (skillGiven) newNode.skill = skill ?? id;
  if (prompt) newNode.prompt = prompt;
  if (executor) newNode.executor = executor;
  if (timeout !== null) newNode.timeout = timeout;
  if (readonly) newNode.readonly = true;

  // rewiring
  const edges = Array.isArray(doc.edges) ? doc.edges.map((e) => ({ ...e })) : [];
  const onIncludes = (edgeOn, want) => {
    if (Array.isArray(edgeOn)) return edgeOn.includes(want);
    return edgeOn === want;
  };
  const matchingIdx = [];
  edges.forEach((e, i) => {
    if (e.from !== after) return;
    if (!onIncludes(e.on, on)) return;
    if (before) {
      const tos = Array.isArray(e.to) ? e.to : [e.to];
      if (!tos.includes(before)) return;
    }
    matchingIdx.push(i);
  });

  /** @type {string[]} */
  const oldTargets = [];
  if (matchingIdx.length === 0) {
    if (before) {
      console.error(`error: no edge found from "${after}" to "${before}" with on "${on}"`);
      return 1;
    }
    edges.push({ from: after, to: id, on });
    edges.push({ from: id, to: "$end", on: "pass" });
  } else {
    /** @type {Array<Record<string, unknown>>} */
    const splitEdges = [];
    for (const i of matchingIdx) {
      const e = edges[i];
      const tos = Array.isArray(e.to) ? [...e.to] : [e.to];
      if (before) {
        if (Array.isArray(e.on) && e.on.length > 1) {
          // Split: keep the existing edge for the other outcomes,
          // add a distinct edge carrying only `on` through the new node.
          e.on = e.on.filter((x) => x !== on);
          if (e.on.length === 1) e.on = e.on[0];
          const replaced = tos.map((t) => (t === before ? id : t));
          splitEdges.push({ from: after, to: replaced.length === 1 ? replaced[0] : replaced, on });
          oldTargets.push(before);
        } else {
          oldTargets.push(before);
          // replace only `before` with id, keep others
          const replaced = tos.map((t) => (t === before ? id : t));
          e.to = replaced.length === 1 ? replaced[0] : replaced;
        }
      } else {
        if (Array.isArray(e.on) && e.on.length > 1) {
          // Split: keep the existing edge for the other outcomes,
          // add a distinct edge carrying only `on` to the new node.
          e.on = e.on.filter((x) => x !== on);
          if (e.on.length === 1) e.on = e.on[0];
          splitEdges.push({ from: after, to: id, on });
          for (const t of tos) oldTargets.push(String(t));
        } else {
          for (const t of tos) oldTargets.push(String(t));
          e.to = id;
        }
      }
    }
    edges.push(...splitEdges);
    const uniqOld = [...new Set(oldTargets)];
    const toVal = uniqOld.length === 1 ? uniqOld[0] : uniqOld;
    edges.push({ from: id, to: toVal, on: "pass" });
    edges.push({ from: id, to: after, on: "fail" });
  }

  const newNodes = { ...doc.nodes, [id]: newNode };
  const newDoc = {
    version: 2,
    defaults: doc.defaults ?? {},
    limits: doc.limits ?? {},
    gates: doc.gates ?? {},
    entry: doc.entry ?? {},
    nodes: newNodes,
    edges,
  };

  const { errors } = validateGraphV2(
    { version: 2, defaults: newDoc.defaults, limits: newDoc.limits, gates: newDoc.gates, entry: newDoc.entry, nodes: newNodes, edges },
    { executorIds: EXECUTOR_IDS },
  );
  const yaml = serializeGraphV2(newDoc);

  if (dryRun) {
    if (errors.length > 0) {
      for (const e of errors) console.error(`error: ${e}`);
      return 1;
    }
    if (migrated) {
      console.log("migrated graph.yaml v1 -> v2 (backup: graph.yaml.v1.bak)");
    }
    console.log(yaml);
    return 0;
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`error: ${e}`);
    return 1;
  }

  // backup + write: v1 migrations back up the original text to `.v1.bak`;
  // v2 edits back up to `.bak`. Only reached after validation passes.
  if (migrated) {
    writeFileSync(`${gpath}.v1.bak`, text, "utf8");
    console.log("migrated graph.yaml v1 -> v2 (backup: graph.yaml.v1.bak)");
  } else {
    try {
      copyFileSync(gpath, `${gpath}.bak`);
    } catch {
      // ignore
    }
  }
  writeFileSync(gpath, yaml, "utf8");

  // scaffolds
  if (skillGiven) {
    const skillName = String(skill ?? id);
    let skillPath;
    try {
      skillPath = assertInsideRepo(repo, join(".agents", "skills", skillName, "SKILL.md"), "--skill");
    } catch (err) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    if (!existsSync(skillPath)) {
      mkdirSync(dirname(skillPath), { recursive: true });
      writeFileSync(skillPath, buildSkillFile(skillName, id), "utf8");
    }
  }
  if (prompt) {
    let promptPath;
    try {
      promptPath = assertInsideRepo(repo, prompt, "--prompt");
    } catch (err) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    if (!existsSync(promptPath)) {
      mkdirSync(dirname(promptPath), { recursive: true });
      writeFileSync(promptPath, buildPromptFile(id), "utf8");
    }
  }

  return 0;
}

async function graphCliMain(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.error(cliUsage());
    return 2;
  }
  if (cmd === "lint") return cliLint(rest);
  if (cmd === "add-node") return cliAddNode(rest);
  console.error(cliUsage());
  return 2;
}

const isGraphMain =
  typeof process !== "undefined" &&
  process.argv?.[1]?.endsWith("graph.mjs");
if (isGraphMain) {
  graphCliMain(process.argv.slice(2)).then((code) => process.exit(code ?? 0));
}

/** Executor ids that only run inside Cursor. */
export const CURSOR_ONLY_EXECUTORS = ["cursor-sdk", "cursor-subagent", "cursor-agent"];

/**
 * Rewrites Cursor-only executor ids to `opencode` for opencode-only installs.
 * Text-level rewrite; every other line is preserved verbatim.
 * @param {string} text graph.yaml contents
 * @param {{ hasOpencode?: boolean, hasCursor?: boolean }} [harnesses]
 * @returns {{ text: string, replaced: number }}
 */
export function rewriteGraphExecutors(text, harnesses = {}) {
  const hasOpencode = harnesses.hasOpencode === true;
  const hasCursor = harnesses.hasCursor === true;
  const source = typeof text === "string" ? text : "";
  if (!hasOpencode || hasCursor) return { text: source, replaced: 0 };

  let replaced = 0;
  const pattern = new RegExp(
    `^([ \\t]*)executor:[ \\t]*(?:${CURSOR_ONLY_EXECUTORS.join("|")})[ \\t\\r]*$`,
    "gm",
  );
  const next = source.replace(pattern, (_match, indent) => {
    replaced += 1;
    return `${indent}executor: opencode`;
  });
  return { text: next, replaced };
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
  if (PHASE_TO_GRAPH_STAGE[phaseKey]) return PHASE_TO_GRAPH_STAGE[phaseKey];
  if (GRAPH_STAGE_IDS.includes(phaseKey)) return phaseKey;
  return null;
}
