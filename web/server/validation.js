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

const MACRO_STEP_TYPES = new Set(["typeText", "click", "move", "wait", "loop"]);
const CLICK_BUTTONS = new Set(["left", "right", "middle"]);
const CLICK_TYPES = new Set(["single", "double"]);
const MACRO_STATUSES = new Set(["completed", "stopped", "error", "rate_limited"]);

function optionalText(value, field, maximum, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new ApiError(422, `Invalid ${field}.`, { [field]: "Enter text." });
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new ApiError(422, `Invalid ${field}.`, {
      [field]: `Use ${maximum} characters or fewer.`,
    });
  }
  return normalized || fallback;
}

function coordinate(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
    throw new ApiError(422, `Invalid ${field}.`, {
      [field]: "Use a coordinate between 0 and 100,000.",
    });
  }
  return parsed;
}

function optionalUuidLike(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 100) {
    throw new ApiError(422, `Invalid ${field}.`, { [field]: "Use a short step identifier." });
  }
  return value;
}

function validateMacroTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new ApiError(422, "Invalid tags.", { tags: "Use up to 30 tags." });
  }
  const seen = new Set();
  const tags = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 40) {
      throw new ApiError(422, "Invalid tags.", {
        tags: "Each tag must contain 1 to 40 characters.",
      });
    }
    const tag = entry.trim();
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

function validateStep(step, { depth, counter }) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new ApiError(422, "Invalid macro step.", { steps: "Each step must be an object." });
  }
  const type = String(step.type ?? "");
  if (!MACRO_STEP_TYPES.has(type)) {
    throw new ApiError(422, "Invalid macro step type.", {
      steps: "Use typeText, click, move, wait, or loop.",
    });
  }
  counter.value += 1;
  if (counter.value > 1_000) {
    throw new ApiError(422, "Too many macro steps.", {
      steps: "Use 1,000 steps or fewer, including loop contents.",
    });
  }
  const id = optionalUuidLike(step.id, "steps.id");

  if (type === "typeText") {
    if (typeof step.text !== "string" || step.text.length > 50_000) {
      throw new ApiError(422, "Invalid typed text.", {
        steps: "Typed text must contain at most 50,000 characters.",
      });
    }
    const charactersPerSecond = integerInRange(step.charactersPerSecond, "charactersPerSecond", {
      minimum: 1,
      maximum: 500,
      fallback: undefined,
    });
    return {
      ...(id ? { id } : {}),
      type,
      text: step.text,
      ...(charactersPerSecond === undefined ? {} : { charactersPerSecond }),
    };
  }

  if (type === "click") {
    const button = String(step.button ?? "left").toLowerCase();
    const clickType = String(step.clickType ?? "single").toLowerCase();
    if (!CLICK_BUTTONS.has(button) || !CLICK_TYPES.has(clickType)) {
      throw new ApiError(422, "Invalid click step.", {
        steps: "Click steps use left, right, or middle buttons and single or double clicks.",
      });
    }
    return {
      ...(id ? { id } : {}),
      type,
      x: coordinate(step.x, "steps.x"),
      y: coordinate(step.y, "steps.y"),
      button,
      clickType,
      intervalMs: integerInRange(step.intervalMs, "clickIntervalMs", {
        minimum: 0,
        maximum: 60_000,
        fallback: undefined,
      }),
    };
  }

  if (type === "move") {
    return {
      ...(id ? { id } : {}),
      type,
      x: coordinate(step.x, "steps.x"),
      y: coordinate(step.y, "steps.y"),
      durationMs: integerInRange(step.durationMs, "durationMs", {
        minimum: 0,
        maximum: 60_000,
        fallback: 0,
      }),
    };
  }

  if (type === "wait") {
    return {
      ...(id ? { id } : {}),
      type,
      durationMs: integerInRange(step.durationMs, "durationMs", {
        minimum: 0,
        maximum: 86_400_000,
        fallback: 1_000,
      }),
    };
  }

  if (depth >= 4) {
    throw new ApiError(422, "Macro loops are nested too deeply.", {
      steps: "Use at most four nested loop levels.",
    });
  }
  if (!Array.isArray(step.steps) || step.steps.length === 0 || step.steps.length > 200) {
    throw new ApiError(422, "Invalid loop step.", {
      steps: "A loop must contain between 1 and 200 steps.",
    });
  }
  return {
    ...(id ? { id } : {}),
    type,
    count: integerInRange(step.count, "count", {
      minimum: 1,
      maximum: 10_000,
      fallback: 1,
    }),
    steps: step.steps.map((nestedStep) => validateStep(nestedStep, { depth: depth + 1, counter })),
  };
}

