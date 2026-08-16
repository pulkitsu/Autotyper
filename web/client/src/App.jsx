import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { formatDuration, formatTimestamp, shortText } from "./format.js";
import {
  applyTargetUnit,
  canonicalizeHotkey,
  countTypingUnits,
  hotkeyFromKeyboardEvent,
  parseScript,
  validateHotkey,
} from "./lib/index.js";

const EMPTY_SCRIPT = Object.freeze({
  id: null,
  name: "",
  body: "",
  hotkey: "",
  charactersPerSecond: 18,
  startDelayMs: 500,
});

const IDLE_RUN = Object.freeze({
  phase: "idle",
  script: null,
  progress: 0,
  total: 0,
});

function asCollection(payload, key) {
  return Array.isArray(payload) ? payload : payload?.[key] ?? [];
}

function normalizeScript(script = {}) {
  return {
    ...EMPTY_SCRIPT,
    ...script,
    charactersPerSecond: Number(script.charactersPerSecond ?? EMPTY_SCRIPT.charactersPerSecond),
    startDelayMs: Number(script.startDelayMs ?? EMPTY_SCRIPT.startDelayMs),
    hotkey: canonicalizeHotkey(script.hotkey ?? ""),
  };
}

function validationFor(hotkey) {
  const result = validateHotkey(hotkey);
  if (typeof result === "boolean") {
    return { valid: result, message: result ? "" : "Choose a valid shortcut." };
  }
  return { ...result, message: result.message ?? result.error ?? "" };
}

function typingSteps(script) {
  return parseScript(script.body ?? "");
}

function useTypingSimulation({ applyUnit, onFinished }) {
  const [run, setRun] = useState(IDLE_RUN);
  const runnerRef = useRef(null);
  const timerRef = useRef(null);

  const publish = useCallback((runner) => {
    setRun({
      phase: runner.phase,
      script: runner.script,
      progress: runner.progress,
      total: runner.total,
      delayMs: runner.delayMs,
    });
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finish = useCallback(
    (status) => {
      const runner = runnerRef.current;
      if (!runner || runner.finished) return;
      clearTimer();
      runner.finished = true;
      runnerRef.current = null;
      setRun(IDLE_RUN);
      onFinished({
        script: runner.script,
        status,
        startedAt: runner.startedAt,
        durationMs: Math.max(0, Date.now() - runner.startedAt),
      });
    },
    [clearTimer, onFinished],
  );

  const schedule = useCallback(
    (runner, delay, callback) => {
      runner.pending = callback;
      runner.dueAt = Date.now() + Math.max(0, delay);
      runner.delayMs = Math.max(0, delay);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (runnerRef.current !== runner || runner.finished || runner.paused) return;
        runner.pending = null;
        callback();
      }, Math.max(0, delay));
    },
    [clearTimer],
  );

  const processNext = useCallback(
    (runner) => {
      if (runnerRef.current !== runner || runner.finished || runner.paused) return;
      if (runner.index >= runner.steps.length) {
        finish("completed");
        return;
      }

      const step = runner.steps[runner.index];
      runner.index += 1;

      if (step.kind === "wait") {
        runner.phase = "waiting";
        publish(runner);
        schedule(runner, step.durationMs ?? 0, () => {
          runner.phase = "typing";
          publish(runner);
          processNext(runner);
        });
        return;
      }

      applyUnit(step);
      runner.progress += step.kind === "text" ? Array.from(step.value ?? "").length || 1 : 1;
      runner.phase = "typing";
      publish(runner);

      const characterDelay = Math.max(12, Math.round(1000 / Math.max(1, runner.script.charactersPerSecond)));
      schedule(runner, characterDelay, () => processNext(runner));
    },
    [applyUnit, finish, publish, schedule],
  );

  const start = useCallback(
    (script) => {
      if (!script) return;
      if (runnerRef.current) finish("stopped");
      const steps = typingSteps(script);
      const runner = {
        script,
        steps,
        index: 0,
        progress: 0,
        total: countTypingUnits(steps),
        phase: Number(script.startDelayMs) > 0 ? "delaying" : "typing",
        startedAt: Date.now(),
        paused: false,
        finished: false,
      };
      runnerRef.current = runner;
      publish(runner);

      const delay = Math.max(0, Number(script.startDelayMs) || 0);
      if (delay > 0) {
        schedule(runner, delay, () => {
          runner.phase = "typing";
          publish(runner);
          processNext(runner);
        });
      } else {
        processNext(runner);
      }
    },
    [finish, processNext, publish, schedule],
  );

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
    runner.phase = runner.resumePhase ?? "typing";
    publish(runner);
    const pending = runner.pending ?? (() => processNext(runner));
    schedule(runner, runner.remainingMs ?? 0, pending);
  }, [clearTimer, processNext, publish, schedule]);

  const stop = useCallback(() => finish("stopped"), [finish]);

  useEffect(
    () => () => {
      clearTimer();
      const runner = runnerRef.current;
      if (runner) runner.finished = true;
      runnerRef.current = null;
    },
    [clearTimer],
  );

  return { run, start, togglePause, stop };
}

