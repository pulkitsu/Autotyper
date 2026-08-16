import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  ApiError,
  validateHistoryInput,
  validateLimit,
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
      response.status(409).json({
        error: {
          message: "The hotkey is already assigned to another script.",
          fields: { hotkey: "Choose a unique hotkey." },
        },
      });
      return;
    }
    console.error("AutoTyper API error", error);
    response.status(500).json({ error: { message: "An unexpected server error occurred." } });
  });

  return app;
}
