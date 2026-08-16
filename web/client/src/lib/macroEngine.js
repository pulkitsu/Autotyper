/**
 * Pure macro-domain helpers shared by the macro editor and the canvas runner.
 *
 * This module deliberately has no DOM, timer, clipboard, or storage access.
 * The UI supplies a snapshot of those values, which keeps a run deterministic
 * and makes the same planner usable by browser and Electron renderers.
 */
import { canonicalizeHotkey, validateHotkey } from "./hotkeys.js";
import { parseScript } from "./scriptParser.js";

export const MACRO_STEP_TYPES = Object.freeze([
  "typeText",
  "click",
  "move",
  "wait",
  "loop",
]);

export const CLICK_BUTTONS = Object.freeze(["left", "right", "middle"]);
export const CLICK_TYPES = Object.freeze(["single", "double"]);

export const DEFAULT_MACRO = Object.freeze({
  name: "",
  hotkey: "",
  folder: null,
  tags: [],
  steps: [],
  charactersPerSecond: 15,
  startDelayMs: 1000,
  clickIntervalMs: 100,
  repeat: { mode: "count", count: 1 },
  boundary: null,
  focusTrigger: null,
  mailMerge: null,
});

export const DEFAULT_PLAN_LIMITS = Object.freeze({
  maxLoopDepth: 4,
  maxExpandedActions: 20_000,
  maxClicksPerSecond: 10,
});

export class MacroValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "MacroValidationError";
    this.errors = errors;
  }
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberInRange(value, fallback, minimum, maximum, { integer = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.max(minimum, Math.min(maximum, parsed));
  return integer ? Math.trunc(bounded) : bounded;
}

function optionalText(value, maximum, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text ? text.slice(0, maximum) : fallback;
}

function pointNumber(value, fallback = 0) {
  return numberInRange(value, fallback, 0, 100_000, { integer: false });
}

function validCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000;
}

function stepId(value) {
  return typeof value === "string" && value.length <= 100 && value.trim()
    ? value.trim()
    : undefined;
}

function issue(errors, path, message) {
  errors.push({ path, message });
}

