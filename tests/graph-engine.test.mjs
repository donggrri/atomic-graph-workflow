import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGraphYaml } from "../scripts/lib/graph.mjs";
import {
  DEFAULT_LIMITS,
  evalWhen,
  allowedTransitions,
  validateAtomicResult,
  applyFacts,
  matchGates,
  nextStep,
  approveGate,
  lintLimits,
} from "../scripts/lib/graph-engine.mjs";
import { KNOWN_OUTCOMES, RESERVED_TARGETS } from "../scripts/lib/graph-schema.mjs";

function loadExample() {
  const text = readFileSync("graph.v2.example.yaml", "utf8");
  const g = parseGraphYaml(text);
  assert.deepEqual(g.errors, []);
  return g.doc;
}

function baseState(node, over = {}) {
  return {
    steps: 0,
    visits: { [node]: 1 },
    loops: {},
    history: [],
    cursor: { node, status: "running" },
    gatesApproved: [],
    ctx: {},
    ...over,
  };
}

function okResult(node, outcome, over = {}) {
  return { atomic_result: 1, node, outcome, ...over };
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---------- DEFAULT_LIMITS ----------

test("DEFAULT_LIMITS shape", () => {
  assert.deepEqual(DEFAULT_LIMITS, {
    max_steps: 30,
    max_loops: { execute: 3, spec: 2 },
    max_visits: 3,
  });
});

// ---------- evalWhen ----------

test("evalWhen operators", () => {
  assert.equal(evalWhen("class == 'bug'", { class: "bug" }), true);
  assert.equal(evalWhen('class == "bug"', { class: "feat" }), false);
  assert.equal(evalWhen("class != 'bug'", { class: "feat" }), true);
  assert.equal(evalWhen("a == 1 && b == 2", { a: 1, b: 2 }), true);
  assert.equal(evalWhen("a == 1 && b == 9", { a: 1, b: 2 }), false);
  assert.equal(evalWhen("a == 1 || b == 9", { a: 0, b: 9 }), true);
  assert.equal(evalWhen("!(a == 1)", { a: 1 }), false);
  assert.equal(evalWhen("(a == 1 || a == 2) && b == 3", { a: 2, b: 3 }), true);
  assert.equal(evalWhen("spec.mini == true", { spec: { mini: true } }), true);
  assert.equal(evalWhen("route.class == 'bug'", { route: { class: "bug" } }), true);
  assert.equal(evalWhen("class in ['a', 'b']", { class: "b" }), true);
  assert.equal(evalWhen("class in ['a', 'b']", { class: "z" }), false);
  assert.equal(evalWhen("n == 42", { n: 42 }), true);
  assert.equal(evalWhen("x == null", {}), true);
  assert.equal(evalWhen("x == null", { x: 1 }), false);
  assert.equal(evalWhen("flag == true", { flag: true }), true);
  assert.equal(evalWhen("missing == null", {}), true);
  assert.equal(evalWhen("!missing", {}), true);
});

test("evalWhen unknown identifier is undefined (falsy)", () => {
  assert.equal(evalWhen("nope", {}), false);
  assert.equal(evalWhen("a.b.c == null", {}), true);
});

test("evalWhen syntax errors", () => {
  for (const expr of ["", "   ", "a ==", "a == ", "(a == 1", "a == 1)", "'abc", "a &&", "!"]) {
    assert.throws(() => evalWhen(expr, {}), (e) => {
      assert.ok(e instanceof Error);
      assert.ok(e.message.startsWith("when: "), e.message);
      assert.ok(e.message.includes(`"${expr}"`), e.message);
      return true;
    }, expr);
  }
});

// ---------- allowedTransitions ----------

test("allowedTransitions over example: pass edges", () => {
  const doc = loadExample();
  const t = allowedTransitions(doc, "execute", "pass", {});
  assert.deepEqual(t.map((x) => x.target), ["review"]);
  assert.equal(t[0].edgeIndex, doc.edges.findIndex((e) => e.from === "execute"));
  const spec = allowedTransitions(doc, "spec", "fail", {});
  assert.deepEqual(spec.map((x) => x.target), ["spec"]);
});

test("every outcome kind over example", () => {
  const doc = loadExample();
  const cases = [
    ["explore", "pass", ["spec"]],
    ["review", "fail", ["execute"]],
    ["spec-review", "spec_mismatch", ["spec"]],
    ["spec-review", "needs_info", ["explore"]],
    ["explore", "escalate", ["$user"]],
    ["router", "route", ["lite", "explore"]],
  ];
  for (const [node, outcome, expected] of cases) {
    const got = allowedTransitions(doc, node, outcome, {}).map((x) => x.target);
    assert.deepEqual(got, expected, `${node}/${outcome}`);
  }
  // blocked has no edge in example -> empty
  assert.deepEqual(allowedTransitions(doc, "execute", "blocked", {}), []);
});

test("allowedTransitions proposal table: accepted vs first-candidate", () => {
  const doc = loadExample();
  // review/pass only -> security-scan
  let s = baseState("review");
  let r = nextStep(s, doc, okResult("review", "pass", { next: "security-scan" }));
  assert.equal(r.decision.kind, "move");
  assert.equal(r.decision.target, "security-scan");
  assert.equal(r.decision.proposalAccepted, true);

  r = nextStep(s, doc, okResult("review", "pass", { next: "execute" }));
  assert.equal(r.decision.kind, "move");
  assert.equal(r.decision.target, "security-scan");
  assert.equal(r.decision.proposalAccepted, false);
  assert.equal(r.decision.reason, "proposal_rejected");
});

test("allowedTransitions '*' fallback, priority, when, dedupe", () => {
  const doc = {
    version: 2,
    defaults: {},
    limits: {},
    gates: {},
    entry: {},
    nodes: {
      a: { skill: "x" },
      b: { skill: "x" },
      c: { skill: "x" },
    },
    edges: [
      { from: "*", to: "c", on: "pass", priority: 1 },
      { from: "a", to: ["b", "c"], on: "pass", priority: 0 },
      { from: "a", to: "c", on: "fail", when: "class == 'bug'" },
    ],
  };
  // specific before star; dedupe c
  let got = allowedTransitions(doc, "a", "pass", {}).map((x) => x.target);
  assert.deepEqual(got, ["b", "c"]);
  // when true
  got = allowedTransitions(doc, "a", "fail", { class: "bug" }).map((x) => x.target);
  assert.deepEqual(got, ["c"]);
  // when false -> empty
  got = allowedTransitions(doc, "a", "fail", { class: "feat" });
  assert.deepEqual(got, []);
  // star applies to unknown node
  got = allowedTransitions(doc, "zzz", "pass", {}).map((x) => x.target);
  assert.deepEqual(got, ["c"]);
  // priority desc within same star-class
  const doc2 = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" }, c: { skill: "x" } },
    edges: [
      { from: "a", to: "b", on: "pass", priority: 1 },
      { from: "a", to: "c", on: "pass", priority: 5 },
    ],
  };
  got = allowedTransitions(doc2, "a", "pass", {}).map((x) => x.target);
  assert.deepEqual(got, ["c", "b"]);
});

