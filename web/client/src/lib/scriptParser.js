/**
 * Parsing utilities shared by the editor preview and the playback engine.
 *
 * A parsed script is intentionally a flat list of units.  That makes timing,
 * progress reporting, pause/resume, and target-window mutations use exactly
 * the same representation.  Text units are grapheme clusters rather than
 * UTF-16 code units, so an emoji or a combining-character sequence is never
 * split across two ticks.
 */

const SPECIAL_KEY_TOKENS = new Map([
  ["tab", "tab"],
  ["enter", "enter"],
  ["return", "enter"],
  ["space", "space"],
  ["spacebar", "space"],
  ["backspace", "backspace"],
  ["bs", "backspace"],
  ["bksp", "backspace"],
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

const MAX_WAIT_MS = 86_400_000; // One day; safely below an unbounded input.

let graphemeSegmenter;

/**
 * Return user-perceived characters.  Modern browsers and supported Node
 * versions expose Intl.Segmenter; the fallback still keeps surrogate pairs
 * together when it is unavailable.
 */
export function segmentGraphemes(value) {
  const text = value == null ? "" : String(value);
  if (!text) {
    return [];
  }

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    graphemeSegmenter ??= new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
  }

  return Array.from(text);
}

function parseToken(rawToken) {
  const normalized = rawToken.trim().toLowerCase();
  const key = SPECIAL_KEY_TOKENS.get(normalized);
  if (key) {
    return { kind: "key", value: key };
  }

  // WAIT is not required for the assignment, but costs no extra dependency
  // and mirrors the desktop predecessor's useful script syntax. Unknown or
  // out-of-range wait-like tokens intentionally remain literal text.
  const wait = /^wait(?:\s+|:)\s*(\d{1,9})$/i.exec(rawToken.trim());
  if (wait) {
    const durationMs = Number(wait[1]);
    if (Number.isSafeInteger(durationMs) && durationMs <= MAX_WAIT_MS) {
      return { kind: "wait", durationMs };
    }
  }

  return null;
}

/**
 * Parse a script into playback units.
 *
 * Supported tokens are case-insensitive: {Tab}, {Enter}, {Space}, plus a few
 * harmless editing/navigation keys. {{ and }} escape literal braces. Unknown
 * or unclosed tokens are emitted as ordinary text so templates such as
 * "Hello {customer_name}" are never corrupted.
 */
export function parseScript(script) {
  const source = script == null ? "" : String(script);
  const units = [];
  let bufferedText = "";

  const appendText = (text) => {
    bufferedText += text;
  };

  const flushText = () => {
    if (!bufferedText) {
      return;
    }
    for (const value of segmentGraphemes(bufferedText)) {
      units.push({ kind: "text", value });
    }
    bufferedText = "";
  };

  let index = 0;
  while (index < source.length) {
    if (source.startsWith("{{", index)) {
      appendText("{");
      index += 2;
      continue;
    }

    if (source.startsWith("}}", index)) {
      appendText("}");
      index += 2;
      continue;
    }

    if (source[index] !== "{") {
      appendText(source[index]);
      index += 1;
      continue;
    }

    const closeIndex = source.indexOf("}", index + 1);
    if (closeIndex < 0) {
      appendText(source.slice(index));
      break;
    }

    const rawToken = source.slice(index + 1, closeIndex);
    const unit = parseToken(rawToken);
    if (unit) {
      flushText();
      units.push(unit);
    } else {
      appendText(source.slice(index, closeIndex + 1));
    }
    index = closeIndex + 1;
  }

  flushText();
  return units;
}

/** Count output actions for progress bars; waits deliberately do not count. */
export function countTypingUnits(units) {
  if (!Array.isArray(units)) {
    return 0;
  }
  return units.reduce(
    (count, unit) =>
      count + (unit?.kind === "text" || unit?.kind === "key" ? 1 : 0),
    0,
  );
}

export function isTypingUnit(unit) {
  return unit?.kind === "text" || unit?.kind === "key";
}

export const supportedScriptTokens = Object.freeze([
  "{Tab}",
  "{Enter}",
  "{Space}",
  "{Backspace}",
  "{Delete}",
  "{Left}",
  "{Right}",
  "{Up}",
  "{Down}",
]);