function normalizeTags(value) {
  const input = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set();
  const tags = [];
  for (const entry of input) {
    const tag = optionalText(entry, 40, null);
    if (!tag || tags.length >= 30) continue;
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

/** Normalize a repeat configuration without expanding an unbounded run. */
export function normalizeRepeatConfig(value) {
  const source = object(value);
  const mode = String(source.mode ?? "count").toLowerCase();
  if (mode === "continuous") return { mode };
  if (mode === "duration") {
    return {
      mode,
      durationMs: numberInRange(source.durationMs, 60_000, 1, 86_400_000),
    };
  }
  return {
    mode: "count",
    count: numberInRange(source.count, 1, 1, 10_000),
  };
}

/** Return true when a next run is permitted under a macro's repeat setting. */
export function shouldContinueRepeat(repeat, { completedRuns = 0, elapsedMs = 0 } = {}) {
  const normalized = normalizeRepeatConfig(repeat);
  if (normalized.mode === "continuous") return true;
  if (normalized.mode === "duration") return Number(elapsedMs) < normalized.durationMs;
  return Number(completedRuns) < normalized.count;
}

/** Normalize an optional canvas rectangle. `null` means no restriction. */
export function normalizeCanvasBoundary(value) {
  if (!value || value === false || object(value).enabled === false) return null;
  const source = object(value);
  const width = Number(source.width);
  const height = Number(source.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: pointNumber(source.x),
    y: pointNumber(source.y),
    width: numberInRange(width, 1, Number.EPSILON, 100_000, { integer: false }),
    height: numberInRange(height, 1, Number.EPSILON, 100_000, { integer: false }),
  };
}

/** Clamp a coordinate to a canvas boundary and disclose whether it moved. */
export function clampPointToBoundary(point, boundary) {
  const x = pointNumber(point?.x);
  const y = pointNumber(point?.y);
  const restricted = normalizeCanvasBoundary(boundary);
  if (!restricted) return { x, y, clamped: false };
  const nextX = Math.max(restricted.x, Math.min(restricted.x + restricted.width, x));
  const nextY = Math.max(restricted.y, Math.min(restricted.y + restricted.height, y));
  return { x: nextX, y: nextY, clamped: nextX !== x || nextY !== y };
}

/**
 * The actual interval is the stricter of the editor setting and a rate limit.
 * This is intentionally calculated client-side too so visual simulation cannot
 * accidentally preview an unsafe click cadence.
 */
export function effectiveClickIntervalMs(macro, limits = {}) {
  const source = object(macro);
  const configured = numberInRange(source.clickIntervalMs, 100, 0, 60_000);
  const maxClicksPerSecond = numberInRange(
    limits.maxClicksPerSecond ?? source.maxClicksPerSecond,
    DEFAULT_PLAN_LIMITS.maxClicksPerSecond,
    1,
    1_000,
  );
  return Math.max(configured, Math.ceil(1_000 / maxClicksPerSecond));
}

function normalizeStepInternal(input, { depth = 0, errors = [], path = "steps" } = {}) {
  const source = object(input);
  const type = String(source.type ?? "");
  const common = stepId(source.id) ? { id: stepId(source.id) } : {};
  if (!MACRO_STEP_TYPES.includes(type)) {
    issue(errors, path, "Use typeText, click, move, wait, or loop.");
    return { ...common, type: "typeText", text: "" };
  }

  if (type === "typeText") {
    if (typeof source.text !== "string") issue(errors, `${path}.text`, "Typed text must be text.");
    if (String(source.text ?? "").length > 50_000) issue(errors, `${path}.text`, "Typed text is limited to 50,000 characters.");
    const charactersPerSecond = source.charactersPerSecond === undefined
      ? undefined
      : numberInRange(source.charactersPerSecond, 1, 1, 500);
    return {
      ...common,
      type,
      text: String(source.text ?? "").slice(0, 50_000),
      ...(charactersPerSecond === undefined ? {} : { charactersPerSecond }),
    };
  }

  if (type === "click") {
    const button = String(source.button ?? "left").toLowerCase();
    const clickType = String(source.clickType ?? "single").toLowerCase();
    if (!CLICK_BUTTONS.includes(button)) issue(errors, `${path}.button`, "Use left, right, or middle.");
    if (!CLICK_TYPES.includes(clickType)) issue(errors, `${path}.clickType`, "Use single or double.");
    if (!validCoordinate(source.x) || !validCoordinate(source.y)) {
      issue(errors, path, "Click steps need x and y coordinates.");
    }
    return {
      ...common,
      type,
      x: pointNumber(source.x),
      y: pointNumber(source.y),
      button: CLICK_BUTTONS.includes(button) ? button : "left",
      clickType: CLICK_TYPES.includes(clickType) ? clickType : "single",
      intervalMs: numberInRange(source.intervalMs, 100, 0, 60_000),
    };
  }

  if (type === "move") {
    if (!validCoordinate(source.x) || !validCoordinate(source.y)) {
      issue(errors, path, "Move steps need x and y coordinates.");
    }
    return {
      ...common,
      type,
      x: pointNumber(source.x),
      y: pointNumber(source.y),
      durationMs: numberInRange(source.durationMs, 0, 0, 60_000),
    };
  }

  if (type === "wait") {
    return {
      ...common,
      type,
      durationMs: numberInRange(source.durationMs, 1_000, 0, 86_400_000),
    };
  }

  if (depth >= DEFAULT_PLAN_LIMITS.maxLoopDepth) {
    issue(errors, path, "Loops can be nested at most four levels deep.");
  }
  if (!Array.isArray(source.steps) || !source.steps.length) {
    issue(errors, `${path}.steps`, "A loop needs at least one nested step.");
  }
  const nested = Array.isArray(source.steps) ? source.steps.slice(0, 200) : [];
  return {
    ...common,
    type,
    count: numberInRange(source.count, 1, 1, 10_000),
    steps: nested.map((step, index) => normalizeStepInternal(step, {
      depth: depth + 1,
      errors,
      path: `${path}.steps[${index}]`,
    })),
  };
}

/** Return a storage-compatible, canonical macro step. */
export function normalizeMacroStep(input, options = {}) {
  return normalizeStepInternal(input, options);
}

export function validateMacroStep(input, options = {}) {
  const errors = [];
  const value = normalizeStepInternal(input, { ...options, errors, path: options.path ?? "steps[0]" });
  return { valid: errors.length === 0, value, errors };
}

/** Make a new editor-ready step without sharing nested mutable arrays. */
export function createMacroStep(type = "typeText", overrides = {}) {
  const presets = {
    typeText: { type: "typeText", text: "" },
    click: { type: "click", x: 0, y: 0, button: "left", clickType: "single", intervalMs: 100 },
    move: { type: "move", x: 0, y: 0, durationMs: 0 },
    wait: { type: "wait", durationMs: 1000 },
    loop: { type: "loop", count: 2, steps: [{ type: "wait", durationMs: 250 }] },
  };
  return normalizeMacroStep({ ...(presets[type] ?? presets.typeText), ...object(overrides) });
}

export function reorderMacroSteps(steps, fromIndex, toIndex) {
  const next = Array.isArray(steps) ? [...steps] : [];
  const from = Math.trunc(Number(fromIndex));
  const to = Math.trunc(Number(toIndex));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function duplicateMacroStep(steps, index, duplicateId) {
  const next = Array.isArray(steps) ? structuredClone(steps) : [];
  const position = Math.trunc(Number(index));
  if (!Number.isInteger(position) || position < 0 || position >= next.length) return next;
  const copy = structuredClone(next[position]);
  if (duplicateId) copy.id = String(duplicateId);
  else delete copy.id;
  next.splice(position + 1, 0, copy);
  return next;
}

/** Normalize the flat API/storage macro document used by the backend. */
export function normalizeMacro(input = {}) {
  const source = object(input);
  const steps = Array.isArray(source.steps) ? source.steps.slice(0, 500) : [];
  const boundary = normalizeCanvasBoundary(source.boundary);
  const focus = object(source.focusTrigger);
  const focusApplication = optionalText(focus.application ?? focus.appName, 200, null);
  return {
    ...(source.id ? { id: String(source.id) } : {}),
    name: optionalText(source.name, 120, ""),
    hotkey: canonicalizeHotkey(source.hotkey ?? ""),
    folder: optionalText(source.folder ?? source.category, 120, null),
    tags: normalizeTags(source.tags),
    steps: steps.map((step, index) => normalizeStepInternal(step, { path: `steps[${index}]` })),
    charactersPerSecond: numberInRange(source.charactersPerSecond, 15, 1, 500),
    startDelayMs: numberInRange(source.startDelayMs, 1_000, 0, 60_000),
    clickIntervalMs: numberInRange(source.clickIntervalMs, 100, 0, 60_000),
    repeat: normalizeRepeatConfig(source.repeat),
    boundary,
    focusTrigger: focusApplication ? { application: focusApplication } : null,
    mailMerge: normalizeMailMerge(source.mailMerge),
  };
}

/** Validate a macro before API submission, returning all useful field errors. */
export function validateMacro(input, { existingMacros = [], excludeId } = {}) {
  const source = object(input);
  const normalized = normalizeMacro(source);
  const errors = [];
  if (!normalized.name) issue(errors, "name", "Enter a macro name.");
  const hotkey = validateHotkey(source.hotkey ?? "", { existingHotkeys: existingMacros, excludeId: excludeId ?? source.id });
  if (!hotkey.valid) issue(errors, "hotkey", hotkey.error || "Choose a valid hotkey.");
  if (!Array.isArray(source.steps)) issue(errors, "steps", "Use an ordered list of macro steps.");
  if (Array.isArray(source.steps) && source.steps.length > 500) issue(errors, "steps", "Use 500 steps or fewer.");
  let total = 0;
  for (const [index, step] of (Array.isArray(source.steps) ? source.steps : []).entries()) {
    const verdict = validateMacroStep(step, { path: `steps[${index}]` });
    errors.push(...verdict.errors);
    total += countNestedSteps(step);
  }
  if (total > 1_000) issue(errors, "steps", "Use 1,000 steps or fewer, including loop contents.");
  if (source.boundary && object(source.boundary).enabled !== false && !normalizeCanvasBoundary(source.boundary)) {
    issue(errors, "boundary", "Use a boundary with a positive width and height.");
  }
  if (source.focusTrigger && !normalized.focusTrigger) issue(errors, "focusTrigger", "Enter a target app or window name.");
  const merge = validateMailMerge(source.mailMerge);
  errors.push(...merge.errors);
  return { valid: errors.length === 0, value: { ...normalized, mailMerge: merge.value }, errors };
}

function countNestedSteps(step) {
  if (!step || typeof step !== "object") return 1;
  return 1 + (Array.isArray(step.steps) ? step.steps.reduce((count, child) => count + countNestedSteps(child), 0) : 0);
}

/**
 * RFC-4180-style CSV parser. Supports BOMs, quoted commas/newlines, and
 * escaped double quotes. Returned rows are immediately mail-merge compatible.
 */
export function parseCsv(text, { sourceName = null } = {}) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const matrix = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"'; index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"' && cell === "") { quoted = true; continue; }
    if (character === ",") { row.push(cell); cell = ""; continue; }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); matrix.push(row); row = []; cell = ""; continue;
    }
    cell += character;
  }
  if (quoted) throw new MacroValidationError("CSV has an unclosed quoted cell.", [{ path: "csv", message: "CSV has an unclosed quoted cell." }]);
  if (cell || row.length || source.endsWith(",")) { row.push(cell); matrix.push(row); }
  const [rawHeaders = [], ...rawRows] = matrix;
  const headers = rawHeaders.map((header) => String(header).trim());
  const badHeader = !headers.length || headers.some((header) => !header);
  const duplicate = new Set(headers.map((header) => header.toLocaleLowerCase())).size !== headers.length;
  if (badHeader || duplicate) throw new MacroValidationError("CSV headers must be present and unique.", [{ path: "csv.headers", message: "CSV headers must be present and unique." }]);
  const rows = rawRows.filter((cells) => cells.some((entry) => entry !== "")).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, String(cells[index] ?? "")])),
  );
  return { sourceName: optionalText(sourceName, 120, null), headers, rows, cursor: 0 };
}