// ---------- validateAtomicResult ----------

test("validateAtomicResult ok and errors", () => {
  const doc = loadExample();
  const good = okResult("plan", "pass", {
    next: "plan-review",
    reason: "ok",
    ac: { "AC-1": "pass" },
    touches: ["a.ts"],
    questions: [],
  });
  let v = validateAtomicResult(good, { doc, node: "plan", ctx: {} });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);

  const bad = { atomic_result: 0, node: "other", outcome: "bogus", next: 5, reason: 7, ac: { x: "maybe" }, touches: "no", questions: [1] };
  v = validateAtomicResult(bad, { doc, node: "plan", ctx: {} });
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 6);
  assert.ok(v.errors.some((e) => e.includes("atomic_result")));
  assert.ok(v.errors.some((e) => e.includes('node must be "plan"')));
  assert.ok(v.errors.some((e) => e.includes("outcome")));
  assert.ok(v.errors.some((e) => e.includes("next")));
  assert.ok(v.errors.some((e) => e.includes("reason")));
  assert.ok(v.errors.some((e) => e.includes("ac")));
  assert.ok(v.errors.some((e) => e.includes("touches")));
  assert.ok(v.errors.some((e) => e.includes("questions")));

  v = validateAtomicResult(null, { doc, node: "plan" });
  assert.equal(v.ok, false);
});

// ---------- applyFacts ----------

test("applyFacts overrides", () => {
  const base = okResult("execute", "pass", { reason: "all good" });
  let out = applyFacts(base, { testsExitCode: 1 });
  assert.equal(out.outcome, "fail");
  assert.ok(out.reason.startsWith("fact: tests failed; "));
  assert.equal(out.overridden, true);
  assert.equal(out.originalOutcome, "pass");
  assert.equal(base.outcome, "pass");

  out = applyFacts(okResult("execute", "pass", { reason: "r" }), { acStatus: { "AC-1": "uncovered" } });
  assert.equal(out.outcome, "spec_mismatch");
  assert.equal(out.overridden, true);
  assert.equal(out.originalOutcome, "pass");

  // no override when not pass
  out = applyFacts(okResult("execute", "fail", { reason: "r" }), { testsExitCode: 2 });
  assert.equal(out.outcome, "fail");
  assert.equal(out.overridden, false);

  // zero exit code no override; returns new object
  const src = okResult("execute", "pass");
  out = applyFacts(src, { testsExitCode: 0 });
  assert.equal(out.outcome, "pass");
  assert.equal(out.overridden, false);
  assert.notEqual(out, src);
});

// ---------- matchGates ----------

test("matchGates each gate via touches and requires_approval", () => {
  const doc = loadExample();
  const mk = (target, touches, approved = []) => matchGates(doc, { node: target, touches, gatesApproved: approved });
  // touches trigger regardless of requires_approval
  assert.deepEqual(mk("review", ["db/foo.ts"]), ["db"]);
  assert.deepEqual(mk("review", ["src/auth/x.ts"]), ["auth"]);
  assert.deepEqual(mk("review", [".github/workflows/ci.yml"]), ["ci"]);
  assert.deepEqual(mk("review", ["package.json"]), ["deps"]);

  // always gate only via requires_approval
  const docMerge = loadExample();
  docMerge.nodes = { ...docMerge.nodes, review: { ...docMerge.nodes.review, requires_approval: ["merge"] } };
  assert.deepEqual(matchGates(docMerge, { node: "review", touches: [], gatesApproved: [] }), ["merge"]);
  // without requires_approval, touches do not trigger merge
  assert.deepEqual(mk("review", ["anything"]), []);

  // requires_approval ids are pending
  const docReq = loadExample();
  docReq.nodes = { ...docReq.nodes, review: { ...docReq.nodes.review, requires_approval: ["db"] } };
  assert.ok(matchGates(docReq, { node: "review", touches: [], gatesApproved: [] }).includes("db"));

  // gatesApproved excludes (step-scoped objects only; legacy strings ignored)
  assert.deepEqual(mk("review", ["db/foo"], [{ gate: "db", step: 1 }]), []);
});

