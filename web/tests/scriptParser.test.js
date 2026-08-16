import assert from "node:assert/strict";
import test from "node:test";

import {
  countTypingUnits,
  parseScript,
  segmentGraphemes,
} from "../client/src/lib/scriptParser.js";

test("parses required special tokens case-insensitively", () => {
  const units = parseScript("Hello{tAb}{ENTER}{ Space }!");

  assert.deepEqual(units, [
    { kind: "text", value: "H" },
    { kind: "text", value: "e" },
    { kind: "text", value: "l" },
    { kind: "text", value: "l" },
    { kind: "text", value: "o" },
    { kind: "key", value: "tab" },
    { kind: "key", value: "enter" },
    { kind: "key", value: "space" },
    { kind: "text", value: "!" },
  ]);
  assert.equal(countTypingUnits(units), 9);
});

test("unknown and unclosed tokens remain literal text", () => {
  const units = parseScript("Hi {customer_name}; {Tab");
  assert.equal(
    units.filter((unit) => unit.kind === "text").map((unit) => unit.value).join(""),
    "Hi {customer_name}; {Tab",
  );
  assert.equal(units.some((unit) => unit.kind === "key"), false);
});

test("double braces escape literal braces", () => {
  const units = parseScript('JSON: {{"tab": "{{Tab}}"}}');
  assert.equal(
    units.map((unit) => unit.value ?? "").join(""),
    'JSON: {"tab": "{Tab}"}',
  );
  assert.equal(units.some((unit) => unit.kind === "key"), false);
});

test("parses optional editing keys and waits without counting waits as output", () => {
  const units = parseScript("A{Backspace}{WAIT 25}{Delete}{Left}");
  assert.deepEqual(units, [
    { kind: "text", value: "A" },
    { kind: "key", value: "backspace" },
    { kind: "wait", durationMs: 25 },
    { kind: "key", value: "delete" },
    { kind: "key", value: "arrowleft" },
  ]);
  assert.equal(countTypingUnits(units), 4);
});

test("keeps emoji and combining sequences as one typing unit", () => {
  const text = "👩🏽‍💻e\u0301";
  assert.deepEqual(segmentGraphemes(text), ["👩🏽‍💻", "e\u0301"]);
  assert.equal(countTypingUnits(parseScript(text)), 2);
});