export function normalizeMailMerge(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = object(value);
  const headers = Array.isArray(source.headers) ? source.headers.map((header) => optionalText(header, 120, "")) : [];
  const rows = Array.isArray(source.rows) ? source.rows.slice(0, 10_000) : [];
  const normalizedRows = rows.map((row) => Object.fromEntries(headers.map((header) => [header, String(object(row)[header] ?? "").slice(0, 10_000)])));
  return {
    sourceName: optionalText(source.sourceName, 120, null),
    headers,
    rows: normalizedRows,
    cursor: numberInRange(source.cursor, 0, 0, Math.max(normalizedRows.length, 0)),
  };
}

export function validateMailMerge(value) {
  if (value === undefined || value === null) return { valid: true, value: null, errors: [] };
  const normalized = normalizeMailMerge(value);
  const errors = [];
  if (!normalized) issue(errors, "mailMerge", "Use tabular mail merge data.");
  else {
    if (Array.isArray(object(value).rows) && object(value).rows.length > 10_000) issue(errors, "mailMerge.rows", "Use 10,000 rows or fewer.");
    if (normalized.headers.length > 100) issue(errors, "mailMerge.headers", "Use 100 columns or fewer.");
    if (normalized.headers.some((header) => !header)) issue(errors, "mailMerge.headers", "Each mail merge column needs a name.");
    if (new Set(normalized.headers.map((header) => header.toLocaleLowerCase())).size !== normalized.headers.length) issue(errors, "mailMerge.headers", "Mail merge columns must be unique.");
  }
  return { valid: errors.length === 0, value: normalized, errors };
}

