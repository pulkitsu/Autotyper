# Auto Typer — browser and desktop

A full-stack, browser-safe take on MurGee Auto Typer. It keeps the original
utility-software feel—a dense `List of Auto Texts` grid, compact record editor,
and status strip—while providing a browser `Target Window` instead of trying to
send keystrokes to another operating-system process.

The same current React interface can also be opened as a native Windows desktop
application through Electron. It is not the repository's older PySide app: it
uses this exact script library, editor, simulator, history, and theme UI.

## Stack

- React 19 + Vite single-page application
- Node.js + Express API
- PostgreSQL 16 (schema, seed data, and Docker Compose included)
- A deliberately marked in-memory store for quick frontend development only
- Node's built-in test runner; no test framework dependency
- Electron + Electron Builder for the optional native Windows desktop build

## Features

- Script library with search, add, edit, delete, and app-wide hotkey filtering
- Hotkey recorder with canonicalization, browser-reserved shortcut protection,
  and whole-library duplicate detection
- Configurable characters-per-second and initial delay
- Character-by-character target-window simulation with pause, resume, and stop
- `{Tab}`, `{Enter}`, and `{Space}` special keys, plus `{Backspace}`,
  `{Delete}`, arrow keys, `{Home}`, `{End}`, and `{Wait 500}`
- Execution history with start timestamp, run duration, and completion/stopped status
- PostgreSQL-backed import/export JSON, dark theme, Unicode/grapheme-safe text,
  and responsive layouts

## Run locally

Requirements: Node.js 20+ and npm. Docker Desktop is needed only for the
PostgreSQL path.

### Fast UI demo (seeded, non-persistent data)

Open two terminals in this directory:

```powershell
npm install
npm run dev:api
```

```powershell
npm run dev
```

Open `http://localhost:5173`. With `DATABASE_URL` unset, the API makes its
non-persistent seeded store explicit in the startup message. This is convenient
for trying the UI, but it is not the production configuration.

### Native Windows desktop app

From this `web` directory, run the current React app in a native desktop
window:

```powershell
npm install
npm run desktop
```

Electron builds the client, starts an internal loopback-only service on a
random port, and opens the same UI in a Windows window. Its scripts and history
are persisted locally in Electron's user-data folder as `library.json`; this is
separate from the browser development server and PostgreSQL library.

To create a portable Windows executable:

```powershell
npm run desktop:package
```

The output is `desktop-dist/AutoTyper-Desktop-1.0.0-portable.exe`. It is a
generated, ignored artifact; run it directly on Windows x64 without Node.js.
`npm run desktop:dir` creates an unpacked build for troubleshooting.

### PostgreSQL development setup

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run migrate
npm run dev:api
```

In another terminal:

```powershell
npm run dev
```

The supplied Compose setup creates the `autotyper` database, executes
`database/schema.sql`, and seeds three scripts automatically on first start.
`npm run migrate` is safe to run again after that.

## Production build and deployment

```powershell
npm run build
npm start
```

`npm start` serves the Vite build and API from one Express process. Set
`DATABASE_URL` to a managed PostgreSQL connection string for Render, Railway,
or another Node host; set `DATABASE_SSL=true` if that provider requires TLS.
For a Render/Railway service, use `npm install && npm run build` as the build
command and `npm start` as the start command, with `web` as the root directory.

## Database design

`scripts` owns reusable typing definitions:

| Column | Purpose |
| --- | --- |
| `id` | UUID primary key |
| `name`, `body` | User-facing comment and script text |
| `hotkey` | Canonical shortcut, enforced unique case-insensitively |
| `characters_per_second`, `start_delay_ms` | Per-script timing settings |
| `created_at`, `updated_at` | Audit timestamps |

`execution_history` stores immutable run snapshots. It retains the script name
and hotkey even if the source script is later renamed or deleted; `script_id`
uses `ON DELETE SET NULL` for that reason. Indexes support hotkey uniqueness,
recent scripts, and recent run history.

## Script tokens and typing semantics

The parser is case-insensitive:

| Token | Target Window behavior |
| --- | --- |
| `{Tab}` | Inserts a tab character |
| `{Enter}` | Inserts a line break |
| `{Space}` | Inserts one space |
| `{Backspace}`, `{Delete}` | Edit around the current target cursor/selection |
| `{Left}`, `{Right}`, `{Up}`, `{Down}`, `{Home}`, `{End}` | Move the target cursor |
| `{Wait 500}` | Pauses the simulation for 500 ms |
| `{{` and `}}` | Type literal braces |

Unknown or unclosed brace tokens are intentionally typed as ordinary text, so
templates such as `Hello {customer_name}` stay safe. Text is segmented into
user-perceived graphemes, preventing emoji and combining characters from being
split across simulated keystrokes.

## Assumptions and browser boundary

- The assignment's “Target Window” is modeled as the dedicated textarea in the
  SPA. The browser and Electron desktop companion intentionally simulate typing
  there rather than sending real keystrokes to another operating-system app.
- Hotkeys work while focus is anywhere **inside Auto Typer**. The UI calls out
  this boundary and rejects browser/OS-reserved shortcuts.
- There is one default user and no authentication, as requested.
- The target starts at its own current caret/selection and remains editable by
  the user during simulation.

## Verification

```powershell
npm test
npm run build
```

The test suite covers parsing, Unicode and brace escaping, target-text edits,
hotkey normalization/conflicts, and REST persistence/history flows.
