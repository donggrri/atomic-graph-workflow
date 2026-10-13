/**
 * Marker block seam — atomic:begin / atomic:end
 */

import test from "node:test";
import assert from "node:assert/strict";

import { upsertBlock, removeBlock, hasBlock } from "../scripts/lib/marker-block.mjs";

const BEGIN = "<!-- atomic:begin -->";
const END = "<!-- atomic:end -->";

/** @param {string} body */
function wrapBlock(body) {
  return `${BEGIN}\n${body}\n${END}`;
}

/** @param {() => void} fn @param {string} text */
function assertInputUnchangedOnThrow(fn, text) {
  const snapshot = text;
  assert.throws(fn);
  assert.equal(snapshot, text);
}

test("upsertBlock on empty text creates block-only file and hasBlock is true", () => {
  const body = "parent session routing";
  const result = upsertBlock("", body);
  assert.equal(result, wrapBlock(body));
  assert.equal(hasBlock(result), true);
});

test("upsertBlock inserts after first blank line preserving outside bytes and CRLF", () => {
  const body = "managed rules";
  const lfInput = "header line\n\nuser-owned tail\n";
  const lfExpected = `header line\n\n${wrapBlock(body)}\n\nuser-owned tail\n`;
  assert.equal(upsertBlock(lfInput, body), lfExpected);
  assert.equal(hasBlock(lfExpected), true);

  const crlfBody = "managed";
  const crlfInput = "head\r\n\r\ntail\r\n";
  const crlfExpected = `head\r\n\r\n${wrapBlock(crlfBody)}\r\n\r\ntail\r\n`;
  assert.equal(upsertBlock(crlfInput, crlfBody), crlfExpected);
});

test("upsertBlock is idempotent when body is unchanged", () => {
  const input = "intro\n\nsection\n";
  const body = "same body";
  const once = upsertBlock(input, body);
  const twice = upsertBlock(once, body);
  assert.equal(twice, once);
});

test("upsertBlock replaces only inner body when body changes", () => {
  const input = "top\n\nbottom\n";
  const withV1 = upsertBlock(input, "version-one");
  const withV2 = upsertBlock(withV1, "version-two");
  const expected = `top\n\n${wrapBlock("version-two")}\n\nbottom\n`;
  assert.equal(withV2, expected);
});

test("removeBlock strips a single block and leaves outside bytes unchanged", () => {
  const input = "keep-start\n\nkeep-end\n";
  const withBlock = upsertBlock(input, "inside");
  assert.equal(removeBlock(withBlock), input);
});

test("removeBlock on text without a block returns text unchanged", () => {
  const plain = "no markers here\n";
  assert.equal(removeBlock(plain), plain);
  assert.equal(hasBlock(plain), false);
});

test("upsertBlock throws on begin-only marker without mutating input", () => {
  const text = "prefix\n<!-- atomic:begin -->\ninner\n";
  assertInputUnchangedOnThrow(() => upsertBlock(text, "new"), text);
});

test("upsertBlock throws on end-only marker without mutating input", () => {
  const text = "inner\n<!-- atomic:end -->\nsuffix\n";
  assertInputUnchangedOnThrow(() => upsertBlock(text, "new"), text);
});

test("upsertBlock throws on two blocks without mutating input", () => {
  const text = `${wrapBlock("first")}\n\n${wrapBlock("second")}\n`;
  assertInputUnchangedOnThrow(() => upsertBlock(text, "new"), text);
});

test("removeBlock throws on mismatched markers without mutating input", () => {
  const beginOnly = "x\n<!-- atomic:begin -->\n";
  assertInputUnchangedOnThrow(() => removeBlock(beginOnly), beginOnly);

  const endOnly = "<!-- atomic:end -->\n";
  assertInputUnchangedOnThrow(() => removeBlock(endOnly), endOnly);

  const two = `${wrapBlock("a")}\n${wrapBlock("b")}\n`;
  assertInputUnchangedOnThrow(() => removeBlock(two), two);
});

test("upsertBlock accepts begin line with extra annotation", () => {
  const annotated = "<!-- atomic:begin (generated) -->\nbody\n<!-- atomic:end -->\n";
  assert.equal(hasBlock(annotated), true);
  const next = upsertBlock(annotated, "new-body");
  assert.match(next, /new-body/);
});