/** Select the row for a successive macro invocation without mutating storage. */
export function selectCsvRow(mailMerge, runIndex = 0, { wrap = false } = {}) {
  const merge = normalizeMailMerge(mailMerge);
  if (!merge || !merge.rows.length) return { row: null, index: -1, nextCursor: 0, exhausted: true };
  const requested = Math.max(0, Math.trunc(Number(runIndex) || 0));
  if (requested >= merge.rows.length && !wrap) return { row: null, index: -1, nextCursor: merge.rows.length, exhausted: true };
  const index = requested % merge.rows.length;
  return {
    row: structuredClone(merge.rows[index]),
    index,
    nextCursor: wrap ? (index + 1) % merge.rows.length : Math.min(index + 1, merge.rows.length),
    exhausted: false,
  };
}

function dateParts(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

function findCsvValue(row, column) {
  if (!row || !column) return undefined;
  if (Object.hasOwn(row, column)) return row[column];
  const key = Object.keys(row).find((candidate) => candidate.toLocaleLowerCase() === column.toLocaleLowerCase());
  return key === undefined ? undefined : row[key];
}

/** Resolve runtime placeholders while preserving unknown placeholders literally. */
export function resolveTemplateText(text, context = {}) {
  const source = String(text ?? "");
  const parts = dateParts(context.now, context.timeZone);
  const row = context.csvRow ?? null;
  const missing = [];
  const variables = [];
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source.startsWith("{{", index) || source.startsWith("}}", index)) { output += source.slice(index, index + 2); index += 2; continue; }
    if (source[index] !== "{") { output += source[index]; index += 1; continue; }
    const end = source.indexOf("}", index + 1);
    if (end < 0) { output += source.slice(index); break; }
    const raw = source.slice(index + 1, end).trim();
    const key = raw.toLocaleLowerCase();
    let value;
    if (key === "date") value = parts.date;
    else if (key === "time") value = parts.time;
    else if (key === "counter") value = String(context.counter ?? 1);
    else if (key === "clipboard") value = context.clipboard == null ? undefined : String(context.clipboard);
    else if (key.startsWith("csv:")) value = findCsvValue(row, raw.slice(4).trim());
    else { output += source.slice(index, end + 1); index = end + 1; continue; }
    variables.push(raw);
    if (value === undefined) { missing.push(raw); output += ""; } else output += String(value);
    index = end + 1;
  }
  return { value: output, variables, missing };
}

