import assert from "node:assert/strict";
import test from "node:test";

import { applyTargetUnit, applyTargetUnits } from "../client/src/lib/targetState.js";

test("inserts text and required special keys at the selection", () => {
  let state = { text: "ac", selectionStart: 1, selectionEnd: 1 };
  state = applyTargetUnit(state, { kind: "text", value: "b" });
  state = applyTargetUnit(state, { kind: "key", value: "tab" });
  state = applyTargetUnit(state, { kind: "key", value: "enter" });
  state = applyTargetUnit(state, { kind: "key", value: "space" });

  assert.deepEqual(state, {
    text: "ab\t\n c",
    selectionStart: 5,
    selectionEnd: 5,
  });
});

test("replaces a selected range rather than appending", () => {
  const result = applyTargetUnit(
    { text: "Hello world", selectionStart: 6, selectionEnd: 11 },
    { kind: "text", value: "AutoTyper" },
  );
  assert.deepEqual(result, {
    text: "Hello AutoTyper",
    selectionStart: 15,
    selectionEnd: 15,
  });
});

test("backspace and delete operate on whole Unicode graphemes", () => {
  const emoji = "👩🏽‍💻";
  const cursorAfterEmoji = (`A${emoji}`).length;
  const afterBackspace = applyTargetUnit(
    { text: `A${emoji}B`, selectionStart: cursorAfterEmoji, selectionEnd: cursorAfterEmoji },
    { kind: "key", value: "backspace" },
  );
  assert.deepEqual(afterBackspace, {
    text: "AB",
    selectionStart: 1,
    selectionEnd: 1,
  });

  const afterDelete = applyTargetUnit(
    { text: `A${emoji}B`, selectionStart: 1, selectionEnd: 1 },
    { kind: "key", value: "delete" },
  );
  assert.deepEqual(afterDelete, {
    text: "AB",
    selectionStart: 1,
    selectionEnd: 1,
  });
});

test("navigation keys move the caret without mutating text", () => {
  let state = { text: "one\ntwo\nthree", selectionStart: 6, selectionEnd: 6 };
  state = applyTargetUnit(state, { kind: "key", value: "home" });
  assert.equal(state.selectionStart, 4);
  state = applyTargetUnit(state, { kind: "key", value: "down" });
  assert.equal(state.selectionStart, 8);
  state = applyTargetUnit(state, { kind: "key", value: "end" });
  assert.equal(state.selectionStart, 13);
  assert.equal(state.text, "one\ntwo\nthree");
});

test("wait units are no-ops and unit batches are deterministic", () => {
  const result = applyTargetUnits(
    { text: "", selectionStart: 0, selectionEnd: 0 },
    [
      { kind: "text", value: "A" },
      { kind: "wait", durationMs: 30 },
      { kind: "key", value: "space" },
      { kind: "text", value: "B" },
    ],
  );
  assert.deepEqual(result, { text: "A B", selectionStart: 3, selectionEnd: 3 });
});