export function validateMacroSteps(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) {
    throw new ApiError(422, "Invalid macro steps.", {
      steps: "Use an ordered list of 500 steps or fewer.",
    });
  }
  const counter = { value: 0 };
  return value.map((step) => validateStep(step, { depth: 0, counter }));
}

function validateRepeat(value) {
  if (value === undefined || value === null) return { mode: "count", count: 1 };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "Invalid repeat setting.", { repeat: "Use a repeat configuration." });
  }
  const mode = String(value.mode ?? "count").toLowerCase();
  if (mode === "count") {
    return {
      mode,
      count: integerInRange(value.count, "repeat.count", {
        minimum: 1,
        maximum: 10_000,
        fallback: 1,
      }),
    };
  }
  if (mode === "continuous") return { mode };
  if (mode === "duration") {
    return {
      mode,
      durationMs: integerInRange(value.durationMs, "repeat.durationMs", {
        minimum: 1,
        maximum: 86_400_000,
        fallback: 60_000,
      }),
    };
  }
  throw new ApiError(422, "Invalid repeat setting.", {
    repeat: "Use count, continuous, or duration mode.",
  });
}

function validateBoundary(value) {
  if (value === undefined || value === null || value === false) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.enabled === false) return null;
  const width = coordinate(value.width, "boundary.width");
  const height = coordinate(value.height, "boundary.height");
  if (width <= 0 || height <= 0) {
    throw new ApiError(422, "Invalid click boundary.", {
      boundary: "Width and height must be greater than zero.",
    });
  }
  return {
    x: coordinate(value.x, "boundary.x"),
    y: coordinate(value.y, "boundary.y"),
    width,
    height,
  };
}

function validateFocusTrigger(value) {
  if (value === undefined || value === null || value === false) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.enabled === false) return null;
  const application = optionalText(value.application ?? value.appName, "focusTrigger.application", 200);
  if (!application) {
    throw new ApiError(422, "Invalid focus trigger.", {
      focusTrigger: "Enter the target app or window name.",
    });
  }
  return { application };
}

function validateMailMerge(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "Invalid mail merge data.", {
      mailMerge: "Use a tabular mail merge configuration.",
    });
  }
  const headers = value.headers === undefined ? [] : value.headers;
  const rows = value.rows === undefined ? [] : value.rows;
  if (!Array.isArray(headers) || headers.length > 100 || !Array.isArray(rows) || rows.length > 10_000) {
    throw new ApiError(422, "Invalid mail merge data.", {
      mailMerge: "Use up to 100 columns and 10,000 rows.",
    });
  }
  const normalizedHeaders = headers.map((header) => optionalText(header, "mailMerge.headers", 120, ""));
  if (normalizedHeaders.some((header) => !header)) {
    throw new ApiError(422, "Invalid mail merge columns.", {
      mailMerge: "Each mail merge column needs a name.",
    });
  }
  const seen = new Set();
  for (const header of normalizedHeaders) {
    const key = header.toLowerCase();
    if (seen.has(key)) {
      throw new ApiError(422, "Duplicate mail merge column.", {
        mailMerge: "Mail merge column names must be unique.",
      });
    }
    seen.add(key);
  }
  const normalizedRows = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ApiError(422, "Invalid mail merge row.", {
        mailMerge: "Each mail merge row must be an object.",
      });
    }
    const normalizedRow = {};
    for (const header of normalizedHeaders) {
      const cell = row[header] ?? "";
      if (typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") {
        throw new ApiError(422, "Invalid mail merge value.", {
          mailMerge: "Mail merge cells must be text, numbers, or true/false.",
        });
      }
      const text = String(cell);
      if (text.length > 10_000) {
        throw new ApiError(422, "Invalid mail merge value.", {
          mailMerge: "Mail merge cells must contain 10,000 characters or fewer.",
        });
      }
      normalizedRow[header] = text;
    }
    return normalizedRow;
  });
  return {
    sourceName: optionalText(value.sourceName, "mailMerge.sourceName", 120),
    headers: normalizedHeaders,
    rows: normalizedRows,
    cursor: integerInRange(value.cursor, "mailMerge.cursor", {
      minimum: 0,
      maximum: Math.max(rows.length, 0),
      fallback: 0,
    }),
  };
}