export function resolveTemplate(text, context = {}) {
  return resolveTemplateText(text, context).value;
}

/**
 * Compile one sequential simulation pass. Loop contents are flattened under a
 * hard cap, but repeat mode is returned as configuration rather than expanded
 * so continuous/duration macros can never allocate an infinite action list.
 */
export function buildMacroActionPlan(macro, context = {}, planLimits = {}) {
  const verdict = validateMacro(macro, { existingMacros: context.existingMacros ?? [], excludeId: macro?.id });
  if (!verdict.valid) throw new MacroValidationError("Cannot plan an invalid macro.", verdict.errors);
  const value = verdict.value;
  const limits = { ...DEFAULT_PLAN_LIMITS, ...object(planLimits) };
  const selection = context.csvRow
    ? { row: context.csvRow, index: context.csvIndex ?? -1, nextCursor: context.csvIndex ?? 0, exhausted: false }
    : selectCsvRow(value.mailMerge, context.runIndex ?? value.mailMerge?.cursor ?? 0, { wrap: Boolean(context.csvWrap) });
  const templateContext = { ...context, csvRow: selection.row };
  const actions = [];
  const diagnostics = [];
  const push = (action) => {
    if (actions.length >= limits.maxExpandedActions) throw new MacroValidationError("Macro expands to too many actions.", [{ path: "steps", message: `Use ${limits.maxExpandedActions.toLocaleString()} actions or fewer per run.` }]);
    actions.push(action);
  };
  const visit = (steps, depth = 0) => {
    if (depth > limits.maxLoopDepth) throw new MacroValidationError("Macro loops are nested too deeply.");
    for (const step of steps) {
      if (step.type === "loop") {
        for (let count = 0; count < step.count; count += 1) visit(step.steps, depth + 1);
      } else if (step.type === "typeText") {
        const resolved = resolveTemplateText(step.text, templateContext);
        if (resolved.missing.length) diagnostics.push({ stepId: step.id, type: "missingVariable", variables: resolved.missing });
        for (const unit of parseScript(resolved.value)) {
          if (unit.kind === "text") push({ kind: "text", value: unit.value, stepId: step.id, charactersPerSecond: step.charactersPerSecond ?? value.charactersPerSecond });
          else if (unit.kind === "key") push({ kind: "key", value: unit.value, stepId: step.id, charactersPerSecond: step.charactersPerSecond ?? value.charactersPerSecond });
          else push({ kind: "wait", durationMs: unit.durationMs, stepId: step.id });
        }
      } else if (step.type === "wait") push({ kind: "wait", durationMs: step.durationMs, stepId: step.id });
      else if (step.type === "move") {
        const point = clampPointToBoundary(step, value.boundary);
        push({ kind: "move", ...point, durationMs: step.durationMs, stepId: step.id });
      } else if (step.type === "click") {
        const point = clampPointToBoundary(step, value.boundary);
        const minimumIntervalMs = effectiveClickIntervalMs({ ...value, clickIntervalMs: Math.max(value.clickIntervalMs, step.intervalMs) }, limits);
        push({ kind: "click", ...point, button: step.button, clickType: step.clickType, intervalMs: minimumIntervalMs, stepId: step.id });
      }
    }
  };
  visit(value.steps);
  if (value.mailMerge && selection.exhausted) diagnostics.push({ type: "mailMergeExhausted" });
  return {
    macro: value,
    actions,
    repeat: value.repeat,
    csv: selection,
    diagnostics,
    totalActions: actions.length,
    estimatedDurationMs: estimateActionPlanDuration(actions),
  };
}

export function estimateActionPlanDuration(actions) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((total, action) => {
    if (action?.kind === "wait") return total + Math.max(0, Number(action.durationMs) || 0);
    if (action?.kind === "move") return total + Math.max(0, Number(action.durationMs) || 0);
    if (action?.kind === "click") return total + (action.clickType === "double" ? Math.max(0, Number(action.intervalMs) || 0) : 0);
    if (action?.kind === "text" || action?.kind === "key") return total + Math.round(1_000 / Math.max(1, Number(action.charactersPerSecond) || 1));
    return total;
  }, 0);
}
