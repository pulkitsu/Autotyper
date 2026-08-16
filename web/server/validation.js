const HOTKEY_MODIFIERS = new Set(["ctrl", "alt", "shift", "meta"]);

const MODIFIER_ALIASES = new Map([
  ["control", "ctrl"],
  ["ctl", "ctrl"],
  ["option", "alt"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["win", "meta"],
  ["windows", "meta"],
]);

const KEY_ALIASES = new Map([
  ["esc", "escape"],
  ["return", "enter"],
  ["spacebar", "space"],
  ["del", "delete"],
  ["left", "arrowleft"],
  ["right", "arrowright"],
  ["up", "arrowup"],
  ["down", "arrowdown"],
  ["pgup", "pageup"],
  ["pgdn", "pagedown"],
]);

const NAMED_HOTKEY_KEYS = new Set([
  "backspace",
  "delete",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "end",
  "enter",
  "escape",
  "home",
  "pagedown",
  "pageup",
  "space",
  "tab",
]);

const RESERVED_HOTKEYS = new Set([
  "f1",
  "f5",
  "f11",
  "f12",
  "alt+f4",
  "ctrl+alt+delete",
  "ctrl+l",
  "ctrl+n",
  "ctrl+o",
  "ctrl+p",
  "ctrl+r",
  "ctrl+t",
  "ctrl+w",
  "ctrl+shift+c",
  "ctrl+shift+i",
  "ctrl+shift+j",
  "meta+q",
  "meta+w",
  "meta+r",
  "meta+t",
  "meta+l",
]);

export class ApiError extends Error {
  constructor(status, message, fields = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

export function normalizeHotkey(value) {
  if (typeof value !== "string") {
    throw new ApiError(422, "A hotkey is required.", { hotkey: "Enter a keyboard shortcut." });
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) {
    throw new ApiError(422, "A hotkey must contain between 1 and 100 characters.", {
      hotkey: "Enter a shortcut such as Ctrl+Alt+1.",
    });
  }

  const rawParts = trimmed.split("+").map((part) => part.trim());
  if (rawParts.some((part) => !part)) {
    throw new ApiError(422, "A hotkey cannot contain an empty key.", {
      hotkey: "Use a shortcut such as Ctrl+Alt+1.",
    });
  }

  const modifiers = new Set();
  let key = "";
  for (const rawPart of rawParts) {
    const normalized = rawPart.toLowerCase();
    const modifier = MODIFIER_ALIASES.get(normalized) ??
      (HOTKEY_MODIFIERS.has(normalized) ? normalized : "");
    if (modifier) {
      if (modifiers.has(modifier)) {
        throw new ApiError(422, "A modifier can be used only once in a hotkey.", {
          hotkey: "Remove duplicate modifier keys.",
        });
      }
      modifiers.add(modifier);
      continue;
    }

    const compact = normalized.replace(/[\s_-]+/g, "");
    const alias = KEY_ALIASES.get(compact);
    const functionMatch = /^f0?([1-9]|1[0-2])$/.exec(compact);
    const candidate = alias ?? (functionMatch ? `f${Number(functionMatch[1])}` : compact);
    const validKey =
      /^[a-z0-9]$/.test(candidate) || Boolean(functionMatch) || NAMED_HOTKEY_KEYS.has(candidate);
    if (!validKey) {
      throw new ApiError(422, "The hotkey contains an unsupported key.", {
        hotkey: "Use Ctrl, Alt, Shift, Meta, a letter, number, F-key, or named key.",
      });
    }
    if (key) {
      throw new ApiError(422, "A hotkey can contain only one non-modifier key.", {
        hotkey: "Remove the extra key from this shortcut.",
      });
    }
    key = candidate;
  }

  if (!key) {
    throw new ApiError(422, "A hotkey needs a non-modifier key.", {
      hotkey: "Add a letter, number, F-key, or named key.",
    });
  }

  const orderedModifiers = ["ctrl", "alt", "shift", "meta"].filter((modifier) =>
    modifiers.has(modifier),
  );
  const canonical = [...orderedModifiers, key].join("+");
  const hasStrongModifier = orderedModifiers.some((modifier) =>
    ["ctrl", "alt", "meta"].includes(modifier),
  );
  const isFunctionKey = /^f(?:[1-9]|1[0-2])$/.test(key);
  if (!hasStrongModifier && !isFunctionKey) {
    throw new ApiError(422, "This hotkey is too easy to trigger accidentally.", {
      hotkey: "Use Ctrl, Alt, or Meta with a regular key, or choose F1–F12.",
    });
  }
  if (RESERVED_HOTKEYS.has(canonical)) {
    throw new ApiError(422, "This hotkey is reserved by the browser or operating system.", {
      hotkey: "Choose a different shortcut.",
    });
  }
  return canonical;
}

function integerInRange(value, field, { minimum, maximum, fallback }) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(422, `Invalid ${field}.`, {
      [field]: `Enter a whole number between ${minimum} and ${maximum}.`,
    });
  }
  return parsed;
}

export function validateScriptInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "A script object is required.");
  }

  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new ApiError(422, "A script name is required.", {
      name: "Enter a name for this script.",
    });
  }
  const name = value.name.trim();
  if (name.length > 120) {
    throw new ApiError(422, "Script names can be at most 120 characters.", {
      name: "Use 120 characters or fewer.",
    });
  }

  if (typeof value.body !== "string") {
    throw new ApiError(422, "Script body must be text.", {
      body: "Enter the text or special-key tokens to type.",
    });
  }
  if (value.body.length > 50_000) {
    throw new ApiError(422, "Script bodies can be at most 50,000 characters.", {
      body: "Shorten this script before saving it.",
    });
  }

  return {
    name,
    body: value.body,
    hotkey: normalizeHotkey(value.hotkey),
    charactersPerSecond: integerInRange(value.charactersPerSecond, "charactersPerSecond", {
      minimum: 1,
      maximum: 500,
      fallback: 15,
    }),
    startDelayMs: integerInRange(value.startDelayMs, "startDelayMs", {
      minimum: 0,
      maximum: 60_000,
      fallback: 1_000,
    }),
  };
}

export function validateUuid(value, field = "id") {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ApiError(400, `Invalid ${field}.`);
  }
  return value;
}

export function validateHistoryInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "An execution record is required.");
  }
  const scriptId = validateUuid(value.scriptId, "scriptId");
  if (value.durationMs === undefined || value.durationMs === null || value.durationMs === "") {
    throw new ApiError(422, "A duration is required.", {
      durationMs: "Enter the execution duration in milliseconds.",
    });
  }
  const durationMs = integerInRange(value.durationMs, "durationMs", {
    minimum: 0,
    maximum: 86_400_000,
    fallback: undefined,
  });
  const status = value.status === undefined ? "completed" : String(value.status).toLowerCase();
  if (!["completed", "stopped", "error"].includes(status)) {
    throw new ApiError(422, "Invalid execution status.", {
      status: "Use completed, stopped, or error.",
    });
  }
  let startedAt = new Date();
  if (value.startedAt !== undefined && value.startedAt !== null && value.startedAt !== "") {
    startedAt = new Date(value.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      throw new ApiError(422, "Invalid execution start time.", {
        startedAt: "Use an ISO 8601 timestamp.",
      });
    }
  }
  return { scriptId, durationMs, status, startedAt: startedAt.toISOString() };
}

export function validateLimit(value) {
  if (value === undefined) {
    return 100;
  }
  return integerInRange(value, "limit", { minimum: 1, maximum: 1_000, fallback: 100 });
}