test("matchGates defaults when doc.gates missing", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["migrations/001.sql"] }), ["db"]);
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["src/auth/x"] }), ["auth"]);
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["package-lock.json"] }), ["deps"]);
  assert.deepEqual(matchGates(doc, { node: "a", touches: [".github/workflows/a.yml"] }), ["ci"]);
  const docM = { ...doc, nodes: { a: { skill: "x", requires_approval: ["merge"] } } };
  assert.deepEqual(matchGates(docM, { node: "a", touches: [] }), ["merge"]);
});

// ---------- nextStep ----------

test("nextStep invalid_result no state change except history", () => {
  const doc = loadExample();
  const s = baseState("plan");
  const before = JSON.parse(JSON.stringify(s));
  const { state: ns, decision } = nextStep(s, doc, { atomic_result: 1, node: "plan", outcome: "bogus" });
  assert.equal(decision.kind, "invalid_result");
  assert.equal(decision.retry, true);
  assert.ok(Array.isArray(decision.errors) && decision.errors.length > 0);
  assert.equal(ns.history.length, 1);
  assert.equal(ns.steps, before.steps);
  assert.deepEqual(ns.cursor, before.cursor);
  assert.deepEqual(ns.visits, before.visits);
});

test("nextStep halt when no edge", () => {
  const doc = loadExample();
  const s = baseState("execute");
  const { decision } = nextStep(s, doc, okResult("execute", "blocked"));
  assert.equal(decision.kind, "halt");
  assert.equal(decision.target, "$halt");
  assert.ok(decision.reason.includes("no edge for execute/blocked"));
});

test("nextStep reserved targets $user/$end", () => {
  const doc = loadExample();
  let r = nextStep(baseState("explore"), doc, okResult("explore", "escalate"));
  assert.equal(r.decision.kind, "ask_user");
  assert.equal(r.decision.target, "$user");
  assert.equal(r.state.cursor.status, "waiting_user");

  // $end now requires the always:true merge gate: first a gate pause ...
  r = nextStep(baseState("memory"), doc, okResult("memory", "pass"));
  assert.equal(r.decision.kind, "gate");
  assert.ok(r.decision.gates.includes("merge"), JSON.stringify(r.decision));
  assert.equal(r.decision.target, "$end");
  // ... then approve and reach $end.
  const approved = approveGate(r.state, "merge");
  const r2 = nextStep(approved, doc, okResult("memory", "pass"));
  assert.equal(r2.decision.kind, "end");
  assert.equal(r2.decision.target, "$end");
});

test("nextStep execute loop limit 3 escalates on 4th", () => {
  const doc = loadExample();
  const s = baseState("review", { visits: { review: 1, execute: 1 }, loops: { execute: 3 }, history: [] });
  const { decision } = nextStep(s, doc, okResult("review", "fail", { next: "execute" }));
  assert.equal(decision.kind, "escalate");
  assert.equal(decision.target, "$user");
});

test("nextStep spec limit 2 escalates", () => {
  const doc = loadExample();
  const s = baseState("spec", { visits: { spec: 1 }, loops: { spec: 2 }, history: [] });
  const { decision } = nextStep(s, doc, okResult("spec", "fail", { next: "spec", reason: "r" }));
  assert.equal(decision.kind, "escalate");
});

test("nextStep max_steps 30", () => {
  const doc = loadExample();
  const s = baseState("execute", { steps: 30, visits: { execute: 1 }, loops: {}, history: [] });
  const { decision } = nextStep(s, doc, okResult("execute", "pass"));
  assert.equal(decision.kind, "escalate");
  assert.ok(decision.reason.includes("max steps"));
});

test("nextStep repeat-reason guard 3x", () => {
  const doc = loadExample();
  const hist = [
    { step: 1, node: "plan", outcome: "pass", reason: "same", next: "plan-review", accepted: true, overridden: false },
    { step: 2, node: "plan", outcome: "pass", reason: "same", next: "plan-review", accepted: true, overridden: false },
  ];
  const s = baseState("plan", { history: hist, visits: { plan: 1 }, steps: 2 });
  const { decision } = nextStep(s, doc, okResult("plan", "pass", { reason: "same", next: "plan-review" }));
  assert.equal(decision.kind, "escalate");
  assert.ok(decision.reason.includes("repeat"));
});

test("nextStep gate then approveGate proceeds", () => {
  const doc = loadExample();
  doc.nodes = { ...doc.nodes, review: { ...doc.nodes.review, requires_approval: ["merge"] } };
  const s = baseState("execute");
  const r1 = nextStep(s, doc, okResult("execute", "pass"));
  assert.equal(r1.decision.kind, "gate");
  assert.deepEqual(r1.decision.gates, ["merge"]);
  assert.equal(r1.decision.target, "review");
  assert.equal(r1.state.cursor.status, "waiting_gate");
  assert.equal(r1.state.cursor.node, "execute");

  const approved = approveGate(r1.state, "merge");
  const hasMerge = approved.gatesApproved.some((e) =>
    typeof e === "string" ? e === "merge" : e?.gate === "merge",
  );
  assert.ok(hasMerge, JSON.stringify(approved.gatesApproved));
  assert.equal(approved.cursor.status, "running");
  const r2 = nextStep(approved, doc, okResult("execute", "pass"));
  assert.equal(r2.decision.kind, "move");
  assert.equal(r2.decision.target, "review");
});

test("nextStep immutability with deepFreeze", () => {
  const doc = loadExample();
  const s = deepFreeze(baseState("execute"));
  const snap = JSON.stringify(s);
  const { state: ns } = nextStep(s, doc, okResult("execute", "pass"));
  assert.equal(JSON.stringify(s), snap);
  assert.notEqual(ns, s);
});

