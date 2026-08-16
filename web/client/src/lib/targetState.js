import { segmentGraphemes } from "./scriptParser.js";

const KEY_ALIASES = new Map([
  ["enter", "enter"],
  ["return", "enter"],
  ["tab", "tab"],
  ["space", "space"],
  ["spacebar", "space"],
  ["backspace", "backspace"],
  ["bs", "backspace"],
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
  ["escape", "escape"],
  ["esc", "escape"],
]);

function asIndex(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(maximum, Math.trunc(parsed)));
}

function normalizeState(state) {
  const text = state?.text == null ? "" : String(state.text);
  const start = asIndex(state?.selectionStart, text.length, text.length);
  const end = asIndex(state?.selectionEnd, start, text.length);
  return {
    text,
    selectionStart: Math.min(start, end),
    selectionEnd: Math.max(start, end),
  };
}

function replaceSelection(state, insertion) {
  const text =
    state.text.slice(0, state.selectionStart) +
    insertion +
    state.text.slice(state.selectionEnd);
  const caret = state.selectionStart + insertion.length;
  return { text, selectionStart: caret, selectionEnd: caret };
}

function graphemeBoundaries(text) {
  const boundaries = [0];
  let offset = 0;
  for (const grapheme of segmentGraphemes(text)) {
    offset += grapheme.length;
    boundaries.push(offset);
  }
  return boundaries;
}

function boundaryBefore(text, index) {
  const boundaries = graphemeBoundaries(text);
  let previous = 0;
  for (const boundary of boundaries) {
    if (boundary >= index) {
      return previous;
    }
    previous = boundary;
  }
  return previous;
}

function boundaryAfter(text, index) {
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > index) {
      return boundary;
    }
  }
  return text.length;
}

function boundaryAtOrBefore(text, index) {
  let result = 0;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > index) {
      break;
    }
    result = boundary;
  }
  return result;
}

function lineStart(text, index) {
  return text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function lineEnd(text, index) {
  const nextBreak = text.indexOf("\n", index);
  return nextBreak < 0 ? text.length : nextBreak;
}

function moveLine(text, index, direction) {
  const currentStart = lineStart(text, index);
  const currentEnd = lineEnd(text, index);
  const column = index - currentStart;

  if (direction < 0) {
    if (currentStart === 0) {
      return index;
    }
    const previousEnd = currentStart - 1;
    const previousStart = lineStart(text, previousEnd);
    const target = Math.min(previousStart + column, previousEnd);
    return boundaryAtOrBefore(text, target);
  }

  if (currentEnd === text.length) {
    return index;
  }
  const nextStart = currentEnd + 1;
  const nextEnd = lineEnd(text, nextStart);
  const target = Math.min(nextStart + column, nextEnd);
  return boundaryAtOrBefore(text, target);
}

function normalizeKey(value) {
  return KEY_ALIASES.get(String(value ?? "").trim().toLowerCase()) ?? "";
}

/**
 * Apply a single parser unit to a textarea-like `{ text, selectionStart,
 * selectionEnd }` value. It is pure and does not require the textarea to keep
 * browser focus, which is what lets app-wide hotkeys still type into the
 * dedicated Target Window panel.
 */
export function applyTargetUnit(state, unit) {
  const normalized = normalizeState(state);
  if (!unit || typeof unit !== "object") {
    return normalized;
  }

  if (unit.kind === "text") {
    return replaceSelection(normalized, String(unit.value ?? ""));
  }

  // A wait advances the playback clock but has no target-window mutation.
  if (unit.kind !== "key") {
    return normalized;
  }

  const key = normalizeKey(unit.value);
  switch (key) {
    case "enter":
      return replaceSelection(normalized, "\n");
    case "tab":
      // A literal tab is the textarea-equivalent of a simulated Tab key. CSS
      // `tab-size` can make this clearly visible in the target panel.
      return replaceSelection(normalized, "\t");
    case "space":
      return replaceSelection(normalized, " ");
    case "backspace": {
      if (normalized.selectionStart !== normalized.selectionEnd) {
        return replaceSelection(normalized, "");
      }
      const start = boundaryBefore(normalized.text, normalized.selectionStart);
      return replaceSelection(
        { ...normalized, selectionStart: start, selectionEnd: normalized.selectionEnd },
        "",
      );
    }
    case "delete": {
      if (normalized.selectionStart !== normalized.selectionEnd) {
        return replaceSelection(normalized, "");
      }
      const end = boundaryAfter(normalized.text, normalized.selectionEnd);
      return replaceSelection(
        { ...normalized, selectionEnd: end },
        "",
      );
    }
    case "arrowleft": {
      const caret =
        normalized.selectionStart !== normalized.selectionEnd
          ? normalized.selectionStart
          : boundaryBefore(normalized.text, normalized.selectionStart);
      return { ...normalized, selectionStart: caret, selectionEnd: caret };
    }
    case "arrowright": {
      const caret =
        normalized.selectionStart !== normalized.selectionEnd
          ? normalized.selectionEnd
          : boundaryAfter(normalized.text, normalized.selectionEnd);
      return { ...normalized, selectionStart: caret, selectionEnd: caret };
    }
    case "arrowup": {
      const caret = moveLine(normalized.text, normalized.selectionStart, -1);
      return { ...normalized, selectionStart: caret, selectionEnd: caret };
    }
    case "arrowdown": {
      const caret = moveLine(normalized.text, normalized.selectionEnd, 1);
      return { ...normalized, selectionStart: caret, selectionEnd: caret };
    }
    case "home": {
      const caret = lineStart(normalized.text, normalized.selectionStart);
      return { ...normalized, selectionStart: caret, selectionEnd: caret };
    }
    case "end": {
      const caret = lineEnd(normalized.text, normalized.selectionEnd);
      return { ...normalized, selectionStart: caret, selectionEnd: caret };
    }
    default:
      // Escape and unsupported keys intentionally have no text-buffer effect.
      return normalized;
  }
}

export function applyTargetUnits(state, units) {
  if (!Array.isArray(units)) {
    return normalizeState(state);
  }
  return units.reduce((nextState, unit) => applyTargetUnit(nextState, unit), state);
}
