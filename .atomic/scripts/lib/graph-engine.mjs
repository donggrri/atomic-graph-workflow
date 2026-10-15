// Doc notes (kept as code comments to avoid a separate docs change):
// - `touches` (file lists used for gate matching) come from the authoritative
//   provider: `facts.touches` supplied from `git diff` by the wiring PR.
// - `nextStep` gates on the UNION of `facts.touches` (authoritative) and the
//   model-reported `result.touches` (advisory). The model can only ADD gates
//   via extra touches, never remove gates required by authoritative touches.
// - Legacy string `gatesApproved` entries are ignored for step-scoped matching;
//   only `{gate, step}` entries with `entry.step === step` satisfy a gate.
// - `merge.always` is forced to `true`: doc `gates.merge` may add `match`
//   patterns but cannot disable the always-on `$end` merge gate.
// - `evalWhen` errors inside `allowedTransitions` treat that edge as not taken
//   and are surfaced via `decision.warnings` (no uncaught throw).
// - `!` binds tighter than `==`/`!=`/`in` (applies to the unary operand only).
// - Touched paths normalize `\` to `/`; absolute or repo-escaping touches are
//   treated as touching every gate (conservative).
import { posix as posixPath } from "node:path";
import { KNOWN_OUTCOMES, RESERVED_TARGETS } from "./graph-schema.mjs";

export const DEFAULT_LIMITS = {
  max_steps: 30,
  max_loops: { execute: 3, spec: 2 },
  max_visits: 3,
};

const DEFAULT_GATE_DEFS = {
  db: { match: ["**/migrations/**", "**/*.sql", "**/schema.*"] },
  auth: { match: ["**/auth/**", "**/*session*", "**/*token*"] },
  merge: { always: true },
  ci: { match: [".github/workflows/**", "**/.gitlab-ci.yml"] },
  deps: {
    match: [
      "**/package.json",
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/requirements*.txt",
      "**/pyproject.toml",
      "**/go.mod",
      "**/go.sum",
      "**/Cargo.toml",
      "**/Cargo.lock",
    ],
  },
};