// ---------- property test ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- focused regression tests for .review5.md fixes ----------

test("gate: always:true (merge) applies on edge to $end via current node requires_approval", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x", requires_approval: ["merge"] } },
    edges: [{ from: "a", to: "$end", on: "pass" }],
  };
  const s = baseState("a");
  const r1 = nextStep(s, doc, okResult("a", "pass"));
  assert.equal(r1.decision.kind, "gate");
  assert.ok(r1.decision.gates.includes("merge"), JSON.stringify(r1.decision));
  assert.equal(r1.decision.target, "$end");
  // gate pause must not commit history
  assert.equal(r1.state.history.length, 0);
  assert.equal(r1.state.cursor.status, "waiting_gate");
  const approved = approveGate(r1.state, "merge");
  const r2 = nextStep(approved, doc, okResult("a", "pass"));
  assert.equal(r2.decision.kind, "end");
  assert.equal(r2.decision.target, "$end");
});

test("gate: current node requires_approval applies when target is reserved ($end)", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x", requires_approval: ["db"] } },
    edges: [{ from: "a", to: "$end", on: "pass" }],
  };
  // requires_approval fires even with empty touches
  const r1 = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: [] }));
  assert.equal(r1.decision.kind, "gate");
  assert.ok(r1.decision.gates.includes("db"));
  assert.equal(r1.decision.target, "$end");

  // touch-based gates also fire on edges to $end
  const doc2 = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" } },
    edges: [{ from: "a", to: "$end", on: "pass" }],
  };
  const r2 = nextStep(baseState("a"), doc2, okResult("a", "pass", { touches: ["migrations/001.sql"] }));
  assert.equal(r2.decision.kind, "gate");
  assert.ok(r2.decision.gates.includes("db"));
  assert.equal(r2.decision.target, "$end");
});

test("gate pause does not pollute loops/history; committed once on move", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: {
      a: { skill: "x" },
      b: { skill: "x", requires_approval: ["merge"] },
    },
    edges: [{ from: "a", to: "b", on: "pass" }],
  };
  const s = baseState("a", { visits: { a: 1, b: 1 }, loops: {}, history: [] });
  const r1 = nextStep(s, doc, okResult("a", "pass"));
  assert.equal(r1.decision.kind, "gate");
  assert.deepEqual(r1.state.loops, {});
  assert.deepEqual(r1.state.visits, { a: 1, b: 1 });
  assert.equal(r1.state.history.length, 0);
  assert.equal(r1.state.cursor.node, "a");

  const approved = approveGate(r1.state, "merge");
  const r2 = nextStep(approved, doc, okResult("a", "pass"));
  assert.equal(r2.decision.kind, "move");
  assert.equal(r2.decision.target, "b");
  // exactly one loop increment + one history entry for the single transition
  assert.deepEqual(r2.state.loops, { b: 1 });
  assert.equal(r2.state.history.length, 1);
});

test("limits.max_loops overrides max_visits for that node (realistic walk)", () => {
  const doc = {
    version: 2, defaults: {}, limits: { max_loops: { a: 3 } }, gates: {}, entry: {},
    nodes: { a: { skill: "x" } },
    edges: [{ from: "a", to: "a", on: "pass" }],
  };
  let state = baseState("a", { visits: { a: 1 }, loops: {}, history: [], steps: 0 });
  // 3 loops must all succeed (visits 1 -> 4); old max_visits=3 code escalated on the 3rd
  for (let i = 0; i < 3; i++) {
    const { state: ns, decision } = nextStep(state, doc, okResult("a", "pass", { reason: `iter-${i}`, touches: [] }));
    assert.equal(decision.kind, "move", `loop ${i + 1}: ${JSON.stringify(decision)}`);
    state = ns;
  }
  assert.deepEqual(state.loops, { a: 3 });
  assert.deepEqual(state.visits, { a: 4 });
  // 4th loop exceeds max_loops
  const { decision: d4 } = nextStep(state, doc, okResult("a", "pass", { reason: "iter-3", touches: [] }));
  assert.equal(d4.kind, "escalate");
  assert.equal(d4.target, "$user");
  assert.ok(d4.reason.includes('loop limit exceeded for "a"'));
});

test("doc.gates merged over defaults (custom does not wipe defaults)", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, entry: {},
    gates: { deploy: { match: ["deploy/**"] } },
    nodes: { a: { skill: "x" } }, edges: [],
  };
  // default gate still fires
  assert.ok(matchGates(doc, { node: "a", touches: ["migrations/001.sql"] }).includes("db"));
  // custom gate fires
  assert.ok(matchGates(doc, { node: "a", touches: ["deploy/foo"] }).includes("deploy"));
  // both together
  const both = matchGates(doc, { node: "a", touches: ["migrations/001.sql", "deploy/foo"] });
  assert.ok(both.includes("db") && both.includes("deploy"), JSON.stringify(both));
  // empty gates object keeps defaults (does not disable them)
  const docEmpty = {
    version: 2, defaults: {}, limits: {}, entry: {},
    gates: {}, nodes: { a: { skill: "x" } }, edges: [],
  };
  assert.ok(matchGates(docEmpty, { node: "a", touches: ["migrations/001.sql"] }).includes("db"));
});

