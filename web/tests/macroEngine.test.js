import assert from "node:assert/strict";
import test from "node:test";

import {
  MacroValidationError,
  buildMacroActionPlan,
  clampPointToBoundary,
  createMacroStep,
  effectiveClickIntervalMs,
  parseCsv,
  reorderMacroSteps,
  resolveTemplateText,
  selectCsvRow,
  shouldContinueRepeat,
  validateMacro,
} from "../client/src/lib/macroEngine.js";

function macro(overrides = {}) {
  return {
    name: "Demo macro",
    hotkey: "ctrl+alt+1",
    steps: [],
    charactersPerSecond: 20,
    startDelayMs: 0,
    clickIntervalMs: 20,
    repeat: { mode: "count", count: 1 },
    ...overrides,
  };
}

test("normalizes editor step presets and preserves deterministic reordering", () => {
  const click = createMacroStep("click", { x: 12, y: 24, clickType: "double" });
  assert.deepEqual(click, {
    type: "click", x: 12, y: 24, button: "left", clickType: "double", intervalMs: 100,
  });
  assert.deepEqual(
    reorderMacroSteps([{ id: "one" }, { id: "two" }, { id: "three" }], 2, 0).map((step) => step.id),
    ["three", "one", "two"],
  );
});

test("template variables resolve without consuming special key tokens or escaped braces", () => {
  const result = resolveTemplateText(
    "Hi {csv:First Name}{Enter}{date} {time} #{counter} {clipboard} {{Tab}} {unknown}",
    {
      now: "2025-02-03T04:05:06Z",
      timeZone: "UTC",
      counter: 7,
      clipboard: "clip",
      csvRow: { "First Name": "Avery" },
    },
  );
  assert.equal(result.value, "Hi Avery{Enter}2025-02-03 04:05:06 #7 clip {{Tab}} {unknown}");
  assert.deepEqual(result.missing, []);
});

test("reports missing known values as diagnostics-ready data while preserving unknown placeholders", () => {
  const result = resolveTemplateText("{clipboard} {csv:Email} {custom}", { csvRow: {} });
  assert.equal(result.value, "  {custom}");
  assert.deepEqual(result.missing, ["clipboard", "csv:Email"]);
});

test("parses quoted CSV rows and advances a non-wrapping mail merge cursor", () => {
  const csv = parseCsv('\uFEFFFirst Name,Email\n"Avery, J.",avery@example.test\nSam,sam@example.test');
  assert.deepEqual(csv.headers, ["First Name", "Email"]);
  assert.equal(csv.rows[0]["First Name"], "Avery, J.");
  assert.deepEqual(selectCsvRow(csv, 1), {
    row: { "First Name": "Sam", Email: "sam@example.test" },
    index: 1,
    nextCursor: 2,
    exhausted: false,
  });
  assert.equal(selectCsvRow(csv, 2).exhausted, true);
  assert.equal(selectCsvRow(csv, 2, { wrap: true }).row["First Name"], "Avery, J.");
});

test("expands loops sequentially, resolves variables, simulates special keys, and clamps canvas actions", () => {
  const plan = buildMacroActionPlan(
    macro({
      boundary: { x: 10, y: 20, width: 100, height: 50 },
      mailMerge: { headers: ["Name"], rows: [{ Name: "Avery" }], cursor: 0 },
      steps: [
        { id: "write", type: "typeText", text: "Hi {csv:name}{Enter}" },
        { id: "loop", type: "loop", count: 2, steps: [{ id: "wait", type: "wait", durationMs: 5 }] },
        { id: "move", type: "move", x: 500, y: 0, durationMs: 25 },
        { id: "click", type: "click", x: 0, y: 99, button: "right", clickType: "double", intervalMs: 1 },
      ],
    }),
    { runIndex: 0 },
  );
  assert.deepEqual(plan.actions.slice(0, 9).map((action) => action.kind === "text" ? action.value : action.value), ["H", "i", " ", "A", "v", "e", "r", "y", "enter"]);
  assert.deepEqual(plan.actions.filter((action) => action.kind === "wait").map((action) => action.durationMs), [5, 5]);
  const move = plan.actions.find((action) => action.kind === "move");
  assert.deepEqual(move, { kind: "move", x: 110, y: 20, clamped: true, durationMs: 25, stepId: "move" });
  const click = plan.actions.find((action) => action.kind === "click");
  assert.deepEqual(click, { kind: "click", x: 10, y: 70, clamped: true, button: "right", clickType: "double", intervalMs: 100, stepId: "click" });
});

test("rate limits click plans and repeat configuration without materializing continuous runs", () => {
  assert.equal(effectiveClickIntervalMs({ clickIntervalMs: 20 }, { maxClicksPerSecond: 8 }), 125);
  assert.equal(shouldContinueRepeat({ mode: "count", count: 2 }, { completedRuns: 1 }), true);
  assert.equal(shouldContinueRepeat({ mode: "count", count: 2 }, { completedRuns: 2 }), false);
  assert.equal(shouldContinueRepeat({ mode: "duration", durationMs: 500 }, { elapsedMs: 500 }), false);
  assert.equal(shouldContinueRepeat({ mode: "continuous" }, { completedRuns: 10_000 }), true);
  assert.deepEqual(clampPointToBoundary({ x: 9, y: 15 }, { x: 10, y: 20, width: 2, height: 2 }), { x: 10, y: 20, clamped: true });
});

test("rejects invalid macros before planning", () => {
  const invalid = validateMacro(macro({ hotkey: "ctrl+alt+1", steps: [{ type: "click", x: "bad", y: 2 }] }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.path.includes("steps")));
  assert.throws(() => buildMacroActionPlan(macro({ name: "", steps: [] })), MacroValidationError);
});
