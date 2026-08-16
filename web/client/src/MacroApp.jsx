import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api.js";
import { formatDuration, formatTimestamp, shortText } from "./format.js";
import {
  applyTargetUnit,
  buildMacroActionPlan,
  canonicalizeHotkey,
  hotkeyFromKeyboardEvent,
  parseCsv as parseMacroCsv,
  selectCsvRow,
  validateMacro as validateMacroDefinition,
  validateHotkey,
} from "./lib/index.js";
import { useUndoableDraft } from "./hooks/useUndoableDraft.js";
import "./macro.css";

const CANVAS_WIDTH = 760;
const CANVAS_HEIGHT = 270;
const MAX_CLICKS_PER_SECOND = 10;

const EMPTY_MACRO = Object.freeze({
  id: null,
  name: "",
  hotkey: "",
  folder: "",
  tags: [],
  steps: [],
  charactersPerSecond: 18,
  startDelayMs: 500,
  clickIntervalMs: 120,
  repeat: { mode: "count", count: 1 },
  boundary: { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  focusTrigger: null,
  mailMerge: null,
});

const IDLE_RUN = Object.freeze({
  phase: "idle",
  macro: null,
  progress: 0,
  total: 0,
  iteration: 0,
  actionsCompleted: 0,
});

function collection(payload, key) {
  return Array.isArray(payload) ? payload : payload?.[key] ?? [];
}

function nextId(prefix = "step") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  return source.reduce((tags, raw) => {
    const tag = String(raw).trim();
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  }, []);
}

function normalizeRepeat(repeat) {
  const mode = String(repeat?.mode ?? "count").toLowerCase();
  if (mode === "continuous") return { mode };
  if (mode === "duration") {
    return { mode, durationMs: clampNumber(repeat?.durationMs, 60_000, 1, 86_400_000) };
  }
  return { mode: "count", count: clampNumber(repeat?.count, 1, 1, 10_000) };
}

function normalizeBoundary(boundary) {
  if (!boundary) return null;
  return {
    x: clampNumber(boundary.x, 0, 0, 100_000),
    y: clampNumber(boundary.y, 0, 0, 100_000),
    width: clampNumber(boundary.width, CANVAS_WIDTH, 1, 100_000),
    height: clampNumber(boundary.height, CANVAS_HEIGHT, 1, 100_000),
  };
}

function normalizeStep(step = {}) {
  const type = ["typeText", "click", "move", "wait", "loop"].includes(step.type)
    ? step.type
    : "typeText";
  const base = { id: step.id || nextId(), type };
  if (type === "typeText") {
    return {
      ...base,
      text: String(step.text ?? ""),
      ...(step.charactersPerSecond == null
        ? {}
        : { charactersPerSecond: clampNumber(step.charactersPerSecond, 18, 1, 500) }),
    };
  }
  if (type === "click") {
    return {
      ...base,
      x: clampNumber(step.x, 80, 0, 100_000),
      y: clampNumber(step.y, 80, 0, 100_000),
      button: ["left", "right", "middle"].includes(step.button) ? step.button : "left",
      clickType: step.clickType === "double" ? "double" : "single",
      ...(step.intervalMs == null ? {} : { intervalMs: clampNumber(step.intervalMs, 120, 0, 60_000) }),
    };
  }
  if (type === "move") {
    return {
      ...base,
      x: clampNumber(step.x, 80, 0, 100_000),
      y: clampNumber(step.y, 80, 0, 100_000),
      durationMs: clampNumber(step.durationMs, 250, 0, 60_000),
    };
  }
  if (type === "wait") {
    return { ...base, durationMs: clampNumber(step.durationMs, 750, 0, 86_400_000) };
  }
  return {
    ...base,
    count: clampNumber(step.count, 2, 1, 10_000),
    steps: Array.isArray(step.steps) && step.steps.length ? step.steps.map(normalizeStep) : [createStep("wait")],
  };
}

function createStep(type) {
  return normalizeStep({ type });
}

function normalizeMacro(macro = {}) {
  const mailMerge = macro.mailMerge && typeof macro.mailMerge === "object"
    ? {
        sourceName: String(macro.mailMerge.sourceName ?? ""),
        headers: Array.isArray(macro.mailMerge.headers) ? macro.mailMerge.headers.map(String) : [],
        rows: Array.isArray(macro.mailMerge.rows) ? macro.mailMerge.rows : [],
        cursor: clampNumber(macro.mailMerge.cursor, 0, 0, 10_000),
      }
    : null;
  return {
    ...EMPTY_MACRO,
    ...macro,
    name: String(macro.name ?? ""),
    hotkey: canonicalizeHotkey(macro.hotkey ?? ""),
    folder: String(macro.folder ?? ""),
    tags: normalizeTags(macro.tags),
    steps: Array.isArray(macro.steps) ? macro.steps.map(normalizeStep) : [],
    charactersPerSecond: clampNumber(macro.charactersPerSecond, 18, 1, 500),
    startDelayMs: clampNumber(macro.startDelayMs, 500, 0, 60_000),
    clickIntervalMs: clampNumber(macro.clickIntervalMs, 120, 0, 60_000),
    repeat: normalizeRepeat(macro.repeat),
    boundary: macro.boundary === null ? null : normalizeBoundary(macro.boundary ?? EMPTY_MACRO.boundary),
    focusTrigger: macro.focusTrigger?.application ? { application: String(macro.focusTrigger.application) } : null,
    mailMerge,
  };
}

function stepLabel(step) {
  if (step.type === "typeText") return shortText(step.text || "Type text", 48) || "Type text";
  if (step.type === "click") return `${step.clickType === "double" ? "Double " : ""}${step.button} click at ${step.x}, ${step.y}`;
  if (step.type === "move") return `Move to ${step.x}, ${step.y}`;
  if (step.type === "wait") return `Wait ${formatDuration(step.durationMs)}`;
  return `Loop ${step.count}× (${step.steps?.length ?? 0} steps)`;
}

function updateStepTree(steps, id, updater) {
  return steps.map((step) => {
    if (step.id === id) return normalizeStep(updater(step));
    if (step.type === "loop") return { ...step, steps: updateStepTree(step.steps, id, updater) };
    return step;
  });
}

function deleteStepTree(steps, id) {
  return steps
    .filter((step) => step.id !== id)
    .map((step) => step.type === "loop" ? { ...step, steps: deleteStepTree(step.steps, id) } : step);
}

function duplicateStepTree(steps, id) {
  const result = [];
  for (const step of steps) {
    result.push(step.type === "loop" ? { ...step, steps: duplicateStepTree(step.steps, id) } : step);
    if (step.id === id) result.push(normalizeStep({ ...structuredClone(step), id: nextId() }));
  }
  return result;
}