function cloneDeep(v) {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

// ---------- evalWhen ----------

function isIdentStart(ch) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentChar(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === ",") {
      tokens.push({ type: ch, value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "&" || ch === "|" || ch === "=" || ch === "!") {
      const two = input.slice(i, i + 2);
      if (two === "&&" || two === "||" || two === "==" || two === "!=") {
        tokens.push({ type: two, value: two, pos: i });
        i += 2;
        continue;
      }
      if (ch === "!") {
        tokens.push({ type: "!", value: "!", pos: i });
        i++;
        continue;
      }
      tokens.push({ type: "bad", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < n) {
        const c = input[j];
        if (c === "\\" && j + 1 < n) {
          const nxt = input[j + 1];
          if (nxt === "n") out += "\n";
          else if (nxt === "t") out += "\t";
          else if (nxt === "r") out += "\r";
          else out += nxt;
          j += 2;
          continue;
        }
        if (c === quote) {
          if (quote === "'" && input[j + 1] === "'") {
            out += "'";
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        out += c;
        j++;
      }
      if (!closed) {
        return { error: "unterminated string", tokens: null };
      }
      tokens.push({ type: "string", value: out, pos: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9]/.test(input[j])) j++;
      if (input[j] === "." && /[0-9]/.test(input[j + 1] ?? "")) {
        j++;
        while (j < n && /[0-9]/.test(input[j])) j++;
      }
      const raw = input.slice(i, j);
      tokens.push({ type: "number", value: Number(raw), pos: i });
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isIdentChar(input[j])) j++;
      while (input[j] === "." && isIdentStart(input[j + 1] ?? "")) {
        j++;
        while (j < n && isIdentChar(input[j])) j++;
      }
      const raw = input.slice(i, j);
      tokens.push({ type: "ident", value: raw, pos: i });
      i = j;
      continue;
    }
    if (ch === ".") {
      tokens.push({ type: "bad", value: ch, pos: i });
      i++;
      continue;
    }
    tokens.push({ type: "bad", value: ch, pos: i });
    i++;
  }
  return { error: null, tokens };
}

function resolvePath(ctx, dotted) {
  let cur = ctx;
  for (const part of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Tiny safe expression evaluator (no eval/Function).
 * @param {string} expr
 * @param {Record<string, unknown>} [ctx]
 * @returns {boolean}
 */
export function evalWhen(expr, ctx = {}) {
  const fail = (reason) => {
    throw new Error(`when: ${reason} in "${expr}"`);
  };
  if (typeof expr !== "string" || expr.trim() === "") {
    fail("empty expression");
  }
  const { error, tokens } = tokenize(expr);
  if (error) fail(error);
  let pos = 0;
  const peek = () => tokens[pos] ?? null;
  const next = () => tokens[pos++] ?? null;

  function parseOr() {
    let left = parseAnd();
    for (;;) {
      const t = peek();
      if (t && t.type === "||") {
        next();
        const right = parseAnd();
        left = Boolean(left) || Boolean(right);
      } else return left;
    }
  }

  function parseAnd() {
    let left = parseComparison();
    for (;;) {
      const t = peek();
      if (t && t.type === "&&") {
        next();
        const right = parseComparison();
        left = Boolean(left) && Boolean(right);
      } else return left;
    }
  }

  function parseComparison() {
    let left = parseUnary();
    let compared = false;
    for (;;) {
      const t = peek();
      if (t && (t.type === "==" || t.type === "!=")) {
        if (compared) fail("chained comparison not allowed");
        next();
        const right = parseUnary();
        // strict equality; null and undefined compare equal to each other only
        const bothNullish =
          (left === null || left === undefined) && (right === null || right === undefined);
        const eq = bothNullish ? true : left === right;
        left = t.type === "==" ? eq : !eq;
        compared = true;
        continue;
      }
      if (t && t.type === "ident" && t.value === "in") {
        if (compared) fail("chained comparison not allowed");
        next();
        const arr = parsePrimary();
        if (!Array.isArray(arr)) fail("`in` requires an array literal");
        left = arr.includes(left);
        compared = true;
        continue;
      }
      return left;
    }
  }

  // `!` binds tighter than `==`/`!=`/`in`: it applies to the unary operand
  // only, so `!a == b` parses as `(!a) == b` and `!x in [...]` as `(!x) in [...]`.
  function parseUnary() {
    const t = peek();
    if (t && t.type === "!") {
      next();
      const v = parseUnary();
      return !v;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = next();
    if (!t) fail("unexpected end");
    if (t.type === "(") {
      const v = parseOr();
      const c = next();
      if (!c || c.type !== ")") fail("missing closing paren");
      return v;
    }
    if (t.type === "[") {
      const arr = [];
      const p = peek();
      if (p && p.type === "]") {
        next();
        return arr;
      }
      for (;;) {
        arr.push(parseOr());
        const s = next();
        if (!s) fail("missing closing bracket");
        if (s.type === ",") continue;
        if (s.type === "]") break;
        fail("expected `,` or `]`");
      }
      return arr;
    }
    if (t.type === "string" || t.type === "number") return t.value;
    if (t.type === "ident") {
      if (t.value === "true") return true;
      if (t.value === "false") return false;
      if (t.value === "null") return null;
      if (t.value === "in") fail("unexpected `in`");
      return resolvePath(ctx ?? {}, t.value);
    }
    if (t.type === "bad") fail(`unexpected token "${t.value}"`);
    fail(`unexpected token "${t.value}"`);
    return undefined;
  }

  const result = parseOr();
  if (pos < tokens.length) {
    const t = tokens[pos];
    fail(`unexpected token "${t.value}"`);
  }
  return Boolean(result);
}

// ---------- allowedTransitions ----------

/**
 * @param {Record<string, any>} doc
 * @param {string} node
 * @param {string} outcome
 * @param {Record<string, unknown>} [ctx]
 * @param {string[]} [warnings] optional out-param collecting `when` eval errors;
 *   an edge whose `when` throws is treated as not taken (no throw).
 */
export function allowedTransitions(doc, node, outcome, ctx = {}, warnings) {
  const edges = Array.isArray(doc?.edges) ? doc.edges : [];
  const out = [];
  edges.forEach((e, edgeIndex) => {
    if (e == null || typeof e !== "object" || Array.isArray(e)) return;
    const from = e.from;
    if (from !== node && from !== "*") return;
    const on = Array.isArray(e.on) ? e.on : [e.on];
    if (!on.includes(outcome)) return;
    if (typeof e.when === "string" && e.when.trim() !== "") {
      let take = false;
      try {
        take = evalWhen(e.when, ctx ?? {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (Array.isArray(warnings)) warnings.push(msg);
        return;
      }
      if (!take) return;
    }
    const priority = Number.isInteger(e.priority) ? e.priority : 0;
    const tos = Array.isArray(e.to) ? e.to : [e.to];
    tos.forEach((t, toOrder) => {
      if (typeof t !== "string") return;
      out.push({
        target: t,
        edgeIndex,
        priority,
        _star: from === "*" ? 1 : 0,
        _order: toOrder,
      });
    });
  });
  out.sort(
    (a, b) =>
      a._star - b._star ||
      b.priority - a.priority ||
      a.edgeIndex - b.edgeIndex ||
      a._order - b._order,
  );
  const seen = new Set();
  const deduped = [];
  for (const c of out) {
    if (seen.has(c.target)) continue;
    seen.add(c.target);
    deduped.push({ target: c.target, edgeIndex: c.edgeIndex, priority: c.priority });
  }
  return deduped;
}

// ---------- validateAtomicResult ----------

/**
 * @param {unknown} result
 * @param {{ doc?: any, node?: string, ctx?: any }} [opts]
 */
export function validateAtomicResult(result, { doc, node, ctx } = {}) {
  void doc;
  void ctx;
  const errors = [];
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, errors: ["result must be an object"], result };
  }
  const r = /** @type {Record<string, any>} */ (result);
  if (r.atomic_result !== 1) {
    errors.push(`atomic_result must be 1 (got ${JSON.stringify(r.atomic_result)})`);
  }
  if (r.node !== node) {
    errors.push(`node must be "${String(node)}" (got ${JSON.stringify(r.node)})`);
  }
  if (typeof r.outcome !== "string" || !KNOWN_OUTCOMES.includes(r.outcome)) {
    errors.push(
      `outcome ${JSON.stringify(r.outcome)} is not a known outcome (must be one of ${KNOWN_OUTCOMES.join(", ")})`,
    );
  }
  if ("next" in r && r.next !== undefined && r.next !== null) {
    if (typeof r.next !== "string" || r.next.length === 0) {
      errors.push("next must be a non-empty string");
    }
  }
  if ("reason" in r && r.reason !== undefined && typeof r.reason !== "string") {
    errors.push("reason must be a string");
  }
  if ("ac" in r && r.ac !== undefined) {
    if (r.ac == null || typeof r.ac !== "object" || Array.isArray(r.ac)) {
      errors.push("ac must be an object of AC-id -> pass|fail|uncovered");
    } else {
      for (const [k, v] of Object.entries(r.ac)) {
        if (v !== "pass" && v !== "fail" && v !== "uncovered") {
          errors.push(`ac[${JSON.stringify(k)}] must be pass|fail|uncovered (got ${JSON.stringify(v)})`);
        }
      }
    }
  }
  if ("touches" in r && r.touches !== undefined) {
    if (!Array.isArray(r.touches) || !r.touches.every((e) => typeof e === "string")) {
      errors.push("touches must be a string array");
    }
  }
  if ("questions" in r && r.questions !== undefined) {
    if (!Array.isArray(r.questions) || !r.questions.every((e) => typeof e === "string")) {
      errors.push("questions must be a string array");
    }
  }
  return { ok: errors.length === 0, errors, result };
}

// ---------- applyFacts ----------

/**
 * @param {Record<string, any>} result
 * @param {{ testsExitCode?: unknown, acStatus?: unknown }} [facts]
 */
export function applyFacts(result, facts = {}) {
  const out = { ...(result ?? {}) };
  const originalOutcome = result?.outcome;
  let overridden = false;
  const code = facts?.testsExitCode;
  if (typeof code === "number" && !Number.isNaN(code) && code !== 0 && out.outcome === "pass") {
    out.outcome = "fail";
    const prev = typeof out.reason === "string" ? out.reason : "";
    out.reason = `fact: tests failed; ${prev}`;
    overridden = true;
  }
  const acStatus = facts?.acStatus;
  if (
    acStatus != null &&
    typeof acStatus === "object" &&
    !Array.isArray(acStatus) &&
    out.outcome === "pass"
  ) {
    const values = Object.values(acStatus);
    if (values.some((v) => v === "fail")) {
      out.outcome = "fail";
      const prev = typeof out.reason === "string" ? out.reason : "";
      out.reason = `fact: ac failed; ${prev}`;
      overridden = true;
    } else if (values.some((v) => v === "uncovered")) {
      out.outcome = "spec_mismatch";
      overridden = true;
    }
  }
  out.overridden = overridden;
  if (overridden) out.originalOutcome = originalOutcome;
  return out;
}

// ---------- glob ----------

function globToRegExp(glob) {
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if ("+()|^$.{}[]\\".includes(c)) {
      re += `\\${c}`;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re);
}

function globMatch(pattern, path) {
  try {
    return globToRegExp(pattern).test(path);
  } catch {
    return false;
  }
}

// ---------- touch normalization ----------

/**
 * Normalize a touched path before glob matching.
 * - convert backslashes to "/" (Windows-style separators)
 * - strip leading "./" segments
 * - collapse "a/../b" via path.posix.normalize
 * - drop leading "/" segments (for glob matching; absoluteness is checked
 *   separately before normalization and treated as touching every gate)
 * @param {unknown} raw
 * @returns {string|null} normalized path, or null for non-strings
 */
function normalizeTouchPath(raw) {
  if (typeof raw !== "string") return null;
  let p = raw.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  try {
    p = posixPath.normalize(p);
  } catch {
    // keep pre-normalize value on unexpected error
  }
  while (p.startsWith("/")) p = p.slice(1);
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/**
 * @param {string} normalized
 * @returns {boolean} true when the normalized path escapes the repo (starts with "../" or equals "..")
 */
function isEscapingTouch(normalized) {
  return normalized === ".." || normalized.startsWith("../");
}

/**
 * @param {string} slashPath path with backslashes already converted to "/"
 * @returns {boolean} true for absolute paths (POSIX "/" or Windows "C:/")
 */
function isAbsoluteTouch(slashPath) {
  return slashPath.startsWith("/") || /^[A-Za-z]:\//.test(slashPath);
}

// ---------- matchGates ----------

/**
 * Compute pending gates for a transition.
 * @param {Record<string, any>} doc
 * @param {{ node?: string, touches?: string[], gatesApproved?: Array<string|{gate:string,step:number}>, target?: string, step?: number }} [opts]
 * @returns {string[]}
 *
 * NOTE on `touches`: the authoritative source is `facts.touches` supplied
 * from `git diff` by the wiring PR (see `nextStep`, which gates on the UNION
 * of `facts.touches` and model-reported `result.touches`). Passed-in touches
 * here are already that union; the model can only ADD gates, never remove
 * gates required by authoritative touches.
 * Legacy string `gatesApproved` entries are IGNORED for step-scoped matching;
 * only `{gate, step}` entries with `entry.step === step` satisfy a gate.
 * `merge.always` is forced to `true`: doc `gates.merge` may add `match`
 * patterns but cannot disable the always-on `$end` merge gate.
 */
export function matchGates(doc, { node, touches = [], gatesApproved = [], target, step } = {}) {
  const nodeDef = doc?.nodes?.[node] ?? {};
  const requires = Array.isArray(nodeDef.requires_approval) ? nodeDef.requires_approval : [];
  const rawGates = doc?.gates;
  const hasGates = rawGates != null && typeof rawGates === "object" && !Array.isArray(rawGates);
  // Per-gate merge over defaults; doc may add gates or extend `match` lists,
  // but `merge.always` is forced true (doc cannot disable the $end merge gate).
  const gates = { ...DEFAULT_GATE_DEFS };
  if (hasGates) {
    for (const [gid, gdef] of Object.entries(rawGates)) {
      if (gid === "merge") {
        if (gdef != null && typeof gdef === "object" && !Array.isArray(gdef)) {
          gates.merge = { ...gdef, always: true };
        } else {
          // `merge: null` (or non-object) cannot disable the gate; keep default.
          gates.merge = { ...DEFAULT_GATE_DEFS.merge, always: true };
        }
        continue;
      }
      gates[gid] = gdef;
    }
  }
  // Belt-and-braces: merge is always on even when doc.gates is missing.
  if (gates.merge != null && typeof gates.merge === "object" && !Array.isArray(gates.merge)) {
    gates.merge.always = true;
  } else {
    gates.merge = { ...DEFAULT_GATE_DEFS.merge, always: true };
  }
  const approvedList = Array.isArray(gatesApproved) ? gatesApproved : [];
  const isApproved = (gid) => {
    for (const entry of approvedList) {
      // Legacy string entries NEVER satisfy step-scoped gates; ignore them.
      if (typeof entry === "string") continue;
      if (entry != null && typeof entry === "object" && !Array.isArray(entry)) {
        if (entry.gate !== gid) continue;
        if (step === undefined) return true;
        if (entry.step === step) return true;
      }
    }
    return false;
  };
  const pending = [];
  const push = (id) => {
    if (isApproved(id)) return;
    if (!pending.includes(id)) pending.push(id);
  };
  for (const id of requires) {
    if (typeof id === "string") push(id);
  }
  const touchList = Array.isArray(touches) ? touches : [];
  const normalizedTouches = [];
  let escaping = false;
  for (const raw of touchList) {
    if (typeof raw !== "string") continue;
    // Absolute paths ("/...", "C:/...") or backslash variants are conservative:
    // they touch every gate. Check before normalization strips the leading "/".
    const slash = raw.replace(/\\/g, "/");
    if (isAbsoluteTouch(slash)) {
      escaping = true;
      break;
    }
    const n = normalizeTouchPath(raw);
    if (n == null) continue;
    if (isEscapingTouch(n)) {
      escaping = true;
      break;
    }
    normalizedTouches.push(n);
  }
  if (escaping) {
    // Conservative: an absolute or escaping path ("../...", "/etc/...",
    // "C:/...", "..\\...") is treated as touching every gate.
    for (const gid of Object.keys(gates)) push(gid);
    return pending;
  }
  for (const [gid, gdef] of Object.entries(gates)) {
    if (isApproved(gid)) continue;
    if (gdef == null || typeof gdef !== "object" || Array.isArray(gdef)) continue;
    // NOTE: `always:true` gates are NOT skipped here so a doc-added `match`
    // list on `merge` still fires on touches; the `$end` block below keeps the
    // always-on guarantee regardless of matches.
    const patterns = Array.isArray(gdef.match) ? gdef.match : [];
    for (const pat of patterns) {
      if (typeof pat !== "string") continue;
      const patForMatch = gid === "auth" ? pat.toLowerCase() : pat;
      const matched = normalizedTouches.some((p) => {
        if (typeof p !== "string") return false;
        const pathForMatch = gid === "auth" ? p.toLowerCase() : p;
        return globMatch(patForMatch, pathForMatch);
      });
      if (matched) {
        push(gid);
        break;
      }
    }
  }
  if (target === "$end") {
    for (const [gid, gdef] of Object.entries(gates)) {
      if (gdef != null && typeof gdef === "object" && !Array.isArray(gdef) && gdef.always === true) {
        push(gid);
      }
    }
  }
  return pending;
}

// ---------- nextStep ----------

function effectiveLimits(doc) {
  const max_steps = doc?.limits?.max_steps ?? DEFAULT_LIMITS.max_steps;
  const max_loops = {
    ...DEFAULT_LIMITS.max_loops,
    ...((doc?.limits?.max_loops ?? {})),
  };
  const defaultMaxVisits = doc?.defaults?.max_visits ?? DEFAULT_LIMITS.max_visits;
  return { max_steps, max_loops, defaultMaxVisits };
}

function maxVisitsFor(doc, target, defaultMaxVisits) {
  const n = doc?.nodes?.[target];
  let base = defaultMaxVisits;
  let hasExplicitVisits = Number.isInteger(doc?.defaults?.max_visits);
  if (n != null && typeof n === "object" && !Array.isArray(n) && Number.isInteger(n.max_visits)) {
    base = n.max_visits;
    hasExplicitVisits = true;
  }
  const explicitLoop = doc?.limits?.max_loops?.[target];
  const loopLimit = explicitLoop ?? DEFAULT_LIMITS.max_loops?.[target];
  if (loopLimit !== undefined) {
    // When both limits.max_loops[node] and max_visits are explicitly set,
    // the stricter bound wins.
    if (explicitLoop !== undefined && hasExplicitVisits) {
      return Math.min(base, explicitLoop + 1);
    }
    // Legacy: limits.max_loops takes precedence over max_visits: allow at least max_loops + 1 visits
    return Math.max(base, loopLimit + 1);
  }
  return base;
}

/**
 * Lint limit config: warn when max_loops[node] exceeds max_visits.
 * @param {Record<string, any>} doc
 * @returns {string|null} warning string when limits.max_loops[node] > max_visits for that node, else null
 */
export function lintLimits(doc) {
  const maxLoops = doc?.limits?.max_loops;
  if (maxLoops == null || typeof maxLoops !== "object" || Array.isArray(maxLoops)) return null;
  const defaultVisits = doc?.defaults?.max_visits ?? DEFAULT_LIMITS.max_visits;
  for (const [node, loopLimit] of Object.entries(maxLoops)) {
    if (!Number.isInteger(loopLimit)) continue;
    const n = doc?.nodes?.[node];
    let visits = defaultVisits;
    if (n != null && typeof n === "object" && !Array.isArray(n) && Number.isInteger(n.max_visits)) {
      visits = n.max_visits;
    }
    if (loopLimit > visits) {
      return `limits.max_loops["${node}"] (${loopLimit}) > max_visits (${visits}) for node "${node}"`;
    }
  }
  return null;
}

function normalizeState(state) {
  const s = state ?? {};
  return {
    steps: typeof s.steps === "number" ? s.steps : 0,
    visits: s.visits != null && typeof s.visits === "object" ? { ...s.visits } : {},
    loops: s.loops != null && typeof s.loops === "object" ? { ...s.loops } : {},
    history: Array.isArray(s.history) ? [...s.history] : [],
    cursor: s.cursor != null && typeof s.cursor === "object" ? { ...s.cursor } : { node: undefined },
    gatesApproved: Array.isArray(s.gatesApproved) ? [...s.gatesApproved] : [],
    ctx: s.ctx != null && typeof s.ctx === "object" ? { ...s.ctx } : {},
  };
}

/**
 * @param {Record<string, any>} state
 * @param {Record<string, any>} doc
 * @param {unknown} rawResult
 * @param {{ testsExitCode?: unknown, acStatus?: unknown, touches?: unknown }} [facts]
 *   `facts.touches` is the authoritative touched-path list supplied from
 *   `git diff` by the wiring PR. Gate matching uses the UNION of
 *   `facts.touches` and model-reported `result.touches`: the model can only
 *   ADD gates via extra touches, never remove gates required by `facts.touches`.
 */
export function nextStep(state, doc, rawResult, facts = {}) {
  const s = normalizeState(cloneDeep(state));
  const curNode = s.cursor?.node;
  const ctx = s.ctx ?? {};
  // Unified step counter: history step numbers derive from state.steps only.
  const stepNo = s.steps + 1;

  const validation = validateAtomicResult(rawResult, { doc, node: curNode, ctx });
  if (!validation.ok) {
    const { max_steps: maxStepsForInvalid } = effectiveLimits(doc);
    // Count trailing consecutive invalid_result entries for the same node.
    // Invalid entries are marked with next === null.
    let consecutiveInvalid = 0;
    for (let i = s.history.length - 1; i >= 0; i--) {
      const h = s.history[i];
      if (h != null && typeof h === "object" && h.node === curNode && h.next === null) {
        consecutiveInvalid += 1;
      } else {
        break;
      }
    }
    // After 2 consecutive invalid_result for the same node, escalate to $user.
    // Current failure would be consecutiveInvalid + 1; escalate when that reaches 2.
    if (consecutiveInvalid + 1 >= 2 || s.steps + 1 > maxStepsForInvalid) {
      const entry = {
        step: stepNo,
        node: curNode,
        outcome: rawResult?.outcome,
        next: "$user",
        accepted: false,
        overridden: false,
      };
      s.history = [...s.history, entry];
      s.cursor = { ...(s.cursor ?? {}), status: "waiting_user" };
      return {
        state: s,
        decision: {
          kind: "escalate",
          reason:
            consecutiveInvalid + 1 >= 2
              ? `invalid result repeated 2 times for "${curNode}"`
              : `max steps exceeded with invalid results (${s.steps} + 1 > ${maxStepsForInvalid})`,
          target: "$user",
          proposalAccepted: false,
          overridden: false,
        },
      };
    }
    const entry = {
      step: stepNo,
      node: curNode,
      outcome: rawResult?.outcome,
      next: null,
      accepted: false,
      overridden: false,
    };
    s.history = [...s.history, entry];
    return { state: s, decision: { kind: "invalid_result", errors: validation.errors, retry: true } };
  }

  const after = applyFacts(validation.result, facts ?? {});
  const overridden = Boolean(after.overridden);
  const outcome = after.outcome;
  const reasonStr = typeof after.reason === "string" ? after.reason : "";

  // `when` eval errors must not crash the engine: a throwing edge is not taken
  // and its error is surfaced via `decision.warnings`.
  const whenWarnings = [];
  const candidates = allowedTransitions(doc, curNode, outcome, ctx, whenWarnings);
  const warnProp = whenWarnings.length > 0 ? { warnings: [...whenWarnings] } : {};

  let target;
  let accepted = false;
  if (candidates.length === 0) {
    target = "$halt";
    accepted = false;
    const entry = {
      step: stepNo,
      node: curNode,
      outcome,
      reason: reasonStr,
      next: target,
      accepted: false,
      overridden,
    };
    s.history = [...s.history, entry];
    return {
      state: s,
      decision: {
        kind: "halt",
        reason: `no edge for ${curNode}/${outcome}`,
        target,
        proposalAccepted: false,
        overridden,
        ...warnProp,
      },
    };
  }

  const proposed =
    typeof after.next === "string" && after.next.length > 0 ? after.next : null;
  if (proposed && candidates.some((c) => c.target === proposed)) {
    target = proposed;
    accepted = true;
  } else {
    target = candidates[0].target;
    accepted = false;
  }

  const { max_steps, max_loops, defaultMaxVisits } = effectiveLimits(doc);

  // loop accounting (deferred: only committed when the transition actually moves;
  // gate pauses must not increment loops or history)
  const visits = s.visits;
  const loops = s.loops;
  const wasVisited = (visits[target] ?? 0) > 0;
  const isSelf = target === curNode;
  const loopIncremented = (isSelf || wasVisited) && !RESERVED_TARGETS.includes(target);
  const prospectiveLoopCount = loopIncremented ? (loops[target] ?? 0) + 1 : (loops[target] ?? 0);

  const escalateEntry = (reason) => {
    const entry = {
      step: stepNo,
      node: curNode,
      outcome,
      reason: reasonStr,
      next: "$user",
      accepted,
      overridden,
    };
    s.history = [...s.history, entry];
    s.cursor = { ...(s.cursor ?? {}), status: "waiting_user" };
    return {
      state: s,
      decision: {
        kind: "escalate",
        reason,
        target: "$user",
        proposalAccepted: accepted,
        overridden,
        ...warnProp,
      },
    };
  };

  if (loopIncremented && max_loops[target] !== undefined && prospectiveLoopCount > max_loops[target]) {
    return escalateEntry(
      `loop limit exceeded for "${target}" (${prospectiveLoopCount} > ${max_loops[target]})`,
    );
  }
  if (!RESERVED_TARGETS.includes(target)) {
    const mv = maxVisitsFor(doc, target, defaultMaxVisits);
    if ((visits[target] ?? 0) >= mv) {
      return escalateEntry(`max visits exceeded for "${target}" (${visits[target] ?? 0} >= ${mv})`);
    }
  }
  // A transition to $end is allowed even when steps == max_steps ($end does not consume a step).
  if (target !== "$end" && s.steps + 1 > max_steps) {
    return escalateEntry(`max steps exceeded (${s.steps} + 1 > ${max_steps})`);
  }

  // repeat-reason guard: same (node, outcome, reason) 3x consecutively
  {
    const hist = s.history;
    if (hist.length >= 2) {
      const a = hist[hist.length - 2];
      const b = hist[hist.length - 1];
      const sameTriple = (e) =>
        e != null &&
        typeof e === "object" &&
        e.next !== null &&
        e.node === curNode &&
        e.outcome === outcome &&
        (typeof e.reason === "string" ? e.reason : "") === reasonStr;
      if (sameTriple(a) && sameTriple(b)) {
        return escalateEntry(`repeat: same result 3 times for "${curNode}/${outcome}"`);
      }
    }
  }

  // gates: touch-based gates apply even when the target is reserved.
  // For reserved targets the target has no node def, so the current node's
  // requires_approval applies instead; gates with always:true (e.g. merge)
  // fire on any transition whose target is "$end".
  // Gate pauses do not commit history or loop counters (committed on move).
  {
    const gateNode = RESERVED_TARGETS.includes(target) ? curNode : target;
    // UNION of authoritative `facts.touches` (git diff) and model-reported
    // `result.touches`: the model can only ADD gates, never remove them.
    const factTouches = Array.isArray(facts?.touches) ? facts.touches : [];
    const modelTouches = Array.isArray(after.touches) ? after.touches : [];
    const pending = matchGates(doc, {
      node: gateNode,
      touches: [...factTouches, ...modelTouches],
      gatesApproved: s.gatesApproved,
      target,
      step: s.steps + 1,
    });
    if (pending.length > 0) {
      s.cursor = { ...(s.cursor ?? {}), status: "waiting_gate" };
      return {
        state: s,
        decision: {
          kind: "gate",
          gates: pending,
          target,
          proposalAccepted: accepted,
          overridden,
          ...warnProp,
        },
      };
    }
  }

  const baseDecision = { proposalAccepted: accepted, overridden, ...warnProp };

  if (target === "$user") {
    const entry = {
      step: stepNo,
      node: curNode,
      outcome,
      reason: reasonStr,
      next: target,
      accepted,
      overridden,
    };
    s.history = [...s.history, entry];
    s.cursor = { ...(s.cursor ?? {}), status: "waiting_user" };
    return { state: s, decision: { kind: "ask_user", target, ...baseDecision } };
  }
  if (target === "$halt") {
    const entry = {
      step: stepNo,
      node: curNode,
      outcome,
      reason: reasonStr,
      next: target,
      accepted,
      overridden,
    };
    s.history = [...s.history, entry];
    return { state: s, decision: { kind: "halt", target, ...baseDecision } };
  }
  if (target === "$end") {
    const entry = {
      step: stepNo,
      node: curNode,
      outcome,
      reason: reasonStr,
      next: target,
      accepted,
      overridden,
    };
    s.history = [...s.history, entry];
    return { state: s, decision: { kind: "end", target, ...baseDecision } };
  }

  // move
  const entry = {
    step: stepNo,
    node: curNode,
    outcome,
    reason: reasonStr,
    next: target,
    accepted,
    overridden,
  };
  s.history = [...s.history, entry];
  s.steps = s.steps + 1;
  s.visits = { ...visits, [target]: (visits[target] ?? 0) + 1 };
  if (loopIncremented) {
    s.loops = { ...loops, [target]: prospectiveLoopCount };
  }
  s.cursor = { ...(s.cursor ?? {}), node: target, status: "running" };
  const decision = { kind: "move", target, ...baseDecision };
  if (proposed && !accepted) decision.reason = "proposal_rejected";
  return { state: s, decision };
}

/**
 * Approve a gate for the pending decision step only.
 * Approvals are scoped to {gate, step} where step is the pending decision
 * step (state.steps + 1); a later transition needing the same gate must ask again.
 * Legacy string entries in gatesApproved are IGNORED by gate matching (they
 * never satisfy a step-scoped gate).
 * @param {Record<string, any>} state
 * @param {string} gateId
 */
export function approveGate(state, gateId) {
  const s = cloneDeep(state) ?? {};
  const approved = Array.isArray(s.gatesApproved) ? [...s.gatesApproved] : [];
  const step = typeof s.steps === "number" ? s.steps + 1 : 1;
  const already = approved.some((e) => {
    if (e != null && typeof e === "object" && !Array.isArray(e)) {
      return e.gate === gateId && e.step === step;
    }
    return false;
  });
  if (!already) approved.push({ gate: gateId, step });
  s.gatesApproved = approved;
  s.cursor = { ...(s.cursor ?? {}), status: "running" };
  return s;
}
