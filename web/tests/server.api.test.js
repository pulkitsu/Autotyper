import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../server/app.js";
import { FileStore, MemoryStore } from "../server/store.js";
import { normalizeHotkey } from "../server/validation.js";

async function startMemoryApi() {
  const app = createApp({ store: new MemoryStore() });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  return {
    response,
    body: response.status === 204 ? undefined : await response.json(),
  };
}

test("server API persists scripts, enforces hotkeys, and records execution history", async (context) => {
  const api = await startMemoryApi();
  context.after(api.close);

  const initial = await request(api.baseUrl, "/scripts");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.scripts.length, 3);

  const create = await request(api.baseUrl, "/scripts", {
    method: "POST",
    body: JSON.stringify({
      name: "Test script",
      body: "Hello{Tab}world",
      hotkey: " Alt + Control + 4 ",
      charactersPerSecond: 30,
      startDelayMs: 25,
    }),
  });
  assert.equal(create.response.status, 201);
  assert.equal(create.body.script.hotkey, "ctrl+alt+4");
  assert.equal(create.body.script.charactersPerSecond, 30);
  const scriptId = create.body.script.id;

  const duplicate = await request(api.baseUrl, "/scripts", {
    method: "POST",
    body: JSON.stringify({
      name: "Conflicting script",
      body: "x",
      hotkey: "ctrl+alt+4",
    }),
  });
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.body.error.message, /already assigned/i);

  const update = await request(api.baseUrl, `/scripts/${scriptId}`, {
    method: "PUT",
    body: JSON.stringify({ name: "Test script updated", charactersPerSecond: 45 }),
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.script.name, "Test script updated");
  assert.equal(update.body.script.body, "Hello{Tab}world");
  assert.equal(update.body.script.charactersPerSecond, 45);

  const history = await request(api.baseUrl, "/history", {
    method: "POST",
    body: JSON.stringify({
      scriptId,
      startedAt: "2026-08-16T12:00:00.000Z",
      durationMs: 250,
      status: "completed",
    }),
  });
  assert.equal(history.response.status, 201);
  assert.equal(history.body.entry.scriptName, "Test script updated");
  assert.equal(history.body.entry.status, "completed");
  assert.equal(history.body.entry.startedAt, "2026-08-16T12:00:00.000Z");

  const exported = await request(api.baseUrl, "/scripts/export");
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.version, 1);
  assert.equal(exported.body.scripts.length, 4);

  const imported = await request(api.baseUrl, "/scripts/import", {
    method: "POST",
    body: JSON.stringify({
      scripts: [
        {
          name: "Imported script",
          body: "Imported",
          hotkey: "ctrl+alt+5",
          charactersPerSecond: 12,
          startDelayMs: 0,
        },
      ],
    }),
  });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.body.imported, 1);

  const clear = await request(api.baseUrl, "/history", { method: "DELETE" });
  assert.equal(clear.response.status, 200);
  assert.equal(clear.body.cleared, 1);

  const deleted = await request(api.baseUrl, `/scripts/${scriptId}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 204);
});

test("server-side hotkey policy matches browser-safe shortcuts", () => {
  assert.equal(normalizeHotkey("F6"), "f6");
  assert.equal(normalizeHotkey("ctrl + left"), "ctrl+arrowleft");
  assert.throws(() => normalizeHotkey("ctrl+r"), /reserved/i);
  assert.throws(() => normalizeHotkey("shift+a"), /too easy/i);
});

test("desktop file store preserves scripts and execution history across launches", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "autotyper-desktop-store-"));
  const filePath = path.join(directory, "library.json");
  context.after(() => rm(directory, { recursive: true, force: true }));

  const firstLaunch = await FileStore.open(filePath);
  const script = await firstLaunch.createScript({
    name: "Desktop script",
    body: "Hello from the desktop app",
    hotkey: "ctrl+alt+6",
    charactersPerSecond: 25,
    startDelayMs: 0,
  });
  const historyEntry = await firstLaunch.createHistory({
    scriptId: script.id,
    startedAt: "2026-08-17T00:00:00.000Z",
    durationMs: 123,
    status: "completed",
  });

  const secondLaunch = await FileStore.open(filePath);
  const scripts = await secondLaunch.listScripts();
  const history = await secondLaunch.listHistory({ limit: 10 });
  assert.equal(scripts.some((entry) => entry.id === script.id), true);
  assert.deepEqual(history[0], historyEntry);
});

test("macro API stores ordered steps, boundaries, schedules, history, and analytics", async (context) => {
  const api = await startMemoryApi();
  context.after(api.close);

  const create = await request(api.baseUrl, "/macros", {
    method: "POST",
    body: JSON.stringify({
      name: "Customer follow-up",
      hotkey: "Ctrl + Alt + Shift + 7",
      folder: "Sales",
      tags: ["follow-up", "Email", "email"],
      charactersPerSecond: 32,
      startDelayMs: 200,
      clickIntervalMs: 75,
      repeat: { mode: "count", count: 2 },
      boundary: { x: 10, y: 20, width: 640, height: 480 },
      focusTrigger: { application: "CRM" },
      mailMerge: {
        sourceName: "leads.csv",
        headers: ["firstName", "company"],
        rows: [{ firstName: "Asha", company: "Acme" }],
      },
      steps: [
        { id: "intro", type: "typeText", text: "Hi {firstName},{Enter}" },
        { id: "click-send", type: "click", x: 120, y: 80, button: "left", clickType: "double" },
        { id: "pause", type: "wait", durationMs: 150 },
        {
          id: "loop", type: "loop", count: 2,
          steps: [{ id: "move", type: "move", x: 90, y: 100, durationMs: 50 }],
        },
      ],
    }),
  });
  assert.equal(create.response.status, 201);
  const macro = create.body.macro;
  assert.equal(macro.hotkey, "ctrl+alt+shift+7");
  assert.deepEqual(macro.tags, ["follow-up", "Email"]);
  assert.equal(macro.steps[1].clickType, "double");
  assert.equal(macro.steps[3].steps[0].type, "move");
  assert.equal(macro.boundary.width, 640);
  assert.equal(macro.mailMerge.rows[0].firstName, "Asha");

  const duplicate = await request(api.baseUrl, "/macros", {
    method: "POST",
    body: JSON.stringify({ name: "Duplicate", hotkey: "ctrl+alt+shift+7", steps: [] }),
  });
  assert.equal(duplicate.response.status, 409);

  const filtered = await request(api.baseUrl, "/macros?folder=sales&tag=email&search=follow");
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.body.macros.length, 1);

  const updated = await request(api.baseUrl, `/macros/${macro.id}`, {
    method: "PUT",
    body: JSON.stringify({ repeat: { mode: "duration", durationMs: 5000 } }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.macro.name, "Customer follow-up");
  assert.deepEqual(updated.body.macro.repeat, { mode: "duration", durationMs: 5000 });

  const history = await request(api.baseUrl, "/macro-history", {
    method: "POST",
    body: JSON.stringify({
      macroId: macro.id,
      startedAt: "2026-08-17T12:00:00.000Z",
      durationMs: 750,
      status: "completed",
      stepsCompleted: 4,
      timeSavedMs: 5000,
    }),
  });
  assert.equal(history.response.status, 201);
  assert.equal(history.body.entry.macroName, "Customer follow-up");
  assert.equal(history.body.entry.stepsCompleted, 4);

  const analytics = await request(api.baseUrl, "/macro-analytics");
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.body.summary.totalRuns, 1);
  assert.equal(analytics.body.summary.timeSavedMs, 5000);
  assert.equal(analytics.body.mostUsedMacros[0].macroId, macro.id);

  const oneShot = await request(api.baseUrl, "/macro-schedules", {
    method: "POST",
    body: JSON.stringify({
      macroId: macro.id,
      type: "once",
      runAt: "2026-08-18T09:00:00.000Z",
    }),
  });
  assert.equal(oneShot.response.status, 201);
  assert.equal(oneShot.body.schedule.nextRunAt, "2026-08-18T09:00:00.000Z");

  const triggered = await request(api.baseUrl, `/macro-schedules/${oneShot.body.schedule.id}/triggered`, {
    method: "POST",
    body: JSON.stringify({ triggeredAt: "2026-08-18T09:00:00.000Z" }),
  });
  assert.equal(triggered.response.status, 200);
  assert.equal(triggered.body.schedule.enabled, false);
  assert.equal(triggered.body.schedule.lastRunAt, "2026-08-18T09:00:00.000Z");
  assert.equal(triggered.body.schedule.nextRunAt, null);

  const interval = await request(api.baseUrl, "/macro-schedules", {
    method: "POST",
    body: JSON.stringify({
      macroId: macro.id,
      type: "interval",
      startsAt: "2026-08-18T10:00:00.000Z",
      intervalMs: 60000,
    }),
  });
  assert.equal(interval.response.status, 201);
  const intervalTriggered = await request(api.baseUrl, `/macro-schedules/${interval.body.schedule.id}/triggered`, {
    method: "POST",
    body: JSON.stringify({ triggeredAt: "2026-08-18T10:00:00.000Z" }),
  });
  assert.equal(intervalTriggered.response.status, 200);
  assert.equal(intervalTriggered.body.schedule.nextRunAt, "2026-08-18T10:01:00.000Z");

  const exported = await request(api.baseUrl, "/macros/export");
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.type, "autotyper-macros");
  assert.equal(exported.body.macros.some((entry) => entry.id === macro.id), true);

  const cleared = await request(api.baseUrl, "/macro-history", { method: "DELETE" });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.cleared, 1);
});

test("desktop file store keeps macros, schedules, and macro history across launches", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "autotyper-macro-store-"));
  const filePath = path.join(directory, "library.json");
  context.after(() => rm(directory, { recursive: true, force: true }));

  const firstLaunch = await FileStore.open(filePath);
  const macro = await firstLaunch.createMacro({
    name: "Persistent macro",
    hotkey: "ctrl+alt+shift+8",
    folder: null,
    tags: [],
    steps: [{ type: "typeText", text: "Hello {Enter}" }],
    charactersPerSecond: 20,
    startDelayMs: 0,
    clickIntervalMs: 100,
    repeat: { mode: "count", count: 1 },
    boundary: null,
    focusTrigger: null,
    mailMerge: null,
  });
  await firstLaunch.createMacroHistory({
    macroId: macro.id,
    startedAt: "2026-08-17T00:00:00.000Z",
    durationMs: 123,
    status: "completed",
    stepsCompleted: 1,
    timeSavedMs: 10,
    errorMessage: null,
  });
  await firstLaunch.createMacroSchedule({
    macroId: macro.id,
    type: "interval",
    enabled: true,
    runAt: null,
    startsAt: "2026-08-18T00:00:00.000Z",
    intervalMs: 60000,
  });

  const secondLaunch = await FileStore.open(filePath);
  assert.equal((await secondLaunch.listMacros()).some((entry) => entry.id === macro.id), true);
  assert.equal((await secondLaunch.listMacroHistory({ limit: 10 }))[0].macroId, macro.id);
  assert.equal((await secondLaunch.listMacroSchedules({ macroId: macro.id })).length, 1);
});
