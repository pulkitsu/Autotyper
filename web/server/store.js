import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import { DEFAULT_MACROS, DEFAULT_SCRIPTS } from "./seed-data.js";
import { ApiError } from "./validation.js";

const SCRIPT_COLUMNS = `
  id,
  name,
  body,
  hotkey,
  characters_per_second AS "charactersPerSecond",
  start_delay_ms AS "startDelayMs",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const HISTORY_COLUMNS = `
  id,
  script_id AS "scriptId",
  script_name AS "scriptName",
  hotkey,
  started_at AS "startedAt",
  duration_ms AS "durationMs",
  status
`;

const MACRO_COLUMNS = `
  id,
  name,
  hotkey,
  folder,
  tags,
  steps,
  characters_per_second AS "charactersPerSecond",
  start_delay_ms AS "startDelayMs",
  click_interval_ms AS "clickIntervalMs",
  repeat_config AS "repeat",
  boundary,
  focus_trigger AS "focusTrigger",
  mail_merge AS "mailMerge",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const MACRO_HISTORY_COLUMNS = `
  id,
  macro_id AS "macroId",
  macro_name AS "macroName",
  hotkey,
  started_at AS "startedAt",
  duration_ms AS "durationMs",
  status,
  steps_completed AS "stepsCompleted",
  time_saved_ms AS "timeSavedMs",
  error_message AS "errorMessage"
`;