test("2 consecutive invalid_result for same node escalate to $user", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { plan: { skill: "x" }, other: { skill: "x" } },
    edges: [{ from: "plan", to: "other", on: "pass" }],
  };
  const s0 = baseState("plan");
  const r1 = nextStep(s0, doc, { atomic_result: 1, node: "plan", outcome: "bogus" });
  assert.equal(r1.decision.kind, "invalid_result");
  assert.equal(r1.decision.retry, true);
  assert.equal(r1.state.history.length, 1);
  assert.equal(r1.state.history[0].next, null);

  const r2 = nextStep(r1.state, doc, { atomic_result: 1, node: "plan", outcome: "bogus" });
  assert.equal(r2.decision.kind, "escalate");
  assert.equal(r2.decision.target, "$user");
  assert.ok(r2.decision.reason.includes('invalid result repeated 2 times for "plan"'), r2.decision.reason);
  assert.equal(r2.state.cursor.status, "waiting_user");
});

test("transition to $end allowed at steps == max_steps", () => {
  const doc = {
    version: 2, defaults: {}, limits: { max_steps: 30 }, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" } },
    edges: [
      { from: "a", to: "$end", on: "pass" },
      { from: "a", to: "b", on: "fail" },
    ],
  };
  // $end is exempt from max_steps but still needs the merge gate: approve first.
  const preApproved = baseState("a", { steps: 30, gatesApproved: [{ gate: "merge", step: 31 }] });
  const rEnd = nextStep(preApproved, doc, okResult("a", "pass", { touches: [] }));
  assert.equal(rEnd.decision.kind, "end");
  assert.equal(rEnd.decision.target, "$end");

  const rBlocked = nextStep(baseState("a", { steps: 30 }), doc, okResult("a", "fail", { touches: [] }));
  assert.equal(rBlocked.decision.kind, "escalate");
  assert.ok(rBlocked.decision.reason.includes("max steps"), rBlocked.decision.reason);
});

test("evalWhen strict equality (no type coercion)", () => {
  // old loose == made these true; strict === keeps them false
  assert.equal(evalWhen("n == false", { n: 0 }), false);
  assert.equal(evalWhen("s == 0", { s: "" }), false);
  assert.equal(evalWhen("flag == 1", { flag: true }), false);
  assert.equal(evalWhen("a != false", { a: 0 }), true);
  // sanity: same-type equality still works
  assert.equal(evalWhen("n == 1", { n: 1 }), true);
  assert.equal(evalWhen("n == 0", { n: 0 }), true);
  // nullish exception preserved
  assert.equal(evalWhen("x == null", {}), true);
  assert.equal(evalWhen("x == null", { x: null }), true);
  assert.equal(evalWhen("x == null", { x: 1 }), false);
  assert.equal(evalWhen("x != null", { x: 0 }), true);
});

test("applyFacts treats acStatus fail like failing tests", () => {
  const out = applyFacts(okResult("execute", "pass", { reason: "r" }), { acStatus: { "AC-1": "fail" } });
  assert.equal(out.outcome, "fail");
  assert.equal(out.overridden, true);
  assert.equal(out.originalOutcome, "pass");
  assert.ok(out.reason.startsWith("fact: ac failed; "), out.reason);

  // fail takes precedence over uncovered
  const out2 = applyFacts(okResult("execute", "pass", { reason: "r" }), {
    acStatus: { "AC-1": "uncovered", "AC-2": "fail" },
  });
  assert.equal(out2.outcome, "fail");
  assert.ok(out2.reason.startsWith("fact: ac failed; "));

  // uncovered alone still maps to spec_mismatch
  const out3 = applyFacts(okResult("execute", "pass", { reason: "r" }), {
    acStatus: { "AC-1": "uncovered" },
  });
  assert.equal(out3.outcome, "spec_mismatch");

  // no override when outcome is not pass
  const out4 = applyFacts(okResult("execute", "fail", { reason: "r" }), {
    acStatus: { "AC-1": "fail" },
  });
  assert.equal(out4.outcome, "fail");
  assert.equal(out4.overridden, false);
});

test("no spurious proposal_rejected without a proposal", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" } },
    edges: [{ from: "a", to: "b", on: "pass" }],
  };
  const { decision } = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: [] }));
  assert.equal(decision.kind, "move");
  assert.equal(decision.target, "b");
  assert.equal(decision.proposalAccepted, false);
  assert.ok(!("reason" in decision) || decision.reason === undefined, JSON.stringify(decision));
});