/**
 * Normalizes the portable macro document. Runtime-only values (the current
 * canvas cursor, pause state, and recorder state) intentionally never enter
 * storage; the simulation engine owns those values.
 */
export function validateMacroInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "A macro object is required.");
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120) {
    throw new ApiError(422, "A macro name between 1 and 120 characters is required.", {
      name: "Enter a name for this macro.",
    });
  }
  return {
    name: value.name.trim(),
    hotkey: normalizeHotkey(value.hotkey),
    folder: optionalText(value.folder ?? value.category, "folder", 120),
    tags: validateMacroTags(value.tags),
    steps: validateMacroSteps(value.steps),
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
    clickIntervalMs: integerInRange(value.clickIntervalMs, "clickIntervalMs", {
      minimum: 0,
      maximum: 60_000,
      fallback: 100,
    }),
    repeat: validateRepeat(value.repeat),
    boundary: validateBoundary(value.boundary),
    focusTrigger: validateFocusTrigger(value.focusTrigger),
    mailMerge: validateMailMerge(value.mailMerge),
  };
}

export function validateMacroHistoryInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "A macro execution record is required.");
  }
  const macroId = validateUuid(value.macroId, "macroId");
  const durationMs = integerInRange(value.durationMs, "durationMs", {
    minimum: 0,
    maximum: 86_400_000,
    fallback: undefined,
  });
  if (durationMs === undefined) {
    throw new ApiError(422, "A duration is required.", {
      durationMs: "Enter the execution duration in milliseconds.",
    });
  }
  const status = String(value.status ?? "completed").toLowerCase();
  if (!MACRO_STATUSES.has(status)) {
    throw new ApiError(422, "Invalid macro execution status.", {
      status: "Use completed, stopped, error, or rate_limited.",
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
  return {
    macroId,
    startedAt: startedAt.toISOString(),
    durationMs,
    status,
    stepsCompleted: integerInRange(value.stepsCompleted, "stepsCompleted", {
      minimum: 0,
      maximum: 1_000_000,
      fallback: 0,
    }),
    timeSavedMs: integerInRange(value.timeSavedMs, "timeSavedMs", {
      minimum: 0,
      maximum: 86_400_000,
      fallback: 0,
    }),
    errorMessage: optionalText(value.errorMessage, "errorMessage", 500),
  };
}

function parseScheduleTime(value, field, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new ApiError(422, `A ${field} is required.`, {
        [field]: "Use an ISO 8601 timestamp.",
      });
    }
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(422, `Invalid ${field}.`, { [field]: "Use an ISO 8601 timestamp." });
  }
  return parsed.toISOString();
}

export function validateMacroScheduleInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "A macro schedule is required.");
  }
  const macroId = validateUuid(value.macroId, "macroId");
  const type = String(value.type ?? value.scheduleType ?? "").toLowerCase();
  if (!["once", "interval"].includes(type)) {
    throw new ApiError(422, "Invalid schedule type.", {
      type: "Use once or interval.",
    });
  }
  const enabled = value.enabled === undefined ? true : Boolean(value.enabled);
  if (type === "once") {
    const runAt = parseScheduleTime(value.runAt, "runAt", true);
    return {
      macroId,
      type,
      enabled,
      runAt,
      startsAt: null,
      intervalMs: null,
    };
  }
  return {
    macroId,
    type,
    enabled,
    runAt: null,
    startsAt: parseScheduleTime(value.startsAt, "startsAt") ?? new Date().toISOString(),
    intervalMs: integerInRange(value.intervalMs, "intervalMs", {
      minimum: 1_000,
      maximum: 2_592_000_000,
      fallback: 3_600_000,
    }),
  };
}

export function validateMacroScheduleTriggeredInput(value = {}) {
  if (value === undefined || value === null) return { triggeredAt: new Date().toISOString() };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "A schedule trigger object is required.");
  }
  return { triggeredAt: parseScheduleTime(value.triggeredAt, "triggeredAt") ?? new Date().toISOString() };
}
