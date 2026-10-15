import test from "node:test";
import assert from "node:assert/strict";
import { parseYamlLite } from "../scripts/lib/yaml-lite.mjs";

test("block mappings with consistent indentation", () => {
  const { value, errors } = parseYamlLite("a:\n    b: 1\n    c: 2\n");
  assert.equal(errors.length, 0);
  assert.deepEqual(value, { a: { b: 1, c: 2 } });
});

test("block sequences and maps inside lists", () => {
  const { value, errors } = parseYamlLite("list:\n  - a\n  - b\n");
  assert.equal(errors.length, 0);
  assert.deepEqual(value, { list: ["a", "b"] });

  const y2 = "edges:\n  - from: a\n    to: b\n  - from: b\n    to: c\n";
  const r2 = parseYamlLite(y2);
  assert.equal(r2.errors.length, 0);
  assert.deepEqual(r2.value, { edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] });
});

test("flow sequences and nested flow mappings", () => {
  const { value, errors } = parseYamlLite("k: [a, b]\n");
  assert.equal(errors.length, 0);
  assert.deepEqual(value, { k: ["a", "b"] });

  const r2 = parseYamlLite("k: { a: 1, b: [x, y] }\n");
  assert.equal(r2.errors.length, 0);
  assert.deepEqual(r2.value, { k: { a: 1, b: ["x", "y"] } });
});

test("scalars: quoted, ints, floats, bools, null", () => {
  const { value, errors } = parseYamlLite(
    "a: 'hi'\nb: \"yo\"\nc: 42\nd: 3.5\ne: true\nf: false\ng: null\nh: ~\ni: plain\n",
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(value, {
    a: "hi",
    b: "yo",
    c: 42,
    d: 3.5,
    e: true,
    f: false,
    g: null,
    h: null,
    i: "plain",
  });
});

test("comments outside quotes are stripped", () => {
  const { value, errors } = parseYamlLite('a: 1 # comment\nb: "x # y"\n# full line\nc: 2\n');
  assert.equal(errors.length, 0);
  assert.deepEqual(value, { a: 1, b: "x # y", c: 2 });
});

test("tabs report line numbers", () => {
  const { errors } = parseYamlLite("a:\n\tb: 1\n");
  assert.ok(errors.length >= 1);
  assert.equal(errors[0].line, 2);
});

test("bad indentation reports line numbers", () => {
  const { errors } = parseYamlLite("a:\n  b: 1\n     c: 2\n");
  const bad = errors.find((e) => e.message.includes("indentation"));
  assert.ok(bad);
  assert.equal(bad.line, 3);
});

test("unterminated quote reports line", () => {
  const { errors } = parseYamlLite('a: "oops\n');
  const u = errors.find((e) => e.message.includes("quote"));
  assert.ok(u);
  assert.equal(u.line, 1);
});

test("unterminated bracket reports line", () => {
  const { errors } = parseYamlLite("a: [1, 2\n");
  const u = errors.find((e) => e.message.includes("bracket"));
  assert.ok(u);
  assert.equal(u.line, 1);
});

test("duplicate keys report line", () => {
  const { errors } = parseYamlLite("a: 1\na: 2\n");
  const d = errors.find((e) => e.message.includes("duplicate"));
  assert.ok(d);
  assert.equal(d.line, 2);
});

test("multiline markers and anchors error", () => {
  const r1 = parseYamlLite("a: | \n");
  assert.ok(r1.errors.some((e) => e.message.includes("|")));
  const r2 = parseYamlLite("a: > \n");
  assert.ok(r2.errors.length >= 1);
  const r3 = parseYamlLite("a: &x\n");
  assert.ok(r3.errors.some((e) => e.message.includes("&") || e.message.includes("anchor")));
  const r4 = parseYamlLite("a: *x\n");
  assert.ok(r4.errors.length >= 1);
});

test("prototype keys do not collide or pollute", () => {
  const { value, errors } = parseYamlLite("toString: 1\nvalueOf: 2\nconstructor: 3\n");
  assert.equal(errors.length, 0);
  assert.equal(value.toString, 1);
  assert.equal(value.valueOf, 2);
  assert.equal(value.constructor, 3);
  assert.ok(Object.hasOwn(value, "toString"));
  const dup = parseYamlLite("a: 1\na: 2\n");
  assert.ok(dup.errors.some((e) => e.message.includes("duplicate")));
  const proto = parseYamlLite("__proto__: x\n");
  assert.ok(Object.hasOwn(proto.value, "__proto__"));
  assert.equal(Object.getPrototypeOf(proto.value), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("escaped backslash before quote does not break termination", () => {
  const { value, errors } = parseYamlLite('a: "foo\\\\" # comment\n');
  assert.equal(errors.length, 0);
  assert.equal(value.a, "foo\\");
  const r2 = parseYamlLite('"foo\\\\": bar\n');
  assert.equal(r2.errors.length, 0);
  assert.equal(r2.value["foo\\"], "bar");
});

test("unterminated single quote ending with '' is an error", () => {
  const { errors } = parseYamlLite("a: 'foo''\n");
  assert.ok(errors.some((e) => e.message.includes("quote")));
  const ok = parseYamlLite("a: 'foo''bar'\n");
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.value.a, "foo'bar");
});

test("flow mapping prototype keys do not collide", () => {
  const { value, errors } = parseYamlLite('k: { toString: 1, valueOf: 2 }\n');
  assert.equal(errors.length, 0);
  assert.equal(value.k.toString, 1);
  assert.equal(value.k.valueOf, 2);
});

test("double-quoted scalar with internal unescaped quotes is an error", () => {
  const r = parseYamlLite('a: "hello" "world"\n');
  assert.ok(r.errors.some((e) => e.message.includes("quote")), JSON.stringify(r.errors));
  const ok = parseYamlLite('a: "hello \\"world\\""\n');
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.value.a, 'hello "world"');
});