function reorderTopLevel(steps, id, direction) {
  const index = steps.findIndex((step) => step.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function clampPoint(point, boundary) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  if (!boundary) return { x: Math.max(0, x), y: Math.max(0, y) };
  return {
    x: Math.max(boundary.x, Math.min(boundary.x + boundary.width, x)),
    y: Math.max(boundary.y, Math.min(boundary.y + boundary.height, y)),
  };
}

function useMacroSimulation({ onAction, onFinished }) {
  const [run, setRun] = useState(IDLE_RUN);
  const runnerRef = useRef(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const publish = useCallback((runner) => {
    setRun({
      phase: runner.phase,
      macro: runner.macro,
      progress: runner.progress,
      total: runner.actions.length,
      iteration: runner.iteration,
      actionsCompleted: runner.actionsCompleted,
    });
  }, []);

  const finish = useCallback((status, errorMessage = null) => {
    const runner = runnerRef.current;
    if (!runner || runner.finished) return;
    clearTimer();
    runner.finished = true;
    runnerRef.current = null;
    setRun(IDLE_RUN);
    onFinished({
      macro: runner.macro,
      status,
      startedAt: runner.startedAt,
      durationMs: Math.max(0, Date.now() - runner.startedAt),
      stepsCompleted: runner.actionsCompleted,
      errorMessage,
      context: runner.context,
    });
  }, [clearTimer, onFinished]);

  const schedule = useCallback((runner, delay, callback) => {
    runner.pending = callback;
    runner.dueAt = Date.now() + Math.max(0, delay);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (runnerRef.current !== runner || runner.finished || runner.paused) return;
      runner.pending = null;
      callback();
    }, Math.max(0, delay));
  }, [clearTimer]);

  const shouldRepeat = useCallback((runner) => {
    if (runner.macro.repeat.mode === "continuous") return true;
    if (runner.macro.repeat.mode === "duration") {
      return Date.now() - runner.startedAt < runner.macro.repeat.durationMs;
    }
    return runner.iteration < runner.macro.repeat.count;
  }, []);

  const processNext = useCallback((runner) => {
    if (runnerRef.current !== runner || runner.finished || runner.paused) return;
    if (runner.index >= runner.actions.length) {
      if (!runner.actions.length) {
        finish("error", "The macro has no executable actions.");
        return;
      }
      if (shouldRepeat(runner)) {
        runner.iteration += 1;
        runner.index = 0;
        runner.progress = 0;
      } else {
        finish("completed");
        return;
      }
    }

    const action = runner.actions[runner.index];
    runner.index += 1;
    runner.actionsCompleted += 1;
    if (action.type === "wait") {
      runner.phase = "waiting";
      publish(runner);
      schedule(runner, action.durationMs, () => {
        runner.phase = "running";
        publish(runner);
        processNext(runner);
      });
      return;
    }

    if (action.type === "click") {
      const clicks = action.step.clickType === "double" ? 2 : 1;
      const minimum = Math.ceil(1000 / MAX_CLICKS_PER_SECOND);
      const interval = Math.max(minimum, runner.macro.clickIntervalMs, action.step.intervalMs ?? 0);
      onAction(action);
      runner.progress += clicks;
      runner.phase = "clicking";
      publish(runner);
      schedule(runner, interval * clicks, () => processNext(runner));
      return;
    }

    if (action.type === "move") {
      onAction(action);
      runner.progress += 1;
      runner.phase = "moving";
      publish(runner);
      schedule(runner, action.step.durationMs, () => processNext(runner));
      return;
    }

    onAction(action);
    runner.progress += 1;
    runner.phase = "typing";
    publish(runner);
    const cps = action.charactersPerSecond ?? runner.macro.charactersPerSecond;
    schedule(runner, Math.max(12, Math.round(1000 / Math.max(1, cps))), () => processNext(runner));
  }, [finish, onAction, publish, schedule, shouldRepeat]);

  const start = useCallback((macro, context, plannedActions) => {
    if (!macro || !Array.isArray(plannedActions)) return;
    if (runnerRef.current) finish("stopped");
    const actions = plannedActions;
    const runner = {
      macro,
      context,
      actions,
      index: 0,
      progress: 0,
      iteration: 1,
      actionsCompleted: 0,
      phase: macro.startDelayMs > 0 ? "delaying" : "running",
      startedAt: Date.now(),
      paused: false,
      finished: false,
    };
    runnerRef.current = runner;
    publish(runner);
    if (macro.startDelayMs > 0) {
      schedule(runner, macro.startDelayMs, () => {
        runner.phase = "running";
        publish(runner);
        processNext(runner);
      });
    } else processNext(runner);
  }, [finish, processNext, publish, schedule]);

  const togglePause = useCallback(() => {
    const runner = runnerRef.current;
    if (!runner || runner.finished) return;
    if (!runner.paused) {
      runner.resumePhase = runner.phase;
      runner.remainingMs = Math.max(0, (runner.dueAt ?? Date.now()) - Date.now());
      runner.paused = true;
      runner.phase = "paused";
      clearTimer();
      publish(runner);
      return;
    }
    runner.paused = false;
    runner.phase = runner.resumePhase ?? "running";
    publish(runner);
    schedule(runner, runner.remainingMs ?? 0, runner.pending ?? (() => processNext(runner)));
  }, [clearTimer, processNext, publish, schedule]);

  const stop = useCallback(() => finish("stopped"), [finish]);

  useEffect(() => () => {
    clearTimer();
    if (runnerRef.current) runnerRef.current.finished = true;
    runnerRef.current = null;
  }, [clearTimer]);

  return { run, start, stop, togglePause };
}

function Button({ className = "", children, ...props }) {
  return <button className={`button ${className}`.trim()} type="button" {...props}>{children}</button>;
}

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">{label}{hint ? <small>{hint}</small> : null}</span>
      {children}
    </label>
  );
}

function Hotkey({ value }) {
  return <kbd className="hotkey">{value || "Not assigned"}</kbd>;
}

function StatusPill({ status }) {
  return <span className={`status-chip ${status === "completed" ? "is-complete" : status === "error" ? "is-error" : "is-stopped"}`}>{status}</span>;
}