function Button({ className = "", children, ...props }) {
  return (
    <button className={`button ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

function Hotkey({ value }) {
  return <kbd className="hotkey">{value || "Not assigned"}</kbd>;
}

function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>;
}

function ScriptTable({ scripts, selectedId, onSelect, onRun, loading }) {
  if (loading) return <EmptyState>Loading scripts…</EmptyState>;
  if (!scripts.length) return <EmptyState>No matching scripts.</EmptyState>;

  return (
    <div className="table-scroll library-table-wrap">
      <table className="utility-table library-table">
        <thead>
          <tr>
            <th className="number-column">#</th>
            <th>Shortcut Key</th>
            <th>Comment</th>
            <th>Text</th>
            <th className="action-column">Run</th>
          </tr>
        </thead>
        <tbody>
          {scripts.map((script, index) => (
            <tr
              className={script.id === selectedId ? "is-selected" : ""}
              key={script.id}
              onClick={() => onSelect(script)}
            >
              <td>{index + 1}</td>
              <td><Hotkey value={script.hotkey} /></td>
              <td className="cell-ellipsis" title={script.name}>{script.name}</td>
              <td className="cell-ellipsis script-preview" title={script.body}>{shortText(script.body)}</td>
              <td>
                <button
                  aria-label={`Run ${script.name}`}
                  className="row-run"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRun(script);
                  }}
                  type="button"
                >
                  ▶
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Editor({
  draft,
  conflict,
  onChange,
  onSave,
  onDelete,
  onNew,
  onInsertToken,
  onHotkeyKeyDown,
  recording,
  setRecording,
  saving,
  bodyRef,
}) {
  const hotkeyValidity = validationFor(draft.hotkey);
  const isExisting = Boolean(draft.id);

  return (
    <section className="panel editor-panel" aria-label="Script editor">
      <div className="panel-heading">
        <div>
          <h2>{isExisting ? "Edit Record" : "Add Record"}</h2>
          <p>{isExisting ? "Update the selected auto text." : "Create a reusable typing script."}</p>
        </div>
        <Button className="button-quiet" onClick={onNew}>+ New</Button>
      </div>

      <form className="editor-form" onSubmit={onSave}>
        <Field label="Comments" hint="Script name">
          <input
            maxLength="120"
            onChange={(event) => onChange("name", event.target.value)}
            placeholder="e.g. Email signature"
            required
            value={draft.name}
          />
        </Field>

        <Field label="Shortcut Key" hint="App-wide while Auto Typer is focused">
          <div className="hotkey-input-group">
            <input
              className={conflict || (draft.hotkey && !hotkeyValidity.valid) ? "input-warning" : ""}
              onFocus={() => setRecording(true)}
              onKeyDown={onHotkeyKeyDown}
              placeholder="Click and press Ctrl + Alt + 1"
              readOnly
              value={draft.hotkey}
            />
            <Button className={recording ? "button-recording" : ""} onClick={() => setRecording(true)}>
              {recording ? "Press keys…" : "Record"}
            </Button>
            <Button className="button-quiet" onClick={() => onChange("hotkey", "")}>Clear</Button>
          </div>
          {conflict ? <p className="field-warning">Already assigned to “{conflict.name}”.</p> : null}
          {!conflict && draft.hotkey && !hotkeyValidity.valid ? <p className="field-warning">{hotkeyValidity.message}</p> : null}
          {recording ? <p className="field-help">Press a shortcut now. Use Ctrl or Alt plus another key.</p> : null}
        </Field>

        <Field label="Text" hint="Special key tokens are simulated, not inserted literally" className="text-field">
          <textarea
            onChange={(event) => onChange("body", event.target.value)}
            placeholder="Kind regards,{Enter}Avery"
            ref={bodyRef}
            rows="8"
            value={draft.body}
          />
          <div className="token-bar" aria-label="Insert special key token">
            <span>Special keys:</span>
            {["{Tab}", "{Enter}", "{Space}", "{Backspace}", "{Wait 500}"].map((token) => (
              <button key={token} onClick={() => onInsertToken(token)} type="button">{token}</button>
            ))}
          </div>
        </Field>

        <div className="settings-row">
          <Field label="Typing speed" hint="characters per second">
            <div className="number-input">
              <input
                max="120"
                min="1"
                onChange={(event) => onChange("charactersPerSecond", event.target.value)}
                type="number"
                value={draft.charactersPerSecond}
              />
              <span>cps</span>
            </div>
          </Field>
          <Field label="Initial delay" hint="before starting">
            <div className="number-input">
              <input
                max="60000"
                min="0"
                onChange={(event) => onChange("startDelayMs", event.target.value)}
                step="100"
                type="number"
                value={draft.startDelayMs}
              />
              <span>ms</span>
            </div>
          </Field>
        </div>

        <div className="form-actions">
          <Button className="button-primary" disabled={saving} type="submit">
            {saving ? "Saving…" : isExisting ? "Save Changes" : "Save Script"}
          </Button>
          {isExisting ? <Button className="button-danger" onClick={onDelete}>Delete</Button> : null}
        </div>
      </form>
    </section>
  );
}

function TargetWindow({ run, selectedScript, target, selection, onTargetChange, onSelect, targetRef, onRun, onTogglePause, onStop, onClear }) {
  const isRunning = run.phase !== "idle";
  const phaseLabel = {
    delaying: "Starting…",
    typing: "Typing…",
    waiting: "Waiting…",
    paused: "Paused",
  }[run.phase] ?? "Ready";

  return (
    <section className="panel target-panel" aria-label="Typing simulator">
      <div className="panel-heading target-heading">
        <div>
          <h2>Target Window</h2>
          <p>Active application simulator — focus anywhere in this app, then use a script hotkey.</p>
        </div>
        <span className={`run-indicator ${isRunning ? "is-active" : ""}`}>
          <i /> {phaseLabel}
        </span>
      </div>

      <div className="target-context">
        <span>Selected script</span>
        <strong>{selectedScript?.name || "No script selected"}</strong>
        {selectedScript ? <Hotkey value={selectedScript.hotkey} /> : null}
      </div>
      <textarea
        aria-label="Target Window"
        className="target-textarea"
        onChange={onTargetChange}
        onSelect={onSelect}
        placeholder="Text will be typed here one character at a time…"
        ref={targetRef}
        spellCheck="false"
        value={target}
      />
      <div className="simulation-controls">
        <div className="run-actions">
          <Button className="button-primary" disabled={!selectedScript || isRunning} onClick={() => onRun(selectedScript)}>
            ▶ Simulate Typing
          </Button>
          <Button disabled={!isRunning} onClick={onTogglePause}>
            {run.phase === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button className="button-danger" disabled={!isRunning} onClick={onStop}>Stop</Button>
          <Button className="button-quiet" onClick={onClear}>Clear Target</Button>
        </div>
        <div className="progress-block" aria-live="polite">
          <span>{isRunning && run.total ? `${run.progress} / ${run.total} actions` : "Idle"}</span>
          <div className="progress-track"><i style={{ width: `${run.total ? (run.progress / run.total) * 100 : 0}%` }} /></div>
        </div>
      </div>
      <p className="target-footnote">Hotkeys work throughout Auto Typer, not across other operating-system apps. {selection.start !== selection.end ? "Typing replaces the selected target text." : ""}</p>
    </section>
  );
}

function HistoryTable({ history, onClear, loading }) {
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <h2>Run History</h2>
          <p>Completed and stopped simulations are recorded here.</p>
        </div>
        <Button className="button-quiet" disabled={!history.length} onClick={onClear}>Clear History</Button>
      </div>
      {loading ? <EmptyState>Loading history…</EmptyState> : !history.length ? <EmptyState>No script executions recorded yet.</EmptyState> : (
        <div className="table-scroll">
          <table className="utility-table">
            <thead>
              <tr><th>Script</th><th>Shortcut Key</th><th>Started</th><th>Duration</th><th>Result</th></tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.scriptName}</td>
                  <td><Hotkey value={entry.hotkey} /></td>
                  <td>{formatTimestamp(entry.startedAt)}</td>
                  <td>{formatDuration(entry.durationMs)}</td>
                  <td><span className={`status-chip ${entry.status === "completed" ? "is-complete" : "is-stopped"}`}>{entry.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [scripts, setScripts] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_SCRIPT);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState("library");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("autotyper-theme") || "light");
  const [target, setTarget] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const targetRef = useRef(null);
  const targetModelRef = useRef({ text: "", selectionStart: 0, selectionEnd: 0 });
  const bodyRef = useRef(null);
  const importRef = useRef(null);
  const selectedIdRef = useRef(null);

  const showToast = useCallback((message, tone = "info") => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("autotyper-theme", theme);
  }, [theme]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const chooseScript = useCallback((script) => {
    setSelectedId(script.id);
    setDraft(normalizeScript(script));
    setRecording(false);
    setPage("library");
  }, []);

  const loadScripts = useCallback(async (selectFallback = false) => {
    const payload = await api.getScripts();
    const loaded = asCollection(payload, "scripts").map(normalizeScript);
    setScripts(loaded);
    const current = loaded.find((script) => script.id === selectedIdRef.current);
    if (!current && (selectFallback || !selectedIdRef.current) && loaded[0]) chooseScript(loaded[0]);
    return loaded;
  }, [chooseScript]);

  const loadHistory = useCallback(async () => {
    const payload = await api.getHistory();
    setHistory(asCollection(payload, "history"));
  }, []);

  useEffect(() => {
    let subscribed = true;
    Promise.all([loadScripts(true), loadHistory()])
      .catch((error) => subscribed && showToast(error.message || "Could not load the library.", "error"))
      .finally(() => {
        if (subscribed) {
          setLoading(false);
          setHistoryLoading(false);
        }
      });
    return () => { subscribed = false; };
  }, [loadHistory, loadScripts, showToast]);

  const writeTarget = useCallback((next) => {
    const normalized = {
      text: next.text ?? "",
      selectionStart: Number(next.selectionStart ?? 0),
      selectionEnd: Number(next.selectionEnd ?? next.selectionStart ?? 0),
    };
    targetModelRef.current = normalized;
    setTarget(normalized.text);
    setSelection({ start: normalized.selectionStart, end: normalized.selectionEnd });
    window.requestAnimationFrame(() => {
      const element = targetRef.current;
      if (element) element.setSelectionRange(normalized.selectionStart, normalized.selectionEnd);
    });
  }, []);

  const applyUnit = useCallback((unit) => {
    writeTarget(applyTargetUnit(targetModelRef.current, unit));
  }, [writeTarget]);

  const recordRun = useCallback(async ({ script, status, startedAt, durationMs }) => {
    if (!script?.id) return;
    try {
      const payload = await api.createHistory({
        scriptId: script.id,
        scriptName: script.name,
        hotkey: script.hotkey,
        startedAt: new Date(startedAt).toISOString(),
        durationMs,
        status,
      });
      const entry = payload?.entry ?? payload;
      if (entry?.id) setHistory((current) => [entry, ...current]);
    } catch (error) {
      showToast(`Simulation finished, but the history entry was not saved: ${error.message}`, "error");
    }
  }, [showToast]);

  const simulation = useTypingSimulation({ applyUnit, onFinished: recordRun });

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedId) ?? (draft.id ? draft : null),
    [draft, scripts, selectedId],
  );

  const filteredScripts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return scripts;
    return scripts.filter((script) => `${script.name} ${script.hotkey}`.toLocaleLowerCase().includes(needle));
  }, [scripts, search]);

  const hotkeyConflict = useMemo(() => {
    const hotkey = canonicalizeHotkey(draft.hotkey);
    if (!hotkey) return null;
    return scripts.find((script) => script.id !== draft.id && canonicalizeHotkey(script.hotkey) === hotkey) ?? null;
  }, [draft.hotkey, draft.id, scripts]);

  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({
      ...current,
      [field]: field === "hotkey" ? canonicalizeHotkey(value) : value,
    }));
  }, []);

  const startNew = useCallback(() => {
    setSelectedId(null);
    setDraft({ ...EMPTY_SCRIPT });
    setRecording(false);
    setPage("library");
  }, []);

  const saveScript = useCallback(async (event) => {
    event.preventDefault();
    const normalized = normalizeScript(draft);
    const hotkeyValidity = validationFor(normalized.hotkey);
    if (!normalized.name.trim() || !normalized.body.length) {
      showToast("A script needs both a comment and text.", "error");
      return;
    }
    if (!hotkeyValidity.valid) {
      showToast(hotkeyValidity.message || "Choose a valid shortcut.", "error");
      return;
    }
    if (hotkeyConflict) {
      showToast(`Shortcut already assigned to “${hotkeyConflict.name}”.`, "error");
      return;
    }
    setSaving(true);
    try {
      const payload = normalized.id
        ? await api.updateScript(normalized.id, normalized)
        : await api.createScript(normalized);
      const saved = normalizeScript(payload?.script ?? payload);
      setScripts((current) => {
        const other = current.filter((script) => script.id !== saved.id);
        return [...other, saved].sort((first, second) => first.name.localeCompare(second.name));
      });
      chooseScript(saved);
      showToast(`“${saved.name}” saved.`, "success");
    } catch (error) {
      showToast(error.message || "Could not save the script.", "error");
    } finally {
      setSaving(false);
    }
  }, [chooseScript, draft, hotkeyConflict, showToast]);

  const deleteScript = useCallback(async () => {
    if (!draft.id || !window.confirm(`Delete “${draft.name}”?`)) return;
    try {
      await api.deleteScript(draft.id);
      const remaining = scripts.filter((script) => script.id !== draft.id);
      setScripts(remaining);
      if (remaining[0]) chooseScript(remaining[0]);
      else startNew();
      showToast("Script deleted.", "success");
    } catch (error) {
      showToast(error.message || "Could not delete the script.", "error");
    }
  }, [chooseScript, draft.id, draft.name, scripts, showToast, startNew]);

  const runScript = useCallback((script) => {
    if (!script) return;
    if (!script.body) {
      showToast("This script does not contain any text or actions.", "error");
      return;
    }
    simulation.start(script);
  }, [showToast, simulation]);

  const insertToken = useCallback((token) => {
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? draft.body.length;
    const end = textarea?.selectionEnd ?? start;
    const nextBody = `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}`;
    updateDraft("body", nextBody);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  }, [draft.body, updateDraft]);

  const captureHotkey = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const candidate = hotkeyFromKeyboardEvent(event);
    if (!candidate) return;
    const verdict = validationFor(candidate);
    if (!verdict.valid) {
      showToast(verdict.message || "Use Ctrl or Alt together with another key.", "error");
      return;
    }
    updateDraft("hotkey", candidate);
    setRecording(false);
  }, [showToast, updateDraft]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.repeat) return;
      if (recording) {
        captureHotkey(event);
        return;
      }
      const candidate = hotkeyFromKeyboardEvent(event);
      if (!candidate) return;
      const matched = scripts.find((script) => canonicalizeHotkey(script.hotkey) === candidate);
      if (!matched) return;
      event.preventDefault();
      runScript(matched);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [captureHotkey, recording, runScript, scripts]);

  const updateTargetFromInput = useCallback((event) => {
    writeTarget({
      text: event.target.value,
      selectionStart: event.target.selectionStart,
      selectionEnd: event.target.selectionEnd,
    });
  }, [writeTarget]);

  const updateTargetSelection = useCallback((event) => {
    const next = {
      ...targetModelRef.current,
      selectionStart: event.currentTarget.selectionStart,
      selectionEnd: event.currentTarget.selectionEnd,
    };
    targetModelRef.current = next;
    setSelection({ start: next.selectionStart, end: next.selectionEnd });
  }, []);

  const clearTarget = useCallback(() => writeTarget({ text: "", selectionStart: 0, selectionEnd: 0 }), [writeTarget]);

  const clearHistory = useCallback(async () => {
    if (!history.length || !window.confirm("Clear all execution history?")) return;
    try {
      await api.clearHistory();
      setHistory([]);
      showToast("Run history cleared.", "success");
    } catch (error) {
      showToast(error.message || "Could not clear history.", "error");
    }
  }, [history.length, showToast]);

  const exportScripts = useCallback(async () => {
    try {
      const exportFile = await api.getExport();
      const blob = new Blob([JSON.stringify(exportFile, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "autotyper-scripts.json";
      anchor.click();
      URL.revokeObjectURL(href);
      showToast("Script library exported.", "success");
    } catch (error) {
      showToast(error.message || "Could not export scripts.", "error");
    }
  }, [showToast]);

  const importScripts = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed.scripts;
      if (!Array.isArray(imported)) throw new Error("That file does not contain a scripts array.");
      const result = await api.importScripts(imported);
      await loadScripts(true);
      showToast(`${result?.imported ?? imported.length} script(s) imported.`, "success");
    } catch (error) {
      showToast(error.message || "Could not import scripts.", "error");
    }
  }, [loadScripts, showToast]);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="app-mark" aria-hidden="true">AT</div>
        <div className="titlebar-copy"><strong>Auto Typer</strong><span>Typing Automation Utility</span></div>
        <div className="titlebar-spacer" />
        <button aria-label="Toggle color theme" className="window-button" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} type="button">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <nav className="menubar" aria-label="Application views">
        <button className={page === "library" ? "is-current" : ""} onClick={() => setPage("library")} type="button">Script Library</button>
        <button className={page === "history" ? "is-current" : ""} onClick={() => setPage("history")} type="button">Run History</button>
        <span className="menubar-fill" />
        <span className="app-wide-note">Hotkeys active in this app</span>
      </nav>

      <div className="commandbar">
        <Button className="button-primary" onClick={startNew}>+ Add New</Button>
        <Button disabled={!draft.id} onClick={() => draft.id && chooseScript(draft)}>Edit</Button>
        <Button className="button-danger" disabled={!draft.id} onClick={deleteScript}>Delete</Button>
        <span className="command-divider" />
        <Button onClick={exportScripts}>Export JSON</Button>
        <Button onClick={() => importRef.current?.click()}>Import JSON</Button>
        <input accept="application/json,.json" className="visually-hidden" onChange={importScripts} ref={importRef} type="file" />
      </div>

      <main className="main-area">
        {page === "library" ? (
          <div className="workspace-grid">
            <section className="panel library-panel" aria-label="Script library">
              <div className="panel-heading library-heading">
                <div><h2>List of Auto Texts</h2><p>{scripts.length} saved script{scripts.length === 1 ? "" : "s"}</p></div>
                <input aria-label="Search scripts" className="search-input" onChange={(event) => setSearch(event.target.value)} placeholder="Search name or hotkey" value={search} />
              </div>
              <ScriptTable loading={loading} onRun={runScript} onSelect={chooseScript} scripts={filteredScripts} selectedId={selectedId} />
              <div className="panel-footer"><span>Select a row to edit it.</span><span>{filteredScripts.length} shown</span></div>
            </section>

            <Editor
              bodyRef={bodyRef}
              conflict={hotkeyConflict}
              draft={draft}
              onChange={updateDraft}
              onDelete={deleteScript}
              onHotkeyKeyDown={captureHotkey}
              onInsertToken={insertToken}
              onNew={startNew}
              onSave={saveScript}
              recording={recording}
              saving={saving}
              setRecording={setRecording}
            />

            <TargetWindow
              onClear={clearTarget}
              onRun={runScript}
              onSelect={updateTargetSelection}
              onStop={simulation.stop}
              onTargetChange={updateTargetFromInput}
              onTogglePause={simulation.togglePause}
              run={simulation.run}
              selectedScript={selectedScript}
              selection={selection}
              target={target}
              targetRef={targetRef}
            />
          </div>
        ) : <HistoryTable history={history} loading={historyLoading} onClear={clearHistory} />}
      </main>

      <footer className="statusbar">
        <span className={`status-led ${simulation.run.phase !== "idle" ? "is-busy" : ""}`} />
        <span>{simulation.run.phase === "idle" ? "Ready" : `${simulation.run.script?.name || "Script"} — ${simulation.run.phase}`}</span>
        <span className="statusbar-fill" />
        <span>Tokens: {'{Tab}'} {'{Enter}'} {'{Space}'}</span>
      </footer>

      {toast ? <div className={`toast toast-${toast.tone}`} role="status">{toast.message}</div> : null}
    </div>
  );
}