test("property: 200 random results stay in allowed ∪ reserved and terminate", () => {
  const doc = { ...loadExample(), gates: {} };
  // strip requires_approval so gates never block property walk
  const cleanNodes = {};
  for (const [k, v] of Object.entries(doc.nodes)) {
    const { requires_approval, ...rest } = v ?? {};
    cleanNodes[k] = rest;
  }
  doc.nodes = cleanNodes;
  const nodeIds = Object.keys(doc.nodes);
  const outcomes = [...KNOWN_OUTCOMES];
  const touchPool = ["a.ts", "db/x", "package.json", "x/y"];
  const rand = mulberry32(1337);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const maxSteps = doc.limits?.max_steps ?? 30;
  for (let iter = 0; iter < 200; iter++) {
    let state = {
      steps: 0,
      visits: { [pick(nodeIds)]: 1 },
      loops: {},
      history: [],
      cursor: { node: pick(nodeIds), status: "running" },
      gatesApproved: [],
      ctx: { class: pick(["bug", "feature", "docs"]), n: Math.floor(rand() * 3) },
    };
    // ensure cursor matches visits key sometimes
    state.cursor.node = pick(nodeIds);
    if (!state.visits[state.cursor.node]) state.visits[state.cursor.node] = 1;
    let terminated = null;
    for (let call = 0; call < maxSteps + 1; call++) {
      const cur = state.cursor.node;
      const outcome = pick(outcomes);
      const rNext = rand();
      let nxt;
      if (rNext < 0.4) {
        const c = allowedTransitions(doc, cur, outcome, state.ctx);
        nxt = c.length > 0 ? pick(c).target : pick([...nodeIds, "$end", "$halt"]);
      } else if (rNext < 0.7) {
        nxt = pick([...nodeIds, "$end", "$halt", "$user"]);
      } else {
        nxt = undefined;
      }
      const raw = {
        atomic_result: 1,
        node: cur,
        outcome,
        ...(nxt !== undefined ? { next: nxt } : {}),
        reason: `r${Math.floor(rand() * 3)}`,
        touches: [],
      };
      const allowed = new Set([
        ...allowedTransitions(doc, cur, outcome, state.ctx).map((x) => x.target),
        ...RESERVED_TARGETS,
      ]);
      const { state: ns, decision } = nextStep(state, doc, raw, {});
      if (decision.target !== undefined) {
        assert.ok(allowed.has(decision.target), `iter ${iter} call ${call}: target ${decision.target} not in allowed for ${cur}/${outcome}`);
      }
      state = ns;
      if (["escalate", "halt", "end"].includes(decision.kind)) {
        terminated = decision.kind;
        break;
      }
      // keep walking on move/gate/ask_user/invalid
      if (decision.kind === "gate") {
        const step = state.steps + 1;
        state = { ...state, gatesApproved: [...state.gatesApproved, ...decision.gates.map((g) => ({ gate: g, step }))] };
      }
      if (decision.kind === "ask_user") break; // user stop counts as termination for walk
    }
    void touchPool;
    assert.ok(terminated !== null || state.cursor.status === "waiting_user", `iter ${iter} did not terminate`);
  }
});

// ---------- review findings: BLOCKER merge on $end ----------

test("BLOCKER: transition to $end without requires_approval still gates merge", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" } },
    edges: [{ from: "a", to: "$end", on: "pass" }],
  };
  const r1 = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: [] }));
  assert.equal(r1.decision.kind, "gate");
  assert.deepEqual(r1.decision.gates, ["merge"]);
  assert.equal(r1.decision.target, "$end");
  const approved = approveGate(r1.state, "merge");
  const r2 = nextStep(approved, doc, okResult("a", "pass", { touches: [] }));
  assert.equal(r2.decision.kind, "end");
});

// ---------- review findings: MAJOR touch normalization ----------

test("MAJOR: touches normalized before glob (./, a/../b, leading /)", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  const mk = (touches) => matchGates(doc, { node: "a", touches });
  // ./ prefix stripped
  assert.deepEqual(mk(["./package.json"]), ["deps"]);
  assert.deepEqual(mk(["./src/auth/x.ts"]), ["auth"]);
  // a/../b collapsed via posix.normalize
  assert.deepEqual(mk(["x/../package.json"]), ["deps"]);
  assert.deepEqual(mk(["sub/../migrations/001.sql"]), ["db"]);
  // absolute paths touch every gate (conservative), not just the matching one
  for (const abs of ["/package.json", "/.github/workflows/ci.yml"]) {
    const got = mk([abs]);
    for (const gid of ["db", "auth", "ci", "deps", "merge"]) {
      assert.ok(got.includes(gid), `${abs} -> ${JSON.stringify(got)} should include ${gid}`);
    }
  }
});

test("MAJOR: escaping touches (../) conservatively touch every gate", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  const got = matchGates(doc, { node: "a", touches: ["../evil.ts"] });
  for (const gid of ["db", "auth", "ci", "deps", "merge"]) {
    assert.ok(got.includes(gid), `expected ${gid} in ${JSON.stringify(got)}`);
  }
  // normalized escaping via a/../../b
  const got2 = matchGates(doc, { node: "a", touches: ["a/../../evil"] });
  assert.ok(got2.includes("db") && got2.includes("deps"), JSON.stringify(got2));
});

test("MAJOR: default deps patterns match at any depth", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  const cases = [
    "package.json",
    "sub/package.json",
    "a/b/package-lock.json",
    "x/pnpm-lock.yaml",
    "x/yarn.lock",
    "requirements.txt",
    "deep/requirements-dev.txt",
    "pyproject.toml",
    "pkg/pyproject.toml",
    "go.mod",
    "sub/go.sum",
    "Cargo.toml",
    "nested/Cargo.lock",
  ];
  for (const p of cases) {
    const got = matchGates(doc, { node: "a", touches: [p] });
    assert.ok(got.includes("deps"), `${p} -> ${JSON.stringify(got)}`);
  }
});

test("MAJOR: default ci patterns match at any depth", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  assert.ok(matchGates(doc, { node: "a", touches: [".github/workflows/ci.yml"] }).includes("ci"));
  assert.ok(matchGates(doc, { node: "a", touches: [".gitlab-ci.yml"] }).includes("ci"));
  assert.ok(matchGates(doc, { node: "a", touches: ["sub/.gitlab-ci.yml"] }).includes("ci"));
  assert.ok(matchGates(doc, { node: "a", touches: ["a/b/.gitlab-ci.yml"] }).includes("ci"));
});

test("MAJOR: auth gate is case-insensitive", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  assert.ok(matchGates(doc, { node: "a", touches: ["src/Auth/Login.ts"] }).includes("auth"));
  assert.ok(matchGates(doc, { node: "a", touches: ["SessionStore.js"] }).includes("auth"));
  assert.ok(matchGates(doc, { node: "a", touches: ["src/TOKEN-cache.ts"] }).includes("auth"));
});

// ---------- review findings: MAJOR scoped approvals ----------

