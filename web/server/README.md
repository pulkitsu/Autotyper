# AutoTyper API

The API uses PostgreSQL whenever `DATABASE_URL` is set. When it is intentionally
absent, the server runs a visibly non-persistent in-memory store seeded with the
same three sample scripts as `database/seed.sql`; this is useful for frontend
development only.

## Required packages

The web workspace package manifest should include:

```text
express
pg
cors
dotenv
```

The server modules use ESM, so its package manifest needs `"type": "module"`.

## Local PostgreSQL

```powershell
cd web
docker compose up -d postgres
Copy-Item .env.example .env
node server/migrate.js
node server/index.js
```

The Compose initialization scripts set up the schema and seed automatically on a
new database volume. `server/migrate.js` is safe to run again after that.

## API contract

- `GET /api/scripts?search=` — `{ scripts }`
- `POST /api/scripts` — `{ script }`
- `GET|PUT|DELETE /api/scripts/:id` — `{ script }` for reads/updates, `204` for delete
- `GET /api/scripts/export` — `{ version, exportedAt, scripts }`
- `POST /api/scripts/import` — accepts the export payload plus optional `mode` of
  `merge` (default) or `replace`
- `GET /api/history?limit=` — `{ history }`
- `POST /api/history` — accepts `{ scriptId, startedAt?, durationMs, status }`, returns `{ entry }`
- `DELETE /api/history` — `{ cleared }`

All persisted JSON fields are camelCase: `charactersPerSecond`, `startDelayMs`,
`createdAt`, `updatedAt`, and history `startedAt` / `status`. The server canonicalizes
hotkeys and enforces a case-insensitive unique binding in both validation and PostgreSQL.
