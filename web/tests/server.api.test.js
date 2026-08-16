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