test("MAJOR: approveGate scoped to {gate, step}; later same-gate asks again", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x", requires_approval: ["db"] }, c: { skill: "x", requires_approval: ["db"] } },
    edges: [
      { from: "a", to: "b", on: "pass" },
      { from: "b", to: "c", on: "pass" },
    ],
  };
  // a -> b needs db (touch triggers)
  const s0 = baseState("a");
  const r1 = nextStep(s0, doc, okResult("a", "pass", { touches: ["migrations/001.sql"] }));
  assert.equal(r1.decision.kind, "gate");
  assert.ok(r1.decision.gates.includes("db"));
  const approved = approveGate(r1.state, "db");
  // stored as object {gate, step}
  assert.ok(
    approved.gatesApproved.some((e) => typeof e === "object" && e.gate === "db" && typeof e.step === "number"),
    JSON.stringify(approved.gatesApproved),
  );
  const r2 = nextStep(approved, doc, okResult("a", "pass", { touches: ["migrations/001.sql"] }));
  assert.equal(r2.decision.kind, "move");
  assert.equal(r2.decision.target, "b");
  // b -> c needs db again: old approval (step 1) must NOT satisfy step 2
  const r3 = nextStep(r2.state, doc, okResult("b", "pass", { touches: ["migrations/002.sql"] }));
  assert.equal(r3.decision.kind, "gate");
  assert.ok(r3.decision.gates.includes("db"), JSON.stringify(r3.decision));
});

test("MAJOR: legacy string gatesApproved ignored for step-scoped gates", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  // legacy strings NEVER satisfy: gate stays pending
  assert.ok(matchGates(doc, { node: "a", touches: ["migrations/1.sql"], gatesApproved: ["db"], step: 1 }).includes("db"));
  assert.ok(matchGates(doc, { node: "a", touches: ["migrations/1.sql"], gatesApproved: ["db"] }).includes("db"));
  // only {gate, step} with matching step satisfies
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["migrations/1.sql"], gatesApproved: [{ gate: "db", step: 1 }], step: 1 }), []);
  assert.ok(matchGates(doc, { node: "a", touches: ["migrations/1.sql"], gatesApproved: [{ gate: "db", step: 2 }], step: 1 }).includes("db"));
});

// ---------- review findings: MINOR ----------

test("MINOR: maxVisitsFor uses Math.min when both max_loops and max_visits set + lintLimits warns", () => {
  const doc = {
    version: 2, defaults: {}, limits: { max_loops: { a: 3 } }, gates: {}, entry: {},
    nodes: { a: { skill: "x", max_visits: 2 }, b: { skill: "x" } },
    edges: [
      { from: "a", to: "a", on: "pass" },
      { from: "a", to: "b", on: "fail" },
    ],
  };
  const w = lintLimits(doc);
  assert.ok(typeof w === "string" && w.includes('"a"'), w);
  assert.ok(w.includes("3") && w.includes("2"), w);
  // min(2, 3+1)=2: with visits.a=2 the visits limit (not loop limit) escalates
  const s = baseState("a", { visits: { a: 2 }, loops: {}, history: [], steps: 0 });
  const { decision } = nextStep(s, doc, okResult("a", "pass", { reason: "x", touches: [] }));
  assert.equal(decision.kind, "escalate");
  assert.ok(decision.reason.includes("max visits"), decision.reason);
  // no warning when consistent
  const okDoc = {
    version: 2, defaults: {}, limits: { max_loops: { a: 1 } }, gates: {}, entry: {},
    nodes: { a: { skill: "x", max_visits: 5 } }, edges: [],
  };
  assert.equal(lintLimits(okDoc), null);
});

test("MINOR: evalWhen disallows chained comparison", () => {
  for (const expr of ["a == b == c", "a != b != c", "a == b != c", "x in [1] == true"]) {
    assert.throws(() => evalWhen(expr, { a: 1, b: 1, c: 1, x: 1 }), (e) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, `when: chained comparison not allowed in "${expr}"`);
      return true;
    }, expr);
  }
  // single comparisons still work
  assert.equal(evalWhen("a == b", { a: 1, b: 1 }), true);
  assert.equal(evalWhen("a != b", { a: 1, b: 2 }), true);
});

test("MINOR: step counter uses state.steps only; messages reflect >= vs >", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" } },
    edges: [{ from: "a", to: "b", on: "pass" }],
  };
  // history step numbers derive from state.steps, not history.length
  const s = baseState("a", { steps: 5, history: [{ step: 1, node: "x", outcome: "pass", next: "a", accepted: true, overridden: false }] });
  const { state: ns } = nextStep(s, doc, okResult("a", "pass", { touches: [] }));
  assert.equal(ns.history.length, 2);
  assert.equal(ns.history[1].step, 6);
  assert.equal(ns.steps, 6);
  // visits message uses >= matching the >= check
  const docV = {
    version: 2, defaults: { max_visits: 1 }, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" } },
    edges: [{ from: "a", to: "b", on: "pass" }],
  };
  const sv = baseState("a", { visits: { a: 1, b: 1 }, steps: 0, history: [] });
  const { decision } = nextStep(sv, docV, okResult("a", "pass", { touches: [] }));
  assert.equal(decision.kind, "escalate");
  assert.ok(decision.reason.includes(">="), decision.reason);
  assert.ok(decision.reason.includes("(1 >= 1)"), decision.reason);
});

// ---------- ds5 review findings (one test each) ----------

