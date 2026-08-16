/**
 * Hotkeys are stored in a canonical, locale-independent form such as
 * "ctrl+alt+1".  The app only receives browser-tab key events, so callers
 * should attach their listener to window and explicitly disclose that these
 * shortcuts cannot be global OS shortcuts from a normal web page.
 */

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"];

const MODIFIER_ALIASES = new Map([
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["ctl", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
  ["meta", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["win", "meta"],
  ["windows", "meta"],
]);

const KEY_ALIASES = new Map([
  ["return", "enter"],
  ["enter", "enter"],
  ["tab", "tab"],
  ["space", "space"],
  ["spacebar", "space"],
  ["esc", "escape"],
  ["escape", "escape"],
  ["backspace", "backspace"],
  ["delete", "delete"],
  ["del", "delete"],
  ["left", "arrowleft"],
  ["arrowleft", "arrowleft"],
  ["right", "arrowright"],
  ["arrowright", "arrowright"],
  ["up", "arrowup"],
  ["arrowup", "arrowup"],
  ["down", "arrowdown"],
  ["arrowdown", "arrowdown"],
  ["home", "home"],
  ["end", "end"],
  ["pageup", "pageup"],
  ["pgup", "pageup"],
  ["pagedown", "pagedown"],
  ["pgdn", "pagedown"],
]);

const DISPLAY_KEYS = new Map([
  ["enter", "Enter"],
  ["tab", "Tab"],
  ["space", "Space"],
  ["escape", "Esc"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["arrowleft", "Left"],
  ["arrowright", "Right"],
  ["arrowup", "Up"],
  ["arrowdown", "Down"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "Page Up"],
  ["pagedown", "Page Down"],
]);

// Browser/OS combinations that a page cannot reliably reserve. They are
// rejected before saving instead of promising an unreliable automation key.
const RESERVED_HOTKEYS = new Map([
  ["f1", "F1 is normally reserved by the browser."],
  ["f5", "F5 reloads the page."],
  ["f11", "F11 controls browser fullscreen."],
  ["f12", "F12 opens developer tools in many browsers."],
  ["alt+f4", "Alt + F4 is reserved by the operating system."],
  ["ctrl+alt+delete", "Ctrl + Alt + Delete is reserved by the operating system."],
  ["ctrl+l", "Ctrl + L focuses the browser address bar."],
  ["ctrl+n", "Ctrl + N opens a new browser window."],
  ["ctrl+o", "Ctrl + O opens a browser file dialog."],
  ["ctrl+p", "Ctrl + P opens browser print."],
  ["ctrl+r", "Ctrl + R reloads the page."],
  ["ctrl+t", "Ctrl + T opens a new browser tab."],
  ["ctrl+w", "Ctrl + W closes the browser tab."],
  ["ctrl+shift+c", "Ctrl + Shift + C is commonly a developer-tools shortcut."],
  ["ctrl+shift+i", "Ctrl + Shift + I is commonly a developer-tools shortcut."],
  ["ctrl+shift+j", "Ctrl + Shift + J is commonly a developer-tools shortcut."],
  ["meta+q", "Command + Q is reserved by the operating system."],
  ["meta+w", "Command + W closes the browser tab."],
  ["meta+r", "Command + R reloads the page."],
  ["meta+t", "Command + T opens a new browser tab."],
  ["meta+l", "Command + L focuses the browser address bar."],
]);

function normalizePrimaryKey(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  const compact = raw.replace(/[\s_-]+/g, "");
  const alias = KEY_ALIASES.get(compact);
  if (alias) {
    return alias;
  }

  const functionMatch = /^f0?([1-9]|1[0-2])$/.exec(compact);
  if (functionMatch) {
    return `f${Number(functionMatch[1])}`;
  }

  const codeLetter = /^key([a-z])$/.exec(compact);
  if (codeLetter) {
    return codeLetter[1];
  }

  const codeDigit = /^(?:digit|numpad)([0-9])$/.exec(compact);
  if (codeDigit) {
    return codeDigit[1];
  }

  return /^[a-z0-9]$/.test(compact) ? compact : "";
}

function parseHotkeyString(input) {
  const raw = input == null ? "" : String(input).trim();
  if (!raw) {
    return { valid: false, error: "Choose a shortcut." };
  }

  const parts = raw.split("+");
  if (parts.some((part) => !part.trim())) {
    return { valid: false, error: "Use one key between shortcut separators." };
  }

  const modifiers = new Set();
  let key = "";
  for (const part of parts) {
    const normalized = part.trim().toLowerCase();
    const modifier = MODIFIER_ALIASES.get(normalized);
    if (modifier) {
      if (modifiers.has(modifier)) {
        return { valid: false, error: "A modifier is listed more than once." };
      }
      modifiers.add(modifier);
      continue;
    }

    const primaryKey = normalizePrimaryKey(normalized);
    if (!primaryKey) {
      return { valid: false, error: `Unsupported shortcut key: ${part.trim()}.` };
    }
    if (key) {
      return { valid: false, error: "A shortcut can have only one non-modifier key." };
    }
    key = primaryKey;
  }

  if (!key) {
    return { valid: false, error: "Add a non-modifier key to the shortcut." };
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) =>
    modifiers.has(modifier),
  );
  return {
    valid: true,
    key,
    modifiers: orderedModifiers,
    canonical: [...orderedModifiers, key].join("+"),
  };
}

function keyFromKeyboardEvent(event) {
  const code = String(event?.code ?? "");
  if (code) {
    const codeKey = normalizePrimaryKey(code);
    if (codeKey) {
      return codeKey;
    }
  }

  const key = String(event?.key ?? "").toLowerCase();
  if (["control", "ctrl", "alt", "shift", "meta", "os"].includes(key)) {
    return "";
  }
  return normalizePrimaryKey(key);
}

/**
 * Normalize a typed string or KeyboardEvent-like object. Invalid syntax yields
 * an empty string; policy checks (reserved keys, duplicate bindings) belong to
 * validateHotkey so a recorder can still show the user what they pressed.
 */
export function canonicalizeHotkey(inputOrEvent) {
  if (inputOrEvent && typeof inputOrEvent === "object") {
    return hotkeyFromKeyboardEvent(inputOrEvent);
  }
  const parsed = parseHotkeyString(inputOrEvent);
  return parsed.valid ? parsed.canonical : "";
}

/** Return a canonical shortcut from an event, or "" for modifier-only keys. */
export function hotkeyFromKeyboardEvent(event) {
  const key = keyFromKeyboardEvent(event);
  if (!key) {
    return "";
  }

  const parts = [];
  if (event?.ctrlKey) parts.push("ctrl");
  if (event?.altKey) parts.push("alt");
  if (event?.shiftKey) parts.push("shift");
  if (event?.metaKey) parts.push("meta");
  parts.push(key);
  return canonicalizeHotkey(parts.join("+"));
}

export function formatHotkey(hotkey) {
  const canonical = canonicalizeHotkey(hotkey);
  if (!canonical) {
    return "";
  }

  return canonical
    .split("+")
    .map((part) => {
      if (part === "ctrl") return "Ctrl";
      if (part === "alt") return "Alt";
      if (part === "shift") return "Shift";
      if (part === "meta") return "Meta";
      if (DISPLAY_KEYS.has(part)) return DISPLAY_KEYS.get(part);
      if (/^f\d+$/.test(part)) return part.toUpperCase();
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(" + ");
}

function candidateBindings(options) {
  if (Array.isArray(options)) {
    return options;
  }
  if (!options || typeof options !== "object") {
    return [];
  }
  const candidates =
    options.existingHotkeys ??
    options.bindings ??
    options.hotkeys ??
    options.takenHotkeys ??
    [];
  return Array.isArray(candidates) ? candidates : Array.from(candidates);
}

/**
 * Finds a matching existing binding. Bindings can be strings or script-like
 * objects with id/name/hotkey fields. Passing excludeId lets an edit keep its
 * existing assignment without falsely conflicting with itself.
 */
export function findHotkeyConflict(hotkey, bindings, excludeId) {
  const canonical = canonicalizeHotkey(hotkey);
  if (!canonical) {
    return null;
  }

  for (const binding of candidateBindings(bindings)) {
    const rawHotkey =
      typeof binding === "string"
        ? binding
        : binding?.hotkey ?? binding?.canonical ?? binding?.shortcut;
    const bindingId = typeof binding === "object" ? binding?.id : undefined;
    if (
      excludeId != null &&
      bindingId != null &&
      String(bindingId) === String(excludeId)
    ) {
      continue;
    }
    if (canonicalizeHotkey(rawHotkey) === canonical) {
      return binding;
    }
  }
  return null;
}

/**
 * Validate user-facing hotkey policy and optional whole-library conflicts.
 *
 * Example:
 * validateHotkey(value, { existingHotkeys: scripts, excludeId: script.id })
 */
export function validateHotkey(hotkey, options = {}) {
  const parsed = parseHotkeyString(hotkey);
  if (!parsed.valid) {
    return {
      valid: false,
      canonical: "",
      display: "",
      error: parsed.error,
      conflict: null,
    };
  }

  const hasStrongModifier = parsed.modifiers.some((modifier) =>
    ["ctrl", "alt", "meta"].includes(modifier),
  );
  const isFunctionKey = /^f(?:[1-9]|1[0-2])$/.test(parsed.key);
  if (!hasStrongModifier && !isFunctionKey) {
    return {
      valid: false,
      canonical: parsed.canonical,
      display: formatHotkey(parsed.canonical),
      error: "Use Ctrl, Alt, or Meta with a regular key, or choose F1–F12.",
      conflict: null,
    };
  }

  const reservedError = RESERVED_HOTKEYS.get(parsed.canonical);
  if (reservedError) {
    return {
      valid: false,
      canonical: parsed.canonical,
      display: formatHotkey(parsed.canonical),
      error: reservedError,
      conflict: null,
    };
  }

  const conflict = findHotkeyConflict(
    parsed.canonical,
    options,
    options?.excludeId,
  );
  if (conflict) {
    const name =
      typeof conflict === "object" && conflict?.name
        ? `“${conflict.name}”`
        : "another script";
    return {
      valid: false,
      canonical: parsed.canonical,
      display: formatHotkey(parsed.canonical),
      error: `This shortcut is already assigned to ${name}.`,
      conflict,
    };
  }

  return {
    valid: true,
    canonical: parsed.canonical,
    display: formatHotkey(parsed.canonical),
    error: "",
    conflict: null,
  };
}

export function isSameHotkey(first, second) {
  const firstCanonical = canonicalizeHotkey(first);
  return Boolean(firstCanonical) && firstCanonical === canonicalizeHotkey(second);
}