function MacroTable({ macros, selectedId, loading, onSelect, onRun }) {
  if (loading) return <div className="empty-state">Loading macros…</div>;
  if (!macros.length) return <div className="empty-state">No macros match this filter.</div>;
  return (
    <div className="table-scroll library-table-wrap">
      <table className="utility-table macro-library-table">
        <thead><tr><th className="number-column">#</th><th>Shortcut</th><th>Macro</th><th>Folder / Tags</th><th>Steps</th><th className="action-column">Run</th></tr></thead>
        <tbody>{macros.map((macro, index) => (
          <tr className={macro.id === selectedId ? "is-selected" : ""} key={macro.id} onClick={() => onSelect(macro)}>
            <td>{index + 1}</td><td><Hotkey value={macro.hotkey} /></td>
            <td className="cell-ellipsis" title={macro.name}>{macro.name}</td>
            <td className="cell-ellipsis macro-meta" title={`${macro.folder || "No folder"} ${macro.tags.join(", ")}`}>{macro.folder || "—"}{macro.tags.length ? ` · ${macro.tags.join(", ")}` : ""}</td>
            <td>{macro.steps.length}</td>
            <td><button aria-label={`Run ${macro.name}`} className="row-run" onClick={(event) => { event.stopPropagation(); onRun(macro); }}>▶</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function StepCard({ step, index, total, selected, onSelect, onUpdate, onDelete, onDuplicate, onMove, nested = false, onAddNested }) {
  const change = (patch) => onUpdate({ ...step, ...patch });
  return (
    <article className={`macro-step ${selected ? "is-selected" : ""} ${nested ? "is-nested" : ""}`} onClick={() => onSelect(step.id)}>
      <div className="macro-step-header">
        <span className={`step-type step-${step.type}`}>{step.type === "typeText" ? "Type Text" : step.type}</span>
        <span className="step-summary">{stepLabel(step)}</span>
        {!nested ? <span className="step-order">{index + 1}</span> : null}
        <div className="step-tools">
          {!nested ? <button aria-label="Move step up" disabled={index === 0} onClick={(event) => { event.stopPropagation(); onMove(-1); }}>↑</button> : null}
          {!nested ? <button aria-label="Move step down" disabled={index === total - 1} onClick={(event) => { event.stopPropagation(); onMove(1); }}>↓</button> : null}
          <button aria-label="Duplicate step" onClick={(event) => { event.stopPropagation(); onDuplicate(); }}>⧉</button>
          <button aria-label="Delete step" className="danger-icon" onClick={(event) => { event.stopPropagation(); onDelete(); }}>×</button>
        </div>
      </div>
      <div className="macro-step-body">
        {step.type === "typeText" ? <>
          <textarea aria-label="Text to type" onChange={(event) => change({ text: event.target.value })} placeholder="Hello {date}{Enter}" rows="3" value={step.text} />
          <div className="step-inline-fields"><Field label="Override speed" hint="optional cps"><input min="1" onChange={(event) => change({ charactersPerSecond: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Use macro default" type="number" value={step.charactersPerSecond ?? ""} /></Field></div>
        </> : null}
        {step.type === "click" ? <div className="step-grid">
          <Field label="X"><input min="0" onChange={(event) => change({ x: Number(event.target.value) })} type="number" value={step.x} /></Field>
          <Field label="Y"><input min="0" onChange={(event) => change({ y: Number(event.target.value) })} type="number" value={step.y} /></Field>
          <Field label="Button"><select onChange={(event) => change({ button: event.target.value })} value={step.button}><option value="left">Left</option><option value="right">Right</option><option value="middle">Middle</option></select></Field>
          <Field label="Click type"><select onChange={(event) => change({ clickType: event.target.value })} value={step.clickType}><option value="single">Single</option><option value="double">Double</option></select></Field>
          <Field label="Step interval" hint="ms"><input min="0" onChange={(event) => change({ intervalMs: Number(event.target.value) })} type="number" value={step.intervalMs ?? ""} /></Field>
        </div> : null}
        {step.type === "move" ? <div className="step-grid">
          <Field label="X"><input min="0" onChange={(event) => change({ x: Number(event.target.value) })} type="number" value={step.x} /></Field>
          <Field label="Y"><input min="0" onChange={(event) => change({ y: Number(event.target.value) })} type="number" value={step.y} /></Field>
          <Field label="Move duration" hint="ms"><input min="0" onChange={(event) => change({ durationMs: Number(event.target.value) })} type="number" value={step.durationMs} /></Field>
        </div> : null}
        {step.type === "wait" ? <div className="step-inline-fields"><Field label="Wait duration" hint="ms"><input min="0" onChange={(event) => change({ durationMs: Number(event.target.value) })} type="number" value={step.durationMs} /></Field></div> : null}
        {step.type === "loop" ? <div className="loop-editor">
          <Field label="Repeat block" hint="times"><input min="1" onChange={(event) => change({ count: Number(event.target.value) })} type="number" value={step.count} /></Field>
          <div className="nested-step-list">{step.steps.map((nestedStep, nestedIndex) => <StepCard key={nestedStep.id} index={nestedIndex} nested onAddNested={onAddNested} onDelete={() => change({ steps: deleteStepTree(step.steps, nestedStep.id) })} onDuplicate={() => change({ steps: duplicateStepTree(step.steps, nestedStep.id) })} onMove={() => {}} onSelect={onSelect} onUpdate={(next) => change({ steps: updateStepTree(step.steps, nestedStep.id, () => next) })} selected={selected === nestedStep.id} step={nestedStep} total={step.steps.length} />)}</div>
          <div className="add-step-row"><Button onClick={() => onAddNested(step.id, "typeText")}>+ Type Text</Button><Button onClick={() => onAddNested(step.id, "click")}>+ Click</Button><Button onClick={() => onAddNested(step.id, "wait")}>+ Wait</Button></div>
        </div> : null}
      </div>
    </article>
  );
}

function StepEditor({ draft, selectedStepId, onSelectedStep, onChange }) {
  const update = (id, next) => onChange({ ...draft, steps: updateStepTree(draft.steps, id, () => next) });
  const add = (type) => onChange({ ...draft, steps: [...draft.steps, createStep(type)] });
  const addNested = (loopId, type) => onChange({ ...draft, steps: updateStepTree(draft.steps, loopId, (step) => ({ ...step, steps: [...step.steps, createStep(type)] })) });
  return <section className="steps-section">
    <div className="subsection-heading"><div><h3>Ordered Steps</h3><p>Drag-style ordering with typing, pointer, wait, and loop actions.</p></div><span>{draft.steps.length} step{draft.steps.length === 1 ? "" : "s"}</span></div>
    <div className="add-step-row macro-add-row"><Button onClick={() => add("typeText")}>+ Type Text</Button><Button onClick={() => add("click")}>+ Click</Button><Button onClick={() => add("move")}>+ Move</Button><Button onClick={() => add("wait")}>+ Wait</Button><Button onClick={() => add("loop")}>+ Loop</Button></div>
    <div className="macro-step-list">{draft.steps.length ? draft.steps.map((step, index) => <StepCard key={step.id} index={index} onAddNested={addNested} onDelete={() => onChange({ ...draft, steps: deleteStepTree(draft.steps, step.id) })} onDuplicate={() => onChange({ ...draft, steps: duplicateStepTree(draft.steps, step.id) })} onMove={(direction) => onChange({ ...draft, steps: reorderTopLevel(draft.steps, step.id, direction) })} onSelect={onSelectedStep} onUpdate={(next) => update(step.id, next)} selected={selectedStepId === step.id} step={step} total={draft.steps.length} />) : <div className="empty-steps">Add a step to begin your macro.</div>}</div>
  </section>;
}

function MacroEditor({ draft, existingMacros, recordingHotkey, saving, undoable, selectedStepId, onSelectedStep, onSave, onDelete, onNew, onCaptureHotkey, onChange, onCsvUpload }) {
  const duplicate = draft.hotkey ? existingMacros.find((macro) => macro.id !== draft.id && canonicalizeHotkey(macro.hotkey) === canonicalizeHotkey(draft.hotkey)) : null;
  const hotkeyResult = validateHotkey(draft.hotkey);
  const hotkeyValid = typeof hotkeyResult === "boolean" ? hotkeyResult : hotkeyResult.valid;
  const set = (field, value) => onChange({ ...draft, [field]: value });
  const isExisting = Boolean(draft.id);
  return <section className="panel macro-editor-panel" aria-label="Macro editor">
    <div className="panel-heading"><div><h2>{isExisting ? "Edit Macro" : "Create Macro"}</h2><p>Build a safe, ordered automation sequence.</p></div><Button className="button-quiet" onClick={onNew}>+ New</Button></div>
    <form className="editor-form macro-editor-form" onSubmit={onSave}>
      <div className="macro-editor-toolbar"><Button disabled={!undoable.canUndo} onClick={undoable.undo}>↶ Undo</Button><Button disabled={!undoable.canRedo} onClick={undoable.redo}>↷ Redo</Button><span>Changes are reversible while editing.</span></div>
      <div className="macro-basics-grid">
        <Field label="Macro name"><input maxLength="120" onChange={(event) => set("name", event.target.value)} placeholder="e.g. Fill customer form" required value={draft.name} /></Field>
        <Field label="Folder / category"><input maxLength="120" onChange={(event) => set("folder", event.target.value)} placeholder="e.g. Sales" value={draft.folder} /></Field>
        <Field label="Tags" hint="comma separated"><input onChange={(event) => set("tags", normalizeTags(event.target.value))} placeholder="email, customer, daily" value={draft.tags.join(", ")} /></Field>
        <Field label="Shortcut Key" hint="App-wide while Auto Typer is focused"><div className="hotkey-input-group"><input className={duplicate || (draft.hotkey && !hotkeyValid) ? "input-warning" : ""} onFocus={() => onCaptureHotkey("start")} onKeyDown={(event) => onCaptureHotkey(event)} placeholder="Press Ctrl + Alt + 1" readOnly value={draft.hotkey} /><Button className={recordingHotkey ? "button-recording" : ""} onClick={() => onCaptureHotkey("start")}>{recordingHotkey ? "Press keys…" : "Record"}</Button><Button className="button-quiet" onClick={() => set("hotkey", "")}>Clear</Button></div>{duplicate ? <p className="field-warning">Already assigned to “{duplicate.name}”.</p> : null}</Field>
      </div>
      <StepEditor draft={draft} onChange={onChange} onSelectedStep={onSelectedStep} selectedStepId={selectedStepId} />
      <details className="macro-advanced" open><summary>Run settings, safety, and data</summary><div className="macro-settings-grid">
        <Field label="Typing speed" hint="characters / sec"><div className="number-input"><input max="500" min="1" onChange={(event) => set("charactersPerSecond", Number(event.target.value))} type="number" value={draft.charactersPerSecond} /><span>cps</span></div></Field>
        <Field label="Initial delay" hint="before starting"><div className="number-input"><input min="0" onChange={(event) => set("startDelayMs", Number(event.target.value))} step="100" type="number" value={draft.startDelayMs} /><span>ms</span></div></Field>
        <Field label="Click interval" hint="rate-limit safe"><div className="number-input"><input min="100" onChange={(event) => set("clickIntervalMs", Number(event.target.value))} type="number" value={draft.clickIntervalMs} /><span>ms</span></div></Field>
        <Field label="Repeat mode"><select onChange={(event) => set("repeat", normalizeRepeat({ ...draft.repeat, mode: event.target.value }))} value={draft.repeat.mode}><option value="count">Run N times</option><option value="continuous">Run continuously</option><option value="duration">Run for duration</option></select></Field>
        {draft.repeat.mode === "count" ? <Field label="Repeat count"><input min="1" onChange={(event) => set("repeat", { mode: "count", count: Number(event.target.value) })} type="number" value={draft.repeat.count} /></Field> : null}
        {draft.repeat.mode === "duration" ? <Field label="Repeat duration" hint="ms"><input min="1" onChange={(event) => set("repeat", { mode: "duration", durationMs: Number(event.target.value) })} type="number" value={draft.repeat.durationMs} /></Field> : null}
        <Field label="Focus-specific binding" hint="future desktop trigger"><input onChange={(event) => set("focusTrigger", event.target.value ? { application: event.target.value } : null)} placeholder="e.g. Chrome — Customer Portal" value={draft.focusTrigger?.application ?? ""} /></Field>
      </div>
      <div className="boundary-settings"><label><input checked={Boolean(draft.boundary)} onChange={(event) => set("boundary", event.target.checked ? normalizeBoundary({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }) : null)} type="checkbox" /> Restrict clicks and moves to the Target Canvas boundary</label>{draft.boundary ? <div className="step-grid"><Field label="Left"><input min="0" onChange={(event) => set("boundary", normalizeBoundary({ ...draft.boundary, x: event.target.value }))} type="number" value={draft.boundary.x} /></Field><Field label="Top"><input min="0" onChange={(event) => set("boundary", normalizeBoundary({ ...draft.boundary, y: event.target.value }))} type="number" value={draft.boundary.y} /></Field><Field label="Width"><input min="1" onChange={(event) => set("boundary", normalizeBoundary({ ...draft.boundary, width: event.target.value }))} type="number" value={draft.boundary.width} /></Field><Field label="Height"><input min="1" onChange={(event) => set("boundary", normalizeBoundary({ ...draft.boundary, height: event.target.value }))} type="number" value={draft.boundary.height} /></Field></div> : null}</div>
      <div className="mail-merge-settings"><div><strong>Mail merge</strong><p>Upload CSV data. Use {'{csv:ColumnName}'} in a Type Text step; each successful run takes the next row.</p></div><input accept=".csv,text/csv" onChange={onCsvUpload} type="file" />{draft.mailMerge ? <p className="merge-status">{draft.mailMerge.sourceName || "CSV"}: {draft.mailMerge.rows.length} rows · {draft.mailMerge.cursor < draft.mailMerge.rows.length ? `next row ${draft.mailMerge.cursor + 1}` : "all rows used"}<Button className="button-quiet" onClick={() => set("mailMerge", null)}>Remove</Button></p> : null}</div>
      <p className="variable-help">Variables: {'{date}'} {'{time}'} {'{counter}'} {'{clipboard}'} {'{csv:ColumnName}'}. Special keys: {'{Tab}'} {'{Enter}'} {'{Space}'}.</p>
      </details>
      <div className="form-actions"><Button className="button-primary" disabled={saving || duplicate || !hotkeyValid} type="submit">{saving ? "Saving…" : isExisting ? "Save Macro" : "Create Macro"}</Button>{isExisting ? <Button className="button-danger" onClick={onDelete}>Delete</Button> : null}</div>
    </form>
  </section>;
}

function TargetCanvas({ macro, target, selection, targetRef, marker, flash, recordMode, run, onTargetChange, onSelection, onRun, onPause, onStop, onClear, onRecordToggle, onCanvasPoint }) {
  const active = run.phase !== "idle";
  const boundary = macro?.boundary;
  const phase = { delaying: "Starting…", waiting: "Waiting…", typing: "Typing…", clicking: "Clicking…", moving: "Moving…", running: "Running…", paused: "Paused" }[run.phase] ?? "Ready";
  return <section className="panel target-panel macro-target-panel" aria-label="Macro target canvas">
    <div className="panel-heading target-heading"><div><h2>Target Canvas</h2><p>Visual-only playback. Pointer actions stay inside the configured canvas boundary.</p></div><span className={`run-indicator ${active ? "is-active" : ""}`}><i /> {phase}</span></div>
    <div className="target-context"><span>Selected macro</span><strong>{macro?.name || "No macro selected"}</strong>{macro ? <Hotkey value={macro.hotkey} /> : null}<label className="canvas-record-toggle"><input checked={recordMode} onChange={onRecordToggle} type="checkbox" /> Record canvas input</label></div>
    <div className="target-canvas" onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onCanvasPoint({ x: Math.round((event.clientX - rect.left) * (CANVAS_WIDTH / rect.width)), y: Math.round((event.clientY - rect.top) * (CANVAS_HEIGHT / rect.height)) }); }}>
      {boundary ? <div className="canvas-boundary" style={{ left: `${(boundary.x / CANVAS_WIDTH) * 100}%`, top: `${(boundary.y / CANVAS_HEIGHT) * 100}%`, width: `${Math.min(100, (boundary.width / CANVAS_WIDTH) * 100)}%`, height: `${Math.min(100, (boundary.height / CANVAS_HEIGHT) * 100)}%` }} /> : null}
      <textarea aria-label="Target Canvas text" className="target-textarea canvas-textarea" onChange={onTargetChange} onSelect={onSelection} placeholder="Typing actions appear here. Turn on Record canvas input to capture local typing and clicks as steps." ref={targetRef} spellCheck="false" value={target} />
      <span className={`canvas-pointer ${flash ? "is-clicking" : ""}`} style={{ left: `${Math.min(99, Math.max(0, marker.x / CANVAS_WIDTH * 100))}%`, top: `${Math.min(99, Math.max(0, marker.y / CANVAS_HEIGHT * 100))}%` }} aria-hidden="true">⌖</span>
    </div>
    <div className="simulation-controls"><div className="run-actions"><Button className="button-primary" disabled={!macro || active} onClick={() => onRun(macro)}>▶ Run Macro</Button><Button disabled={!active} onClick={onPause}>{run.phase === "paused" ? "Resume" : "Pause"}</Button><Button className="button-danger" disabled={!active} onClick={onStop}>■ Kill switch</Button><Button className="button-quiet" onClick={onClear}>Clear Canvas</Button></div><div className="progress-block"><span>{active ? `${run.actionsCompleted} actions · pass ${run.iteration}` : "Idle"}</span><div className="progress-track"><i style={{ width: `${run.total ? Math.min(100, run.progress / run.total * 100) : 0}%` }} /></div></div></div>
    <p className="target-footnote">Press <kbd>Esc</kbd> while Auto Typer is focused to trigger the kill switch. This canvas is a safe simulator; it does not control other applications.</p>
  </section>;
}

function HistoryAndAnalytics({ page, history, analytics, loading, onClear }) {
  if (page === "analytics") return <section className="panel history-panel analytics-panel"><div className="panel-heading"><div><h2>Macro Insights</h2><p>Local execution outcomes and time saved.</p></div></div>{loading ? <div className="empty-state">Loading insights…</div> : <><div className="analytics-grid"><div><span>Total runs</span><strong>{analytics.summary?.totalRuns ?? 0}</strong></div><div><span>Success rate</span><strong>{Math.round((analytics.summary?.successRate ?? 0) * 100)}%</strong></div><div><span>Time saved</span><strong>{formatDuration(analytics.summary?.timeSavedMs ?? 0)}</strong></div><div><span>Failures</span><strong>{analytics.summary?.failedRuns ?? 0}</strong></div></div><div className="table-scroll"><table className="utility-table"><thead><tr><th>Most-used macro</th><th>Runs</th><th>Success</th><th>Time saved</th></tr></thead><tbody>{(analytics.mostUsedMacros ?? []).map((entry) => <tr key={entry.macroId ?? entry.macroName}><td>{entry.macroName}</td><td>{entry.runs}</td><td>{Math.round(entry.successRate * 100)}%</td><td>{formatDuration(entry.timeSavedMs)}</td></tr>)}</tbody></table></div></>}</section>;
  return <section className="panel history-panel"><div className="panel-heading"><div><h2>Run History</h2><p>Completed, stopped, rate-limited, and failed macro executions.</p></div><Button className="button-quiet" disabled={!history.length} onClick={onClear}>Clear History</Button></div>{loading ? <div className="empty-state">Loading history…</div> : !history.length ? <div className="empty-state">No macro executions recorded yet.</div> : <div className="table-scroll"><table className="utility-table"><thead><tr><th>Macro</th><th>Hotkey</th><th>Started</th><th>Duration</th><th>Steps</th><th>Result</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.id}><td>{entry.macroName}</td><td><Hotkey value={entry.hotkey} /></td><td>{formatTimestamp(entry.startedAt)}</td><td>{formatDuration(entry.durationMs)}</td><td>{entry.stepsCompleted}</td><td><StatusPill status={entry.status} /></td></tr>)}</tbody></table></div>}</section>;
}

function SchedulePanel({ macros, schedules, onCreate, onDelete }) {
  const [draft, setDraft] = useState({ macroId: "", type: "once", runAt: "", intervalMs: 3_600_000 });
  useEffect(() => { if (!draft.macroId && macros[0]) setDraft((current) => ({ ...current, macroId: macros[0].id })); }, [draft.macroId, macros]);
  const submit = (event) => { event.preventDefault(); if (draft.macroId) onCreate({ ...draft, enabled: true, runAt: draft.type === "once" ? new Date(draft.runAt).toISOString() : undefined, startsAt: draft.type === "interval" ? new Date().toISOString() : undefined }); };
  return <section className="panel schedule-panel"><div className="panel-heading"><div><h2>Schedules</h2><p>Schedules run while the local app is open. Desktop background scheduling comes next.</p></div></div><form className="schedule-form" onSubmit={submit}><Field label="Macro"><select onChange={(event) => setDraft({ ...draft, macroId: event.target.value })} value={draft.macroId}>{macros.map((macro) => <option key={macro.id} value={macro.id}>{macro.name}</option>)}</select></Field><Field label="Schedule"><select onChange={(event) => setDraft({ ...draft, type: event.target.value })} value={draft.type}><option value="once">Run once</option><option value="interval">Recurring interval</option></select></Field>{draft.type === "once" ? <Field label="Run at"><input min={new Date().toISOString().slice(0, 16)} onChange={(event) => setDraft({ ...draft, runAt: event.target.value })} required type="datetime-local" value={draft.runAt} /></Field> : <Field label="Every" hint="minutes"><input min="1" onChange={(event) => setDraft({ ...draft, intervalMs: Number(event.target.value) * 60_000 })} required type="number" value={Math.max(1, Math.round(draft.intervalMs / 60_000))} /></Field>}<Button className="button-primary" disabled={!draft.macroId}>Add Schedule</Button></form><div className="table-scroll"><table className="utility-table"><thead><tr><th>Macro</th><th>Type</th><th>Next run</th><th>State</th><th /></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td>{macros.find((macro) => macro.id === schedule.macroId)?.name || "Deleted macro"}</td><td>{schedule.type === "once" ? "Once" : `Every ${Math.round(schedule.intervalMs / 60_000)} min`}</td><td>{formatTimestamp(schedule.nextRunAt)}</td><td>{schedule.enabled ? "Enabled" : "Disabled"}</td><td><Button className="button-danger" onClick={() => onDelete(schedule.id)}>Delete</Button></td></tr>)}</tbody></table></div></section>;
}

export default function MacroApp() {
  const [macros, setMacros] = useState([]);
  const [history, setHistory] = useState([]);
  const [analytics, setAnalytics] = useState({ summary: {}, mostUsedMacros: [] });
  const [schedules, setSchedules] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [page, setPage] = useState("library");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hotkeyRecording, setHotkeyRecording] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [target, setTarget] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [marker, setMarker] = useState({ x: 48, y: 48 });
  const [flash, setFlash] = useState(false);
  const [recordMode, setRecordMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("autotyper-theme") || "light");
  const targetRef = useRef(null);
  const targetModelRef = useRef({ text: "", selectionStart: 0, selectionEnd: 0 });
  const selectedIdRef = useRef(null);
  const macroDraft = useUndoableDraft(EMPTY_MACRO);
  const draft = macroDraft.value;
  // The hook returns a fresh view object per render, but its operations are
  // stable callbacks. Depend on those callbacks so loading macros cannot
  // retrigger indefinitely after a draft state update.
  const replaceDraft = macroDraft.replace;
  const updateDraft = macroDraft.update;

  const showToast = useCallback((message, tone = "info") => setToast({ id: Date.now(), message, tone }), []);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(null), 4600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("autotyper-theme", theme); }, [theme]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const writeTarget = useCallback((next) => {
    const normalized = { text: String(next.text ?? ""), selectionStart: Math.max(0, Number(next.selectionStart ?? 0)), selectionEnd: Math.max(0, Number(next.selectionEnd ?? next.selectionStart ?? 0)) };
    targetModelRef.current = normalized;
    setTarget(normalized.text);
    setSelection({ start: normalized.selectionStart, end: normalized.selectionEnd });
    window.requestAnimationFrame(() => {
      if (targetRef.current) targetRef.current.setSelectionRange(normalized.selectionStart, normalized.selectionEnd);
    });
  }, []);

  const loadMacros = useCallback(async (selectFallback = false) => {
    const payload = await api.getMacros();
    const loaded = collection(payload, "macros").map(normalizeMacro);
    setMacros(loaded);
    const current = loaded.find((macro) => macro.id === selectedIdRef.current);
    if (!current && (selectFallback || !selectedIdRef.current) && loaded[0]) {
      setSelectedId(loaded[0].id);
      replaceDraft(loaded[0]);
    }
    return loaded;
  }, [replaceDraft]);
  const loadHistory = useCallback(async () => { const [historyPayload, analyticsPayload, schedulesPayload] = await Promise.all([api.getMacroHistory(), api.getMacroAnalytics(), api.getMacroSchedules()]); setHistory(collection(historyPayload, "history")); setAnalytics(analyticsPayload ?? { summary: {}, mostUsedMacros: [] }); setSchedules(collection(schedulesPayload, "schedules")); }, []);
  useEffect(() => { let live = true; Promise.all([loadMacros(true), loadHistory()]).catch((error) => live && showToast(error.message || "Could not load macros.", "error")).finally(() => { if (live) { setLoading(false); setHistoryLoading(false); } }); return () => { live = false; }; }, [loadHistory, loadMacros, showToast]);

  const selectedMacro = useMemo(() => macros.find((macro) => macro.id === selectedId) ?? null, [macros, selectedId]);
  const folders = useMemo(() => [...new Set(macros.map((macro) => macro.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [macros]);
  const shownMacros = useMemo(() => { const needle = search.trim().toLocaleLowerCase(); return macros.filter((macro) => (!needle || `${macro.name} ${macro.hotkey} ${macro.folder} ${macro.tags.join(" ")}`.toLocaleLowerCase().includes(needle)) && (!folderFilter || macro.folder === folderFilter)); }, [folderFilter, macros, search]);

  const recordRun = useCallback(async ({ macro, status, startedAt, durationMs, stepsCompleted, errorMessage, context }) => {
    try {
      await api.createMacroHistory({ macroId: macro.id, startedAt: new Date(startedAt).toISOString(), durationMs, status, stepsCompleted, timeSavedMs: status === "completed" ? Math.max(0, stepsCompleted * 600 - durationMs) : 0, errorMessage });
      if (status === "completed" && macro.mailMerge?.rows?.length) {
        const csvSelection = selectCsvRow(macro.mailMerge, macro.mailMerge.cursor);
        if (!csvSelection.exhausted) {
          const nextMacro = normalizeMacro({ ...macro, mailMerge: { ...macro.mailMerge, cursor: csvSelection.nextCursor } });
        const saved = await api.updateMacro(macro.id, nextMacro);
        setMacros((current) => current.map((entry) => entry.id === macro.id ? normalizeMacro(saved.macro) : entry));
        if (selectedIdRef.current === macro.id) replaceDraft(normalizeMacro(saved.macro));
        }
      }
      await loadHistory();
      if (status !== "completed") showToast(status === "stopped" ? "Macro stopped by kill switch." : errorMessage || "Macro did not complete.", status === "stopped" ? "info" : "error");
    } catch (error) { showToast(`Run finished but history was not saved: ${error.message}`, "error"); }
  }, [loadHistory, replaceDraft, showToast]);

  const onSimulationAction = useCallback((action) => {
    if (action.type === "target") {
      writeTarget(applyTargetUnit(targetModelRef.current, action.unit));
    } else if (action.type === "move" || action.type === "click") {
      setMarker(action.point);
      if (action.type === "click") { setFlash(true); window.setTimeout(() => setFlash(false), 170); }
    }
  }, [writeTarget]);
  const simulation = useMacroSimulation({ onAction: onSimulationAction, onFinished: recordRun });

  const runMacro = useCallback(async (macro) => {
    if (!macro || simulation.run.phase !== "idle") return;
    let clipboard = "";
    try { clipboard = await navigator.clipboard?.readText?.() ?? ""; } catch { /* Clipboard is optional in browser mode. */ }
    const csvSelection = selectCsvRow(macro.mailMerge, macro.mailMerge?.cursor ?? 0);
    if (macro.mailMerge?.rows?.length && csvSelection.exhausted) {
      showToast("All mail-merge rows have been used. Upload the CSV again to restart it.", "info");
      return;
    }
    const row = csvSelection.row ?? {};
    const counter = history.filter((entry) => entry.macroId === macro.id).length + 1;
    try {
      const plan = buildMacroActionPlan(macro, { now: new Date(), clipboard, csvRow: row, counter, existingMacros: macros });
      const actions = plan.actions.map((action) => {
        if (action.kind === "text" || action.kind === "key") return { type: "target", unit: { kind: action.kind, value: action.value }, charactersPerSecond: action.charactersPerSecond };
        if (action.kind === "wait") return { type: "wait", durationMs: action.durationMs };
        if (action.kind === "move") return { type: "move", point: { x: action.x, y: action.y }, step: { durationMs: action.durationMs } };
        return { type: "click", point: { x: action.x, y: action.y }, step: { clickType: action.clickType, intervalMs: action.intervalMs, button: action.button } };
      });
      simulation.start(macro, { now: new Date(), clipboard, row, counter }, actions);
    } catch (error) {
      showToast(error.errors?.[0]?.message || error.message || "This macro cannot be run.", "error");
    }
  }, [history, macros, showToast, simulation]);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === "Escape" && simulation.run.phase !== "idle") { event.preventDefault(); simulation.stop(); return; }
      if (hotkeyRecording) return;
      const hotkey = hotkeyFromKeyboardEvent(event);
      if (!hotkey) return;
      const macro = macros.find((entry) => canonicalizeHotkey(entry.hotkey) === hotkey);
      if (macro) { event.preventDefault(); runMacro(macro); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [hotkeyRecording, macros, runMacro, simulation]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      if (simulation.run.phase !== "idle") return;
      const now = Date.now();
      const due = schedules.find((schedule) => schedule.enabled && schedule.nextRunAt && new Date(schedule.nextRunAt).getTime() <= now);
      const macro = due && macros.find((entry) => entry.id === due.macroId);
      if (!due || !macro) return;
      try {
        await runMacro(macro);
        const payload = await api.triggerMacroSchedule(due.id, { triggeredAt: new Date().toISOString() });
        setSchedules((current) => current.map((entry) => entry.id === due.id ? payload.schedule : entry));
      } catch (error) { showToast(`Scheduled run failed: ${error.message}`, "error"); }
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [macros, runMacro, schedules, showToast, simulation.run.phase]);

  const chooseMacro = useCallback((macro) => { setSelectedId(macro.id); replaceDraft(normalizeMacro(macro)); setSelectedStepId(null); setHotkeyRecording(false); setPage("library"); }, [replaceDraft]);
  const startNew = useCallback(() => { setSelectedId(null); replaceDraft(normalizeMacro(EMPTY_MACRO)); setSelectedStepId(null); setHotkeyRecording(false); setPage("library"); }, [replaceDraft]);
  const captureHotkey = useCallback((eventOrStart) => { if (eventOrStart === "start") { setHotkeyRecording(true); return; } const event = eventOrStart; event.preventDefault(); event.stopPropagation(); const hotkey = hotkeyFromKeyboardEvent(event); if (!hotkey) return; updateDraft((current) => ({ ...current, hotkey })); setHotkeyRecording(false); }, [updateDraft]);
  const saveMacro = useCallback(async (event) => { event.preventDefault(); const verdict = validateMacroDefinition(draft, { existingMacros: macros, excludeId: draft.id }); if (!verdict.valid) { showToast(verdict.errors[0]?.message || "Check the macro details.", "error"); return; } const normalized = normalizeMacro(verdict.value); setSaving(true); try { const response = normalized.id ? await api.updateMacro(normalized.id, normalized) : await api.createMacro(normalized); const saved = normalizeMacro(response.macro); setMacros((current) => { const exists = current.some((macro) => macro.id === saved.id); return exists ? current.map((macro) => macro.id === saved.id ? saved : macro) : [saved, ...current]; }); setSelectedId(saved.id); replaceDraft(saved); showToast(normalized.id ? "Macro saved." : "Macro created.", "success"); } catch (error) { showToast(error.message || "Could not save macro.", "error"); } finally { setSaving(false); } }, [draft, macros, replaceDraft, showToast]);
  const deleteMacro = useCallback(async () => { if (!draft.id || !window.confirm(`Delete “${draft.name}”?`)) return; try { await api.deleteMacro(draft.id); const remaining = macros.filter((macro) => macro.id !== draft.id); setMacros(remaining); if (remaining[0]) chooseMacro(remaining[0]); else startNew(); showToast("Macro deleted.", "success"); } catch (error) { showToast(error.message || "Could not delete macro.", "error"); } }, [chooseMacro, draft, macros, showToast, startNew]);
  const csvUpload = useCallback(async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { const parsed = parseMacroCsv(await file.text(), { sourceName: file.name }); if (!parsed.headers.length || !parsed.rows.length) throw new Error("The CSV needs a header row and at least one data row."); updateDraft((current) => ({ ...current, mailMerge: parsed })); showToast(`Loaded ${parsed.rows.length} mail-merge rows.`, "success"); } catch (error) { showToast(error.message || "Could not read CSV.", "error"); } }, [showToast, updateDraft]);
  const canvasPoint = useCallback((point) => { const safe = clampPoint(point, draft.boundary); setMarker(safe); if (selectedStepId) updateDraft((current) => ({ ...current, steps: updateStepTree(current.steps, selectedStepId, (step) => (step.type === "click" || step.type === "move") ? { ...step, ...safe } : step) })); if (recordMode) updateDraft((current) => ({ ...current, steps: [...current.steps, normalizeStep({ type: "click", ...safe })] })); }, [draft.boundary, recordMode, selectedStepId, updateDraft]);
  const recordCanvasKey = useCallback((event) => { if (!recordMode || event.ctrlKey || event.altKey || event.metaKey) return; const special = { Enter: "{Enter}", Tab: "{Tab}", " ": "{Space}", Backspace: "{Backspace}" }[event.key]; if (special || event.key.length === 1) updateDraft((current) => ({ ...current, steps: [...current.steps, normalizeStep({ type: "typeText", text: special ?? event.key })] })); }, [recordMode, updateDraft]);
  const createSchedule = useCallback(async (schedule) => { try { const response = await api.createMacroSchedule(schedule); setSchedules((current) => [...current, response.schedule]); showToast("Schedule added. Keep Auto Typer open for local runs.", "success"); } catch (error) { showToast(error.message || "Could not create schedule.", "error"); } }, [showToast]);
  const deleteSchedule = useCallback(async (id) => { try { await api.deleteMacroSchedule(id); setSchedules((current) => current.filter((schedule) => schedule.id !== id)); } catch (error) { showToast(error.message || "Could not delete schedule.", "error"); } }, [showToast]);
  const clearHistory = useCallback(async () => { if (!history.length || !window.confirm("Clear all macro history?")) return; try { await api.clearMacroHistory(); setHistory([]); setAnalytics({ summary: {}, mostUsedMacros: [] }); showToast("Macro history cleared.", "success"); } catch (error) { showToast(error.message || "Could not clear history.", "error"); } }, [history.length, showToast]);
  const exportMacros = useCallback(async () => { try { const exported = await api.getMacroExport(); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" })); link.download = `autotyper-macros-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); showToast("Macro library exported.", "success"); } catch (error) { showToast(error.message || "Could not export macros.", "error"); } }, [showToast]);
  const importMacros = useCallback(async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { const parsed = JSON.parse(await file.text()); const imported = Array.isArray(parsed) ? parsed : parsed.macros; if (!Array.isArray(imported)) throw new Error("This file does not contain a macros array."); const mode = window.confirm("Replace your current macro library? Choose Cancel to merge instead.") ? "replace" : "merge"; const result = await api.importMacros(imported, mode); await loadMacros(true); showToast(`${result.imported} macro(s) imported.`, "success"); } catch (error) { showToast(error.message || "Could not import macros.", "error"); } }, [loadMacros, showToast]);

  return <div className="app-shell macro-app-shell" onKeyDown={recordCanvasKey}>
    <header className="titlebar"><div className="app-mark">M</div><div className="titlebar-copy"><strong>Auto Typer</strong><span>Macro Automation Studio</span></div><div className="titlebar-spacer" /><button aria-label="Toggle color theme" className="window-button" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button></header>
    <nav className="menubar" aria-label="Application views"><button className={page === "library" ? "is-current" : ""} onClick={() => setPage("library")}>Macro Library</button><button className={page === "history" ? "is-current" : ""} onClick={() => setPage("history")}>Run History</button><button className={page === "analytics" ? "is-current" : ""} onClick={() => setPage("analytics")}>Insights</button><button className={page === "schedules" ? "is-current" : ""} onClick={() => setPage("schedules")}>Schedules</button><span className="menubar-fill" /><span className="app-wide-note">Kill switch: Esc</span></nav>
    <div className="commandbar"><Button className="button-primary" onClick={startNew}>+ New Macro</Button><Button disabled={!draft.id} onClick={() => draft.id && chooseMacro(draft)}>Edit</Button><Button className="button-danger" disabled={!draft.id} onClick={deleteMacro}>Delete</Button><span className="command-divider" /><Button onClick={exportMacros}>Export JSON</Button><Button onClick={() => document.getElementById("macro-import-file")?.click()}>Import JSON</Button><input accept="application/json,.json" className="visually-hidden" id="macro-import-file" onChange={importMacros} type="file" /></div>
    <main className="main-area">{page === "library" ? <div className="macro-workspace-grid"><section className="panel library-panel macro-library-panel"><div className="panel-heading library-heading"><div><h2>Macro Library</h2><p>{macros.length} saved macro{macros.length === 1 ? "" : "s"}</p></div><div className="library-filters"><input aria-label="Search macros" className="search-input" onChange={(event) => setSearch(event.target.value)} placeholder="Search name, hotkey, tags" value={search} /><select aria-label="Filter folder" onChange={(event) => setFolderFilter(event.target.value)} value={folderFilter}><option value="">All folders</option>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></div></div><MacroTable loading={loading} macros={shownMacros} onRun={runMacro} onSelect={chooseMacro} selectedId={selectedId} /><div className="panel-footer"><span>Select a macro to edit its ordered actions.</span><span>{shownMacros.length} shown</span></div></section><MacroEditor draft={draft} existingMacros={macros} onCaptureHotkey={captureHotkey} onChange={macroDraft.commit} onCsvUpload={csvUpload} onDelete={deleteMacro} onNew={startNew} onSave={saveMacro} onSelectedStep={setSelectedStepId} recordingHotkey={hotkeyRecording} saving={saving} selectedStepId={selectedStepId} undoable={macroDraft} /><TargetCanvas flash={flash} macro={selectedMacro} marker={marker} onCanvasPoint={canvasPoint} onClear={() => writeTarget({ text: "", selectionStart: 0, selectionEnd: 0 })} onPause={simulation.togglePause} onRecordToggle={(event) => setRecordMode(event.target.checked)} onRun={runMacro} onSelection={(event) => { targetModelRef.current = { text: event.target.value, selectionStart: event.target.selectionStart, selectionEnd: event.target.selectionEnd }; setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd }); }} onStop={simulation.stop} onTargetChange={(event) => writeTarget({ text: event.target.value, selectionStart: event.target.selectionStart, selectionEnd: event.target.selectionEnd })} recordMode={recordMode} run={simulation.run} selection={selection} target={target} targetRef={targetRef} /></div> : page === "schedules" ? <SchedulePanel macros={macros} onCreate={createSchedule} onDelete={deleteSchedule} schedules={schedules} /> : <HistoryAndAnalytics analytics={analytics} history={history} loading={historyLoading} onClear={clearHistory} page={page} />}</main>
    <footer className="statusbar"><span className={`status-led ${simulation.run.phase !== "idle" ? "is-busy" : ""}`} /><span>{simulation.run.phase === "idle" ? "Ready" : `${simulation.run.macro?.name || "Macro"} — ${simulation.run.phase}`}</span><span className="statusbar-fill" /><span>Tokens: {'{Tab}'} {'{Enter}'} {'{Space}'} · Variables: {'{date}'} {'{clipboard}'}</span></footer>
    {toast ? <div className={`toast toast-${toast.tone}`} role="status">{toast.message}</div> : null}
  </div>;
}