test("ds5 BLOCKER: nextStep gates on UNION of facts.touches and model touches", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" } },
    edges: [{ from: "a", to: "b", on: "pass" }],
  };
  // authoritative facts.touches alone triggers the gate (model omits files)
  let r = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: [] }), { touches: ["migrations/001.sql"] });
  assert.equal(r.decision.kind, "gate");
  assert.ok(r.decision.gates.includes("db"), JSON.stringify(r.decision));
  // model cannot remove: facts require db even when model reports nothing
  r = nextStep(baseState("a"), doc, okResult("a", "pass"), { touches: ["migrations/001.sql"] });
  assert.equal(r.decision.kind, "gate");
  assert.ok(r.decision.gates.includes("db"));
  // model can only add: facts empty + model touch still gates
  r = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: ["migrations/001.sql"] }), { touches: [] });
  assert.equal(r.decision.kind, "gate");
  assert.ok(r.decision.gates.includes("db"));
  // neither touches -> no gate
  r = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: [] }), { touches: [] });
  assert.equal(r.decision.kind, "move");
});

test("ds5 MAJOR: legacy string gatesApproved never satisfies step-scoped gates", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  assert.ok(matchGates(doc, { node: "a", touches: ["migrations/1.sql"], gatesApproved: ["db", "merge"], step: 1 }).includes("db"));
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["migrations/1.sql"], gatesApproved: [{ gate: "db", step: 1 }], step: 1 }), []);
});

test("ds5 MAJOR: merge.always forced true despite doc.gates overrides", () => {
  const mkDoc = (mergeDef) => ({
    version: 2, defaults: {}, limits: {}, entry: {},
    gates: mergeDef === undefined ? {} : { merge: mergeDef },
    nodes: { a: { skill: "x" } },
    edges: [{ from: "a", to: "$end", on: "pass" }],
  });
  for (const mergeDef of [null, { match: ["only-here/**"] }, { always: false }, { always: false, match: [] }]) {
    const doc = mkDoc(mergeDef);
    const r = nextStep(baseState("a"), doc, okResult("a", "pass", { touches: [] }), { touches: [] });
    assert.equal(r.decision.kind, "gate", JSON.stringify({ mergeDef, decision: r.decision }));
    assert.ok(r.decision.gates.includes("merge"), JSON.stringify({ mergeDef, decision: r.decision }));
  }
  // doc may still add match patterns to merge: they fire on touches too
  const docMatch = mkDoc({ match: ["deploy/**"] });
  assert.ok(matchGates(docMatch, { node: "a", touches: ["deploy/x"] }).includes("merge"));
  assert.ok(matchGates(docMatch, { node: "a", touches: ["deploy/x"], target: "$end" }).includes("merge"));
});

test("ds5 MAJOR: evalWhen error in allowedTransitions skips edge with warnings", () => {
  const doc = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" }, b: { skill: "x" }, c: { skill: "x" } },
    edges: [
      { from: "a", to: "b", on: "pass", when: "(((bad" },
      { from: "a", to: "c", on: "pass" },
    ],
  };
  // direct call: bad edge not taken, good edge taken, no throw
  const warnings = [];
  const got = allowedTransitions(doc, "a", "pass", {}, warnings);
  assert.deepEqual(got.map((x) => x.target), ["c"]);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("when: "), warnings[0]);
  // all edges bad -> no candidates -> halt with warnings, no throw
  const docBad = {
    version: 2, defaults: {}, limits: {}, gates: {}, entry: {},
    nodes: { a: { skill: "x" } },
    edges: [{ from: "a", to: "b", on: "pass", when: "a ==" }],
  };
  const r = nextStep(baseState("a"), docBad, okResult("a", "pass", { touches: [] }), { touches: [] });
  assert.equal(r.decision.kind, "halt");
  assert.ok(Array.isArray(r.decision.warnings) && r.decision.warnings.length === 1, JSON.stringify(r.decision));
  assert.ok(r.decision.warnings[0].startsWith("when: "), JSON.stringify(r.decision));
});

test("ds5 MINOR: '!' binds tighter than ==/in", () => {
  // (!0) == false -> true == false -> false; loose (!(0 == false)) would be true
  assert.equal(evalWhen("!n == false", { n: 0 }), false);
  assert.equal(evalWhen("!flag == 0", { flag: false }), false);
  // (!true) in [true, false] -> true; loose (!(true in [..])) -> false
  assert.equal(evalWhen("!a in [true, false]", { a: true }), true);
  assert.equal(evalWhen("!a in [true, false]", { a: false }), true);
  assert.equal(evalWhen("!a in [true]", { a: true }), false);
  // parens preserve loose grouping explicitly
  assert.equal(evalWhen("!(n == false)", { n: 0 }), true);
});

test("ds5 MINOR: backslash/absolute/escaping touches hit every gate", () => {
  const doc = { version: 2, defaults: {}, limits: {}, gates: {}, entry: {}, nodes: { a: { skill: "x" } }, edges: [] };
  const all = ["db", "auth", "ci", "deps", "merge"];
  const expectAll = (touches) => {
    const got = matchGates(doc, { node: "a", touches });
    for (const gid of all) assert.ok(got.includes(gid), `${JSON.stringify(touches)} -> ${JSON.stringify(got)} missing ${gid}`);
  };
  // backslash normalization still matches the right gate
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["src\\auth\\x.ts"] }), ["auth"]);
  assert.deepEqual(matchGates(doc, { node: "a", touches: ["migrations\\001.sql"] }), ["db"]);
  // backslash escaping variants touch every gate
  expectAll(["..\\migrations\\x.sql"]);
  expectAll(["..\\..\\evil.ts"]);
  // absolute POSIX / Windows paths touch every gate
  expectAll(["/etc/passwd"]);
  expectAll(["C:/migrations/001.sql"]);
  expectAll(["C:\\Windows\\foo.ts"]);
});