const MACRO_SCHEDULE_COLUMNS = `
  id,
  macro_id AS "macroId",
  schedule_type AS "type",
  enabled,
  run_at AS "runAt",
  starts_at AS "startsAt",
  interval_ms AS "intervalMs",
  last_run_at AS "lastRunAt",
  next_run_at AS "nextRunAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value) {
  return value === null || value === undefined ? null : toIso(value);
}

function serializeScript(row) {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    hotkey: row.hotkey,
    charactersPerSecond: Number(row.charactersPerSecond),
    startDelayMs: Number(row.startDelayMs),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeHistory(row) {
  return {
    id: row.id,
    scriptId: row.scriptId,
    scriptName: row.scriptName,
    hotkey: row.hotkey,
    startedAt: toIso(row.startedAt),
    durationMs: Number(row.durationMs),
    status: row.status,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObjectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function serializeMacro(row) {
  return {
    id: row.id,
    name: row.name,
    hotkey: row.hotkey,
    folder: row.folder ?? null,
    tags: asArray(row.tags),
    steps: asArray(row.steps),
    charactersPerSecond: Number(row.charactersPerSecond),
    startDelayMs: Number(row.startDelayMs),
    clickIntervalMs: Number(row.clickIntervalMs),
    repeat: asObjectOrNull(row.repeat) ?? { mode: "count", count: 1 },
    boundary: asObjectOrNull(row.boundary),
    focusTrigger: asObjectOrNull(row.focusTrigger),
    mailMerge: asObjectOrNull(row.mailMerge),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeMacroHistory(row) {
  return {
    id: row.id,
    macroId: row.macroId ?? null,
    macroName: row.macroName,
    hotkey: row.hotkey,
    startedAt: toIso(row.startedAt),
    durationMs: Number(row.durationMs),
    status: row.status,
    stepsCompleted: Number(row.stepsCompleted),
    timeSavedMs: Number(row.timeSavedMs),
    errorMessage: row.errorMessage ?? null,
  };
}

function serializeMacroSchedule(row) {
  return {
    id: row.id,
    macroId: row.macroId,
    type: row.type,
    enabled: Boolean(row.enabled),
    runAt: toIsoOrNull(row.runAt),
    startsAt: toIsoOrNull(row.startsAt),
    intervalMs: row.intervalMs === null || row.intervalMs === undefined ? null : Number(row.intervalMs),
    lastRunAt: toIsoOrNull(row.lastRunAt),
    nextRunAt: toIsoOrNull(row.nextRunAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function hotkeyConflict(hotkey) {
  return new ApiError(409, `The hotkey “${hotkey}” is already assigned to another script.`, {
    hotkey: "Choose a unique hotkey.",
  });
}

function importDuplicateConflict(hotkey) {
  return new ApiError(409, `The import contains duplicate hotkey “${hotkey}”.`, {
    hotkey: "Each script must use a unique hotkey.",
  });
}

function macroHotkeyConflict(hotkey) {
  return new ApiError(409, `The hotkey “${hotkey}” is already assigned to another macro.`, {
    hotkey: "Choose a unique macro hotkey.",
  });
}

function importMacroDuplicateConflict(hotkey) {
  return new ApiError(409, `The macro import contains duplicate hotkey “${hotkey}”.`, {
    hotkey: "Each macro must use a unique hotkey.",
  });
}

function assertImportHasUniqueHotkeys(scripts) {
  const hotkeys = new Set();
  for (const script of scripts) {
    if (hotkeys.has(script.hotkey)) {
      throw importDuplicateConflict(script.hotkey);
    }
    hotkeys.add(script.hotkey);
  }
}

function assertImportHasUniqueMacroHotkeys(macros) {
  const hotkeys = new Set();
  for (const macro of macros) {
    const key = macro.hotkey.toLowerCase();
    if (hotkeys.has(key)) {
      throw importMacroDuplicateConflict(macro.hotkey);
    }
    hotkeys.add(key);
  }
}

function clone(value) {
  return structuredClone(value);
}

function calculateMacroAnalytics(entries) {
  const totals = {
    totalRuns: entries.length,
    successfulRuns: 0,
    failedRuns: 0,
    stoppedRuns: 0,
    rateLimitedRuns: 0,
    totalDurationMs: 0,
    timeSavedMs: 0,
  };
  const usage = new Map();
  for (const entry of entries) {
    totals.totalDurationMs += Number(entry.durationMs) || 0;
    totals.timeSavedMs += Number(entry.timeSavedMs) || 0;
    if (entry.status === "completed") totals.successfulRuns += 1;
    else if (entry.status === "stopped") totals.stoppedRuns += 1;
    else if (entry.status === "rate_limited") totals.rateLimitedRuns += 1;
    else totals.failedRuns += 1;

    const key = entry.macroId ?? `${entry.macroName}:${entry.hotkey}`;
    const macro = usage.get(key) ?? {
      macroId: entry.macroId ?? null,
      macroName: entry.macroName,
      runs: 0,
      successfulRuns: 0,
      totalDurationMs: 0,
      timeSavedMs: 0,
    };
    macro.runs += 1;
    macro.successfulRuns += entry.status === "completed" ? 1 : 0;
    macro.totalDurationMs += Number(entry.durationMs) || 0;
    macro.timeSavedMs += Number(entry.timeSavedMs) || 0;
    usage.set(key, macro);
  }
  return {
    summary: {
      ...totals,
      successRate: totals.totalRuns ? totals.successfulRuns / totals.totalRuns : 0,
    },
    mostUsedMacros: [...usage.values()]
      .map((macro) => ({
        ...macro,
        successRate: macro.runs ? macro.successfulRuns / macro.runs : 0,
      }))
      .sort((a, b) => b.runs - a.runs || b.timeSavedMs - a.timeSavedMs || a.macroName.localeCompare(b.macroName))
      .slice(0, 10),
  };
}

/**
 * A non-persistent convenience store for local UI work. It is used only when
 * neither DATABASE_URL nor AUTOTYPER_DATA_FILE is configured.
 */
export class MemoryStore {
  kind = "memory";

  constructor(seed = DEFAULT_SCRIPTS, macroSeed = DEFAULT_MACROS) {
    const now = new Date().toISOString();
    this.scripts = seed.map((script) => ({
      id: randomUUID(),
      ...script,
      createdAt: now,
      updatedAt: now,
    }));
    this.history = [];
    this.macros = macroSeed.map((macro) => ({
      id: randomUUID(),
      ...clone(macro),
      createdAt: now,
      updatedAt: now,
    }));
    this.macroHistory = [];
    this.macroSchedules = [];
  }

  async listScripts({ search = "" } = {}) {
    const needle = search.trim().toLowerCase();
    return clone(
      this.scripts
        .filter(
          (script) =>
            !needle ||
            script.name.toLowerCase().includes(needle) ||
            script.hotkey.toLowerCase().includes(needle),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)),
    );
  }

  async getScript(id) {
    const script = this.scripts.find((entry) => entry.id === id);
    return script ? clone(script) : null;
  }

  async createScript(input) {
    this.#assertHotkeyAvailable(input.hotkey);
    const now = new Date().toISOString();
    const script = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.scripts.push(script);
    return clone(script);
  }

  async updateScript(id, input) {
    const index = this.scripts.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return null;
    }
    this.#assertHotkeyAvailable(input.hotkey, id);
    const existing = this.scripts[index];
    const updated = { ...existing, ...input, updatedAt: new Date().toISOString() };
    this.scripts[index] = updated;
    return clone(updated);
  }

  async deleteScript(id) {
    const index = this.scripts.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return null;
    }
    const [deleted] = this.scripts.splice(index, 1);
    for (const event of this.history) {
      if (event.scriptId === id) {
        event.scriptId = null;
      }
    }
    return clone(deleted);
  }

  async importScripts(scripts, { mode }) {
    assertImportHasUniqueHotkeys(scripts);
    if (mode === "merge") {
      for (const script of scripts) {
        this.#assertHotkeyAvailable(script.hotkey);
      }
    }
    if (mode === "replace") {
      const removedIds = new Set(this.scripts.map((script) => script.id));
      this.scripts = [];
      for (const event of this.history) {
        if (removedIds.has(event.scriptId)) {
          event.scriptId = null;
        }
      }
    }
    const now = new Date().toISOString();
    const created = scripts.map((script) => ({
      id: randomUUID(),
      ...script,
      createdAt: now,
      updatedAt: now,
    }));
    this.scripts.push(...created);
    return clone(created);
  }

  async listHistory({ limit }) {
    return clone(
      this.history
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit),
    );
  }

  async createHistory(input) {
    const script = this.scripts.find((entry) => entry.id === input.scriptId);
    if (!script) {
      throw new ApiError(404, "The script for this execution no longer exists.");
    }
    const history = {
      id: randomUUID(),
      scriptId: script.id,
      scriptName: script.name,
      hotkey: script.hotkey,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      status: input.status,
    };
    this.history.push(history);
    return clone(history);
  }

  async clearHistory() {
    const cleared = this.history.length;
    this.history = [];
    return cleared;
  }

  async listMacros({ search = "", folder = "", tag = "" } = {}) {
    const needle = search.trim().toLowerCase();
    const normalizedFolder = folder.trim().toLowerCase();
    const normalizedTag = tag.trim().toLowerCase();
    return clone(
      this.macros
        .filter((macro) =>
          (!needle || macro.name.toLowerCase().includes(needle) || macro.hotkey.toLowerCase().includes(needle)) &&
          (!normalizedFolder || macro.folder?.toLowerCase() === normalizedFolder) &&
          (!normalizedTag || macro.tags.some((entry) => entry.toLowerCase() === normalizedTag)),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)),
    );
  }

  async getMacro(id) {
    const macro = this.macros.find((entry) => entry.id === id);
    return macro ? clone(macro) : null;
  }

  async createMacro(input) {
    this.#assertMacroHotkeyAvailable(input.hotkey);
    const now = new Date().toISOString();
    const macro = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.macros.push(macro);
    return clone(macro);
  }

  async updateMacro(id, input) {
    const index = this.macros.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    this.#assertMacroHotkeyAvailable(input.hotkey, id);
    const updated = { ...this.macros[index], ...input, updatedAt: new Date().toISOString() };
    this.macros[index] = updated;
    return clone(updated);
  }

  async deleteMacro(id) {
    const index = this.macros.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    const [deleted] = this.macros.splice(index, 1);
    for (const event of this.macroHistory) {
      if (event.macroId === id) event.macroId = null;
    }
    this.macroSchedules = this.macroSchedules.filter((schedule) => schedule.macroId !== id);
    return clone(deleted);
  }

  async importMacros(macros, { mode }) {
    assertImportHasUniqueMacroHotkeys(macros);
    if (mode === "merge") {
      for (const macro of macros) this.#assertMacroHotkeyAvailable(macro.hotkey);
    }
    if (mode === "replace") {
      const removedIds = new Set(this.macros.map((macro) => macro.id));
      this.macros = [];
      this.macroSchedules = [];
      for (const event of this.macroHistory) {
        if (removedIds.has(event.macroId)) event.macroId = null;
      }
    }
    const now = new Date().toISOString();
    const created = macros.map((macro) => ({
      id: randomUUID(),
      ...macro,
      createdAt: now,
      updatedAt: now,
    }));
    this.macros.push(...created);
    return clone(created);
  }

  async listMacroHistory({ limit, macroId = null } = {}) {
    return clone(
      this.macroHistory
        .filter((entry) => !macroId || entry.macroId === macroId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit),
    );
  }

  async createMacroHistory(input) {
    const macro = this.macros.find((entry) => entry.id === input.macroId);
    if (!macro) throw new ApiError(404, "The macro for this execution no longer exists.");
    const entry = {
      id: randomUUID(),
      macroId: macro.id,
      macroName: macro.name,
      hotkey: macro.hotkey,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      status: input.status,
      stepsCompleted: input.stepsCompleted,
      timeSavedMs: input.timeSavedMs,
      errorMessage: input.errorMessage,
    };
    this.macroHistory.push(entry);
    return clone(entry);
  }

  async clearMacroHistory() {
    const cleared = this.macroHistory.length;
    this.macroHistory = [];
    return cleared;
  }

  async getMacroAnalytics() {
    return calculateMacroAnalytics(this.macroHistory);
  }

  async listMacroSchedules({ macroId = null } = {}) {
    return clone(
      this.macroSchedules
        .filter((schedule) => !macroId || schedule.macroId === macroId)
        .sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? "") || a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async getMacroSchedule(id) {
    const schedule = this.macroSchedules.find((entry) => entry.id === id);
    return schedule ? clone(schedule) : null;
  }

  async createMacroSchedule(input) {
    const macro = this.macros.find((entry) => entry.id === input.macroId);
    if (!macro) throw new ApiError(404, "The macro for this schedule no longer exists.");
    const now = new Date().toISOString();
    const schedule = {
      id: randomUUID(),
      ...input,
      lastRunAt: null,
      nextRunAt: input.enabled ? (input.type === "once" ? input.runAt : input.startsAt) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.macroSchedules.push(schedule);
    return clone(schedule);
  }

  async updateMacroSchedule(id, input) {
    const index = this.macroSchedules.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    const macro = this.macros.find((entry) => entry.id === input.macroId);
    if (!macro) throw new ApiError(404, "The macro for this schedule no longer exists.");
    const existing = this.macroSchedules[index];
    const updated = {
      ...existing,
      ...input,
      nextRunAt: input.enabled ? (input.type === "once" ? input.runAt : input.startsAt) : null,
      updatedAt: new Date().toISOString(),
    };
    this.macroSchedules[index] = updated;
    return clone(updated);
  }

  async deleteMacroSchedule(id) {
    const index = this.macroSchedules.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    const [deleted] = this.macroSchedules.splice(index, 1);
    return clone(deleted);
  }

  async markMacroScheduleTriggered(id, { triggeredAt }) {
    const index = this.macroSchedules.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    const existing = this.macroSchedules[index];
    const completedAt = new Date(triggeredAt).toISOString();
    const isOneShot = existing.type === "once";
    const updated = {
      ...existing,
      enabled: isOneShot ? false : existing.enabled,
      lastRunAt: completedAt,
      nextRunAt: !existing.enabled || isOneShot
        ? null
        : new Date(new Date(completedAt).getTime() + existing.intervalMs).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.macroSchedules[index] = updated;
    return clone(updated);
  }

  async close() {}

  #assertHotkeyAvailable(hotkey, ignoredId = null) {
    const duplicate = this.scripts.find(
      (entry) => entry.hotkey === hotkey && entry.id !== ignoredId,
    );
    if (duplicate) {
      throw hotkeyConflict(hotkey);
    }
  }

  #assertMacroHotkeyAvailable(hotkey, ignoredId = null) {
    const duplicate = this.macros.find(
      (entry) => entry.hotkey.toLowerCase() === hotkey.toLowerCase() && entry.id !== ignoredId,
    );
    if (duplicate) throw macroHotkeyConflict(hotkey);
  }
}

/**
 * A durable local store used by the packaged desktop companion. It deliberately
 * has the same API as PostgreSQL and MemoryStore so the React application does
 * not need a desktop-only data path. Updates are written atomically to avoid
 * corrupting a user's script library if the desktop app is closed mid-save.
 */
export class FileStore extends MemoryStore {
  kind = "file";

  constructor(filePath, seed = DEFAULT_SCRIPTS) {
    super(seed);
    this.filePath = filePath;
  }

  static async open(filePath) {
    const store = new FileStore(filePath);
    await store.#hydrate();
    return store;
  }

  async createScript(input) {
    const script = await super.createScript(input);
    await this.#persist();
    return script;
  }

  async updateScript(id, input) {
    const script = await super.updateScript(id, input);
    if (script) await this.#persist();
    return script;
  }

  async deleteScript(id) {
    const script = await super.deleteScript(id);
    if (script) await this.#persist();
    return script;
  }

  async importScripts(scripts, options) {
    const imported = await super.importScripts(scripts, options);
    await this.#persist();
    return imported;
  }

  async createHistory(input) {
    const entry = await super.createHistory(input);
    await this.#persist();
    return entry;
  }

  async clearHistory() {
    const cleared = await super.clearHistory();
    await this.#persist();
    return cleared;
  }

  async createMacro(input) {
    const macro = await super.createMacro(input);
    await this.#persist();
    return macro;
  }

  async updateMacro(id, input) {
    const macro = await super.updateMacro(id, input);
    if (macro) await this.#persist();
    return macro;
  }

  async deleteMacro(id) {
    const macro = await super.deleteMacro(id);
    if (macro) await this.#persist();
    return macro;
  }

  async importMacros(macros, options) {
    const imported = await super.importMacros(macros, options);
    await this.#persist();
    return imported;
  }

  async createMacroHistory(input) {
    const entry = await super.createMacroHistory(input);
    await this.#persist();
    return entry;
  }

  async clearMacroHistory() {
    const cleared = await super.clearMacroHistory();
    await this.#persist();
    return cleared;
  }

  async createMacroSchedule(input) {
    const schedule = await super.createMacroSchedule(input);
    await this.#persist();
    return schedule;
  }

  async updateMacroSchedule(id, input) {
    const schedule = await super.updateMacroSchedule(id, input);
    if (schedule) await this.#persist();
    return schedule;
  }

  async deleteMacroSchedule(id) {
    const schedule = await super.deleteMacroSchedule(id);
    if (schedule) await this.#persist();
    return schedule;
  }

  async markMacroScheduleTriggered(id, input) {
    const schedule = await super.markMacroScheduleTriggered(id, input);
    if (schedule) await this.#persist();
    return schedule;
  }

  async #hydrate() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.scripts) || !Array.isArray(parsed.history)) {
        throw new Error("The store must contain scripts and history arrays.");
      }
      this.scripts = structuredClone(parsed.scripts);
      this.history = structuredClone(parsed.history);
      // Version 1 desktop libraries did not have macro collections. Treat them
      // as an empty library rather than rejecting a user's existing data.
      this.macros = Array.isArray(parsed.macros) ? structuredClone(parsed.macros) : [];
      this.macroHistory = Array.isArray(parsed.macroHistory) ? structuredClone(parsed.macroHistory) : [];
      this.macroSchedules = Array.isArray(parsed.macroSchedules)
        ? structuredClone(parsed.macroSchedules)
        : [];
    } catch (error) {
      if (error?.code === "ENOENT") {
        await this.#persist();
        return;
      }
      throw new Error(`Could not read the desktop script library: ${error.message}`);
    }
  }

  async #persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const data = JSON.stringify(
      {
        version: 2,
        scripts: this.scripts,
        history: this.history,
        macros: this.macros,
        macroHistory: this.macroHistory,
        macroSchedules: this.macroSchedules,
      },
      null,
      2,
    );
    await writeFile(temporaryPath, data, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

export class PostgresStore {
  kind = "postgres";

  constructor(pool) {
    this.pool = pool;
  }

  static async connect(databaseUrl) {
    const shouldUseSsl =
      process.env.DATABASE_SSL === "true" || /[?&]sslmode=require(?:&|$)/i.test(databaseUrl);
    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      await pool.end();
      throw new Error(`Could not connect to PostgreSQL using DATABASE_URL: ${error.message}`);
    }
    return new PostgresStore(pool);
  }

  async listScripts({ search = "" } = {}) {
    const needle = search.trim();
    const result = needle
      ? await this.pool.query(
          `SELECT ${SCRIPT_COLUMNS} FROM scripts
           WHERE name ILIKE $1 OR hotkey ILIKE $1
           ORDER BY updated_at DESC, name ASC`,
          [`%${needle}%`],
        )
      : await this.pool.query(
          `SELECT ${SCRIPT_COLUMNS} FROM scripts ORDER BY updated_at DESC, name ASC`,
        );
    return result.rows.map(serializeScript);
  }

  async getScript(id) {
    const result = await this.pool.query(
      `SELECT ${SCRIPT_COLUMNS} FROM scripts WHERE id = $1`,
      [id],
    );
    return result.rowCount ? serializeScript(result.rows[0]) : null;
  }

  async createScript(input) {
    await this.#assertHotkeyAvailable(this.pool, input.hotkey);
    const result = await this.pool.query(
      `INSERT INTO scripts (name, body, hotkey, characters_per_second, start_delay_ms)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${SCRIPT_COLUMNS}`,
      [
        input.name,
        input.body,
        input.hotkey,
        input.charactersPerSecond,
        input.startDelayMs,
      ],
    );
    return serializeScript(result.rows[0]);
  }

  async updateScript(id, input) {
    const existing = await this.getScript(id);
    if (!existing) {
      return null;
    }
    await this.#assertHotkeyAvailable(this.pool, input.hotkey, id);
    const result = await this.pool.query(
      `UPDATE scripts
       SET name = $1,
           body = $2,
           hotkey = $3,
           characters_per_second = $4,
           start_delay_ms = $5
       WHERE id = $6
       RETURNING ${SCRIPT_COLUMNS}`,
      [
        input.name,
        input.body,
        input.hotkey,
        input.charactersPerSecond,
        input.startDelayMs,
        id,
      ],
    );
    return serializeScript(result.rows[0]);
  }

  async deleteScript(id) {
    const result = await this.pool.query(
      `DELETE FROM scripts WHERE id = $1 RETURNING ${SCRIPT_COLUMNS}`,
      [id],
    );
    return result.rowCount ? serializeScript(result.rows[0]) : null;
  }

  async importScripts(scripts, { mode }) {
    assertImportHasUniqueHotkeys(scripts);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (mode === "merge") {
        const hotkeys = scripts.map((script) => script.hotkey);
        const duplicate = await client.query(
          `SELECT hotkey FROM scripts WHERE lower(hotkey) = ANY($1::text[]) LIMIT 1`,
          [hotkeys],
        );
        if (duplicate.rowCount) {
          throw hotkeyConflict(duplicate.rows[0].hotkey);
        }
      } else {
        await client.query("DELETE FROM scripts");
      }

      const created = [];
      for (const script of scripts) {
        const result = await client.query(
          `INSERT INTO scripts (name, body, hotkey, characters_per_second, start_delay_ms)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${SCRIPT_COLUMNS}`,
          [
            script.name,
            script.body,
            script.hotkey,
            script.charactersPerSecond,
            script.startDelayMs,
          ],
        );
        created.push(serializeScript(result.rows[0]));
      }
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listHistory({ limit }) {
    const result = await this.pool.query(
      `SELECT ${HISTORY_COLUMNS} FROM execution_history
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(serializeHistory);
  }

  async createHistory(input) {
    const result = await this.pool.query(
      `INSERT INTO execution_history (script_id, script_name, hotkey, started_at, duration_ms, status)
       SELECT id, name, hotkey, $2, $3, $4 FROM scripts WHERE id = $1
       RETURNING ${HISTORY_COLUMNS}`,
      [input.scriptId, input.startedAt, input.durationMs, input.status],
    );
    if (!result.rowCount) {
      throw new ApiError(404, "The script for this execution no longer exists.");
    }
    return serializeHistory(result.rows[0]);
  }

  async clearHistory() {
    const result = await this.pool.query(
      `WITH deleted AS (DELETE FROM execution_history RETURNING 1)
       SELECT count(*)::int AS cleared FROM deleted`,
    );
    return result.rows[0].cleared;
  }

  async listMacros({ search = "", folder = "", tag = "" } = {}) {
    const conditions = [];
    const values = [];
    const add = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    const needle = search.trim();
    if (needle) {
      const parameter = add(`%${needle}%`);
      conditions.push(`(name ILIKE ${parameter} OR hotkey ILIKE ${parameter})`);
    }
    if (folder.trim()) {
      conditions.push(`lower(folder) = lower(${add(folder.trim())})`);
    }
    if (tag.trim()) {
      conditions.push(
        `EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS macro_tag(value)
          WHERE lower(macro_tag.value) = lower(${add(tag.trim())}))`,
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query(
      `SELECT ${MACRO_COLUMNS} FROM macros ${where} ORDER BY updated_at DESC, name ASC`,
      values,
    );
    return result.rows.map(serializeMacro);
  }

  async getMacro(id) {
    const result = await this.pool.query(
      `SELECT ${MACRO_COLUMNS} FROM macros WHERE id = $1`,
      [id],
    );
    return result.rowCount ? serializeMacro(result.rows[0]) : null;
  }

  async createMacro(input) {
    await this.#assertMacroHotkeyAvailable(this.pool, input.hotkey);
    const result = await this.pool.query(
      `INSERT INTO macros (
         name, hotkey, folder, tags, steps, characters_per_second, start_delay_ms,
         click_interval_ms, repeat_config, boundary, focus_trigger, mail_merge
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb)
       RETURNING ${MACRO_COLUMNS}`,
      [
        input.name,
        input.hotkey,
        input.folder,
        JSON.stringify(input.tags),
        JSON.stringify(input.steps),
        input.charactersPerSecond,
        input.startDelayMs,
        input.clickIntervalMs,
        JSON.stringify(input.repeat),
        input.boundary ? JSON.stringify(input.boundary) : null,
        input.focusTrigger ? JSON.stringify(input.focusTrigger) : null,
        input.mailMerge ? JSON.stringify(input.mailMerge) : null,
      ],
    );
    return serializeMacro(result.rows[0]);
  }

  async updateMacro(id, input) {
    const existing = await this.getMacro(id);
    if (!existing) return null;
    await this.#assertMacroHotkeyAvailable(this.pool, input.hotkey, id);
    const result = await this.pool.query(
      `UPDATE macros SET
         name = $1,
         hotkey = $2,
         folder = $3,
         tags = $4::jsonb,
         steps = $5::jsonb,
         characters_per_second = $6,
         start_delay_ms = $7,
         click_interval_ms = $8,
         repeat_config = $9::jsonb,
         boundary = $10::jsonb,
         focus_trigger = $11::jsonb,
         mail_merge = $12::jsonb
       WHERE id = $13
       RETURNING ${MACRO_COLUMNS}`,
      [
        input.name,
        input.hotkey,
        input.folder,
        JSON.stringify(input.tags),
        JSON.stringify(input.steps),
        input.charactersPerSecond,
        input.startDelayMs,
        input.clickIntervalMs,
        JSON.stringify(input.repeat),
        input.boundary ? JSON.stringify(input.boundary) : null,
        input.focusTrigger ? JSON.stringify(input.focusTrigger) : null,
        input.mailMerge ? JSON.stringify(input.mailMerge) : null,
        id,
      ],
    );
    return serializeMacro(result.rows[0]);
  }

  async deleteMacro(id) {
    const result = await this.pool.query(
      `DELETE FROM macros WHERE id = $1 RETURNING ${MACRO_COLUMNS}`,
      [id],
    );
    return result.rowCount ? serializeMacro(result.rows[0]) : null;
  }

  async importMacros(macros, { mode }) {
    assertImportHasUniqueMacroHotkeys(macros);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (mode === "merge") {
        for (const macro of macros) {
          await this.#assertMacroHotkeyAvailable(client, macro.hotkey);
        }
      } else {
        await client.query("DELETE FROM macros");
      }
      const created = [];
      for (const macro of macros) {
        const result = await client.query(
          `INSERT INTO macros (
             name, hotkey, folder, tags, steps, characters_per_second, start_delay_ms,
             click_interval_ms, repeat_config, boundary, focus_trigger, mail_merge
           ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb)
           RETURNING ${MACRO_COLUMNS}`,
          [
            macro.name,
            macro.hotkey,
            macro.folder,
            JSON.stringify(macro.tags),
            JSON.stringify(macro.steps),
            macro.charactersPerSecond,
            macro.startDelayMs,
            macro.clickIntervalMs,
            JSON.stringify(macro.repeat),
            macro.boundary ? JSON.stringify(macro.boundary) : null,
            macro.focusTrigger ? JSON.stringify(macro.focusTrigger) : null,
            macro.mailMerge ? JSON.stringify(macro.mailMerge) : null,
          ],
        );
        created.push(serializeMacro(result.rows[0]));
      }
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMacroHistory({ limit, macroId = null } = {}) {
    const result = macroId
      ? await this.pool.query(
          `SELECT ${MACRO_HISTORY_COLUMNS} FROM macro_execution_history
           WHERE macro_id = $1 ORDER BY started_at DESC LIMIT $2`,
          [macroId, limit],
        )
      : await this.pool.query(
          `SELECT ${MACRO_HISTORY_COLUMNS} FROM macro_execution_history
           ORDER BY started_at DESC LIMIT $1`,
          [limit],
        );
    return result.rows.map(serializeMacroHistory);
  }

  async createMacroHistory(input) {
    const result = await this.pool.query(
      `INSERT INTO macro_execution_history (
         macro_id, macro_name, hotkey, started_at, duration_ms, status,
         steps_completed, time_saved_ms, error_message
       )
       SELECT id, name, hotkey, $2, $3, $4, $5, $6, $7 FROM macros WHERE id = $1
       RETURNING ${MACRO_HISTORY_COLUMNS}`,
      [
        input.macroId,
        input.startedAt,
        input.durationMs,
        input.status,
        input.stepsCompleted,
        input.timeSavedMs,
        input.errorMessage,
      ],
    );
    if (!result.rowCount) {
      throw new ApiError(404, "The macro for this execution no longer exists.");
    }
    return serializeMacroHistory(result.rows[0]);
  }

  async clearMacroHistory() {
    const result = await this.pool.query(
      `WITH deleted AS (DELETE FROM macro_execution_history RETURNING 1)
       SELECT count(*)::int AS cleared FROM deleted`,
    );
    return result.rows[0].cleared;
  }

  async getMacroAnalytics() {
    const result = await this.pool.query(
      `SELECT ${MACRO_HISTORY_COLUMNS} FROM macro_execution_history ORDER BY started_at DESC LIMIT 10000`,
    );
    return calculateMacroAnalytics(result.rows.map(serializeMacroHistory));
  }

  async listMacroSchedules({ macroId = null } = {}) {
    const result = macroId
      ? await this.pool.query(
          `SELECT ${MACRO_SCHEDULE_COLUMNS} FROM macro_schedules
           WHERE macro_id = $1 ORDER BY COALESCE(next_run_at, created_at), created_at`,
          [macroId],
        )
      : await this.pool.query(
          `SELECT ${MACRO_SCHEDULE_COLUMNS} FROM macro_schedules
           ORDER BY COALESCE(next_run_at, created_at), created_at`,
        );
    return result.rows.map(serializeMacroSchedule);
  }

  async getMacroSchedule(id) {
    const result = await this.pool.query(
      `SELECT ${MACRO_SCHEDULE_COLUMNS} FROM macro_schedules WHERE id = $1`,
      [id],
    );
    return result.rowCount ? serializeMacroSchedule(result.rows[0]) : null;
  }

  async createMacroSchedule(input) {
    const macro = await this.getMacro(input.macroId);
    if (!macro) throw new ApiError(404, "The macro for this schedule no longer exists.");
    const nextRunAt = input.enabled ? (input.type === "once" ? input.runAt : input.startsAt) : null;
    const result = await this.pool.query(
      `INSERT INTO macro_schedules (
         macro_id, schedule_type, enabled, run_at, starts_at, interval_ms, next_run_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MACRO_SCHEDULE_COLUMNS}`,
      [
        input.macroId,
        input.type,
        input.enabled,
        input.runAt,
        input.startsAt,
        input.intervalMs,
        nextRunAt,
      ],
    );
    return serializeMacroSchedule(result.rows[0]);
  }

  async updateMacroSchedule(id, input) {
    const existing = await this.getMacroSchedule(id);
    if (!existing) return null;
    const macro = await this.getMacro(input.macroId);
    if (!macro) throw new ApiError(404, "The macro for this schedule no longer exists.");
    const nextRunAt = input.enabled ? (input.type === "once" ? input.runAt : input.startsAt) : null;
    const result = await this.pool.query(
      `UPDATE macro_schedules SET
         macro_id = $1,
         schedule_type = $2,
         enabled = $3,
         run_at = $4,
         starts_at = $5,
         interval_ms = $6,
         next_run_at = $7
       WHERE id = $8
       RETURNING ${MACRO_SCHEDULE_COLUMNS}`,
      [
        input.macroId,
        input.type,
        input.enabled,
        input.runAt,
        input.startsAt,
        input.intervalMs,
        nextRunAt,
        id,
      ],
    );
    return serializeMacroSchedule(result.rows[0]);
  }

  async deleteMacroSchedule(id) {
    const result = await this.pool.query(
      `DELETE FROM macro_schedules WHERE id = $1 RETURNING ${MACRO_SCHEDULE_COLUMNS}`,
      [id],
    );
    return result.rowCount ? serializeMacroSchedule(result.rows[0]) : null;
  }

  async markMacroScheduleTriggered(id, { triggeredAt }) {
    const existing = await this.getMacroSchedule(id);
    if (!existing) return null;
    const isOneShot = existing.type === "once";
    const nextRunAt = !existing.enabled || isOneShot
      ? null
      : new Date(new Date(triggeredAt).getTime() + existing.intervalMs).toISOString();
    const result = await this.pool.query(
      `UPDATE macro_schedules SET
         enabled = CASE WHEN schedule_type = 'once' THEN false ELSE enabled END,
         last_run_at = $1,
         next_run_at = $2
       WHERE id = $3
       RETURNING ${MACRO_SCHEDULE_COLUMNS}`,
      [triggeredAt, nextRunAt, id],
    );
    return serializeMacroSchedule(result.rows[0]);
  }

  async close() {
    await this.pool.end();
  }

  async #assertHotkeyAvailable(queryable, hotkey, ignoredId = null) {
    const result = ignoredId
      ? await queryable.query(
          `SELECT id FROM scripts WHERE lower(hotkey) = lower($1) AND id <> $2 LIMIT 1`,
          [hotkey, ignoredId],
        )
      : await queryable.query(
          `SELECT id FROM scripts WHERE lower(hotkey) = lower($1) LIMIT 1`,
          [hotkey],
        );
    if (result.rowCount) {
      throw hotkeyConflict(hotkey);
    }
  }

  async #assertMacroHotkeyAvailable(queryable, hotkey, ignoredId = null) {
    const result = ignoredId
      ? await queryable.query(
          `SELECT id FROM macros WHERE lower(hotkey) = lower($1) AND id <> $2 LIMIT 1`,
          [hotkey, ignoredId],
        )
      : await queryable.query(
          `SELECT id FROM macros WHERE lower(hotkey) = lower($1) LIMIT 1`,
          [hotkey],
        );
    if (result.rowCount) throw macroHotkeyConflict(hotkey);
  }
}

export async function createStore({
  databaseUrl = process.env.DATABASE_URL,
  dataFile = process.env.AUTOTYPER_DATA_FILE,
} = {}) {
  if (databaseUrl) {
    return PostgresStore.connect(databaseUrl);
  }
  if (dataFile) {
    return FileStore.open(dataFile);
  }
  return new MemoryStore();
}
