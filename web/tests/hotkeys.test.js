import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeHotkey,
  formatHotkey,
  hotkeyFromKeyboardEvent,
  validateHotkey,
} from "../client/src/lib/hotkeys.js";

test("canonicalizes aliases, whitespace, and modifier order", () => {
  assert.equal(canonicalizeHotkey(" Shift + Control + Alt + 1 "), "ctrl+alt+shift+1");
  assert.equal(canonicalizeHotkey("Command + F6"), "meta+f6");
  assert.equal(formatHotkey("ctrl+alt+shift+1"), "Ctrl + Alt + Shift + 1");
});

test("records a shortcut from a KeyboardEvent-like object", () => {
  const event = { code: "Digit1", key: "!", ctrlKey: true, altKey: true, shiftKey: false };
  assert.equal(hotkeyFromKeyboardEvent(event), "ctrl+alt+1");
  assert.equal(canonicalizeHotkey(event), "ctrl+alt+1");
  assert.equal(hotkeyFromKeyboardEvent({ code: "ControlLeft", ctrlKey: true }), "");
});

test("rejects malformed, unsafe, and low-signal shortcuts", () => {
  assert.equal(validateHotkey("ctrl++a").valid, false);
  assert.match(validateHotkey("ctrl+r").error, /reload/i);
  assert.match(validateHotkey("a").error, /Use Ctrl, Alt, or Meta/i);
  assert.equal(validateHotkey("F6").valid, true);
});

test("detects library-wide conflicts while allowing the script being edited", () => {
  const scripts = [
    { id: "one", name: "Signature", hotkey: "Ctrl + Alt + 1" },
    { id: "two", name: "Greeting", hotkey: "ctrl+alt+2" },
  ];

  const conflict = validateHotkey("ctrl + alt + 1", {
    existingHotkeys: scripts,
  });
  assert.equal(conflict.valid, false);
  assert.equal(conflict.conflict.id, "one");
  assert.match(conflict.error, /Signature/);

  const self = validateHotkey("ctrl+alt+1", {
    existingHotkeys: scripts,
    excludeId: "one",
  });
  assert.equal(self.valid, true);
});
