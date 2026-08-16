import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  ApiError,
  validateHistoryInput,
  validateLimit,
  validateMacroHistoryInput,
  validateMacroInput,
  validateMacroScheduleInput,
  validateMacroScheduleTriggeredInput,
  validateScriptInput,
  validateUuid,
} from "./validation.js";

function notFound(resource) {
  return new ApiError(404, `${resource} was not found.`);
}

const asyncRoute = (handler) => (request, response, next) =>
  Promise.resolve(handler(request, response, next)).catch(next);

function createCorsOptions() {
  const origins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length ? { origin: origins } : {};
}

function mergedScriptInput(existing, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ApiError(422, "A script object is required.");
  }
  return {
    name: Object.hasOwn(patch, "name") ? patch.name : existing.name,
    body: Object.hasOwn(patch, "body") ? patch.body : existing.body,
    hotkey: Object.hasOwn(patch, "hotkey") ? patch.hotkey : existing.hotkey,
    charactersPerSecond: Object.hasOwn(patch, "charactersPerSecond")
      ? patch.charactersPerSecond
      : existing.charactersPerSecond,
    startDelayMs: Object.hasOwn(patch, "startDelayMs")
      ? patch.startDelayMs
      : existing.startDelayMs,
  };
}

function mergedMacroInput(existing, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ApiError(422, "A macro object is required.");
  }
  return {
    name: Object.hasOwn(patch, "name") ? patch.name : existing.name,
    hotkey: Object.hasOwn(patch, "hotkey") ? patch.hotkey : existing.hotkey,
    folder: Object.hasOwn(patch, "folder") ? patch.folder : existing.folder,
    tags: Object.hasOwn(patch, "tags") ? patch.tags : existing.tags,
    steps: Object.hasOwn(patch, "steps") ? patch.steps : existing.steps,
    charactersPerSecond: Object.hasOwn(patch, "charactersPerSecond")
      ? patch.charactersPerSecond
      : existing.charactersPerSecond,
    startDelayMs: Object.hasOwn(patch, "startDelayMs") ? patch.startDelayMs : existing.startDelayMs,
    clickIntervalMs: Object.hasOwn(patch, "clickIntervalMs")
      ? patch.clickIntervalMs
      : existing.clickIntervalMs,
    repeat: Object.hasOwn(patch, "repeat") ? patch.repeat : existing.repeat,
    boundary: Object.hasOwn(patch, "boundary") ? patch.boundary : existing.boundary,
    focusTrigger: Object.hasOwn(patch, "focusTrigger")
      ? patch.focusTrigger
      : existing.focusTrigger,
    mailMerge: Object.hasOwn(patch, "mailMerge") ? patch.mailMerge : existing.mailMerge,
  };
}

function mergedMacroScheduleInput(existing, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ApiError(422, "A macro schedule object is required.");
  }
  return {
    macroId: Object.hasOwn(patch, "macroId") ? patch.macroId : existing.macroId,
    type: Object.hasOwn(patch, "type") ? patch.type : existing.type,
    enabled: Object.hasOwn(patch, "enabled") ? patch.enabled : existing.enabled,
    runAt: Object.hasOwn(patch, "runAt") ? patch.runAt : existing.runAt,
    startsAt: Object.hasOwn(patch, "startsAt") ? patch.startsAt : existing.startsAt,
    intervalMs: Object.hasOwn(patch, "intervalMs") ? patch.intervalMs : existing.intervalMs,
  };
}

function importPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(422, "Import data must be an exported AutoTyper JSON object.");
  }
  const { scripts } = body;
  if (!Array.isArray(scripts) || scripts.length === 0) {
    throw new ApiError(422, "Import data must contain at least one script.");
  }
  if (scripts.length > 1_000) {
    throw new ApiError(422, "Imports are limited to 1,000 scripts at a time.");
  }
  const mode = body.mode === undefined ? "merge" : String(body.mode).toLowerCase();
  if (!["merge", "replace"].includes(mode)) {
    throw new ApiError(422, "Invalid import mode.", {
      mode: "Use merge or replace.",
    });
  }
  return { scripts: scripts.map(validateScriptInput), mode };
}

function macroImportPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(422, "Import data must be an exported AutoTyper macro JSON object.");
  }
  const { macros } = body;
  if (!Array.isArray(macros) || macros.length === 0) {
    throw new ApiError(422, "Import data must contain at least one macro.");
  }
  if (macros.length > 1_000) {
    throw new ApiError(422, "Imports are limited to 1,000 macros at a time.");
  }
  const mode = body.mode === undefined ? "merge" : String(body.mode).toLowerCase();
  if (!["merge", "replace"].includes(mode)) {
    throw new ApiError(422, "Invalid import mode.", { mode: "Use merge or replace." });
  }
  return { macros: macros.map(validateMacroInput), mode };
}

/**
 * Creates the HTTP API around either the PostgreSQL store or the explicitly
 * non-persistent development fallback store.
 */
export function createApp({ store, staticDir = null }) {
  if (!store) {
    throw new Error("createApp requires a script store.");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, storage: store.kind });
  });

  app.get("/api/scripts", asyncRoute(async (request, response) => {
    const search = typeof request.query.search === "string" ? request.query.search : "";
    const scripts = await store.listScripts({ search });
    response.json({ scripts });
  }));

  // Export/import must be registered before /api/scripts/:id.
  app.get("/api/scripts/export", asyncRoute(async (_request, response) => {
    const scripts = await store.listScripts();
    response.setHeader("Content-Disposition", 'attachment; filename="autotyper-scripts.json"');
    response.json({ version: 1, exportedAt: new Date().toISOString(), scripts });
  }));

  app.post("/api/scripts/import", asyncRoute(async (request, response) => {
    const { scripts, mode } = importPayload(request.body);
    const imported = await store.importScripts(scripts, { mode });
    response.status(201).json({ mode, imported: imported.length, scripts: imported });
  }));

  app.get("/api/scripts/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const script = await store.getScript(id);
    if (!script) {
      throw notFound("Script");
    }
    response.json({ script });
  }));

  app.post("/api/scripts", asyncRoute(async (request, response) => {
    const script = await store.createScript(validateScriptInput(request.body));
    response.status(201).json({ script });
  }));

  app.put("/api/scripts/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const existing = await store.getScript(id);
    if (!existing) {
      throw notFound("Script");
    }
    const input = validateScriptInput(mergedScriptInput(existing, request.body));
    const script = await store.updateScript(id, input);
    if (!script) {
      throw notFound("Script");
    }
    response.json({ script });
  }));

  app.delete("/api/scripts/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const deleted = await store.deleteScript(id);
    if (!deleted) {
      throw notFound("Script");
    }
    response.status(204).end();
  }));

  app.get("/api/history", asyncRoute(async (request, response) => {
    const history = await store.listHistory({ limit: validateLimit(request.query.limit) });
    response.json({ history });
  }));

  app.post("/api/history", asyncRoute(async (request, response) => {
    const entry = await store.createHistory(validateHistoryInput(request.body));
    response.status(201).json({ entry });
  }));

  app.delete("/api/history", asyncRoute(async (_request, response) => {
    const cleared = await store.clearHistory();
    response.json({ cleared });
  }));

  // Macro APIs deliberately live alongside (rather than replace) the original
  // script APIs so existing libraries and the legacy editor remain compatible.
  app.get("/api/macros", asyncRoute(async (request, response) => {
    const search = typeof request.query.search === "string" ? request.query.search : "";
    const folder = typeof request.query.folder === "string" ? request.query.folder : "";
    const tag = typeof request.query.tag === "string" ? request.query.tag : "";
    const macros = await store.listMacros({ search, folder, tag });
    response.json({ macros });
  }));

  // Export/import must be registered before /api/macros/:id.
  app.get("/api/macros/export", asyncRoute(async (_request, response) => {
    const macros = await store.listMacros();
    response.setHeader("Content-Disposition", 'attachment; filename="autotyper-macros.json"');
    response.json({ version: 1, type: "autotyper-macros", exportedAt: new Date().toISOString(), macros });
  }));

  app.post("/api/macros/import", asyncRoute(async (request, response) => {
    const { macros, mode } = macroImportPayload(request.body);
    const imported = await store.importMacros(macros, { mode });
    response.status(201).json({ mode, imported: imported.length, macros: imported });
  }));

  app.get("/api/macro-history", asyncRoute(async (request, response) => {
    const macroId = request.query.macroId === undefined
      ? null
      : validateUuid(request.query.macroId, "macroId");
    const history = await store.listMacroHistory({
      limit: validateLimit(request.query.limit),
      macroId,
    });
    response.json({ history });
  }));

  app.post("/api/macro-history", asyncRoute(async (request, response) => {
    const entry = await store.createMacroHistory(validateMacroHistoryInput(request.body));
    response.status(201).json({ entry });
  }));

  app.delete("/api/macro-history", asyncRoute(async (_request, response) => {
    const cleared = await store.clearMacroHistory();
    response.json({ cleared });
  }));

  app.get("/api/macro-analytics", asyncRoute(async (_request, response) => {
    const analytics = await store.getMacroAnalytics();
    response.json(analytics);
  }));

  app.get("/api/macro-schedules", asyncRoute(async (request, response) => {
    const macroId = request.query.macroId === undefined
      ? null
      : validateUuid(request.query.macroId, "macroId");
    const schedules = await store.listMacroSchedules({ macroId });
    response.json({ schedules });
  }));

  app.post("/api/macro-schedules", asyncRoute(async (request, response) => {
    const schedule = await store.createMacroSchedule(validateMacroScheduleInput(request.body));
    response.status(201).json({ schedule });
  }));

  app.post("/api/macro-schedules/:id/triggered", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const schedule = await store.markMacroScheduleTriggered(
      id,
      validateMacroScheduleTriggeredInput(request.body),
    );
    if (!schedule) throw notFound("Macro schedule");
    response.json({ schedule });
  }));

  app.put("/api/macro-schedules/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const existing = await store.getMacroSchedule(id);
    if (!existing) throw notFound("Macro schedule");
    const schedule = await store.updateMacroSchedule(
      id,
      validateMacroScheduleInput(mergedMacroScheduleInput(existing, request.body)),
    );
    if (!schedule) throw notFound("Macro schedule");
    response.json({ schedule });
  }));

  app.delete("/api/macro-schedules/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const deleted = await store.deleteMacroSchedule(id);
    if (!deleted) throw notFound("Macro schedule");
    response.status(204).end();
  }));

  app.get("/api/macros/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const macro = await store.getMacro(id);
    if (!macro) throw notFound("Macro");
    response.json({ macro });
  }));

  app.post("/api/macros", asyncRoute(async (request, response) => {
    const macro = await store.createMacro(validateMacroInput(request.body));
    response.status(201).json({ macro });
  }));

  app.put("/api/macros/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const existing = await store.getMacro(id);
    if (!existing) throw notFound("Macro");
    const macro = await store.updateMacro(id, validateMacroInput(mergedMacroInput(existing, request.body)));
    if (!macro) throw notFound("Macro");
    response.json({ macro });
  }));

  app.delete("/api/macros/:id", asyncRoute(async (request, response) => {
    const id = validateUuid(request.params.id);
    const deleted = await store.deleteMacro(id);
    if (!deleted) throw notFound("Macro");
    response.status(204).end();
  }));

  // Production serves the built SPA from this same process. In development
  // Vite handles the client and proxies only /api requests here.
  if (staticDir && existsSync(staticDir)) {
    const indexFile = path.join(staticDir, "index.html");
    app.use(express.static(staticDir));
    app.get("/{*splat}", (request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(indexFile);
    });
  }

  app.use((_request, _response, next) => {
    next(new ApiError(404, "API route was not found."));
  });

  // Keep database constraint failures useful even if concurrent requests race the pre-check.
  app.use((error, _request, response, _next) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({
        error: { message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
      });
      return;
    }
    if (error?.type === "entity.parse.failed") {
      response.status(400).json({ error: { message: "Request body must be valid JSON." } });
      return;
    }
    if (error?.code === "23505") {
      const isMacroConflict = error?.constraint === "macros_hotkey_lower_unique";
      response.status(409).json({
        error: {
          message: isMacroConflict
            ? "The hotkey is already assigned to another macro."
            : "The hotkey is already assigned to another script.",
          fields: { hotkey: isMacroConflict ? "Choose a unique macro hotkey." : "Choose a unique hotkey." },
        },
      });
      return;
    }
    console.error("AutoTyper API error", error);
    response.status(500).json({ error: { message: "An unexpected server error occurred." } });
  });

  return app;
}
