import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import { DEFAULT_SCRIPTS } from "./seed-data.js";
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

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

function assertImportHasUniqueHotkeys(scripts) {
  const hotkeys = new Set();
  for (const script of scripts) {
    if (hotkeys.has(script.hotkey)) {
      throw importDuplicateConflict(script.hotkey);
    }
    hotkeys.add(script.hotkey);
  }
}

function clone(value) {
  return structuredClone(value);
}

/**
 * A non-persistent convenience store for local UI work. It is used only when
 * DATABASE_URL is absent, so a production configuration cannot silently lose data.
 */
export class MemoryStore {
  kind = "memory";

  constructor(seed = DEFAULT_SCRIPTS) {
    const now = new Date().toISOString();
    this.scripts = seed.map((script) => ({
      id: randomUUID(),
      ...script,
      createdAt: now,
      updatedAt: now,
    }));
    this.history = [];
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

  async close() {}

  #assertHotkeyAvailable(hotkey, ignoredId = null) {
    const duplicate = this.scripts.find(
      (entry) => entry.hotkey === hotkey && entry.id !== ignoredId,
    );
    if (duplicate) {
      throw hotkeyConflict(hotkey);
    }
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
}

export async function createStore({ databaseUrl = process.env.DATABASE_URL } = {}) {
  if (!databaseUrl) {
    return new MemoryStore();
  }
  return PostgresStore.connect(databaseUrl);
}
