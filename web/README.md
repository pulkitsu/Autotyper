# Auto Typer — browser and desktop

A full-stack, browser-safe take on MurGee Auto Typer. It keeps the original
utility-software feel—a dense Macro Library grid, compact record editor, and
status strip—while providing a visual `Target Canvas` instead of trying to send
keystrokes or clicks to another operating-system process.

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

- Macro Library with create/edit/delete, search by name or hotkey, and folders
  and tags for large collections
- Ordered `Type Text`, `Click`, `Move`, `Wait`, and nested `Loop` steps;
  duplicate/delete/reorder controls and undo/redo while editing
- Hotkey recorder with canonicalization, browser-reserved shortcut protection,
  and whole-library duplicate detection
- Configurable characters-per-second, startup delay, click interval, repeat
  count/continuous/duration modes, and a 10-clicks/second runaway safeguard
- Character-by-character Target Canvas playback with pause/resume, a visible
  current macro, `Esc` kill switch, and optional click/move boundary
- `{Tab}`, `{Enter}`, and `{Space}` special keys, plus `{Backspace}`,
  `{Delete}`, arrows, `{Home}`, `{End}`, and `{Wait 500}`
- Variables: `{date}`, `{time}`, `{counter}`, `{clipboard}`, and CSV-driven
  `{csv:ColumnName}` mail merge; a completed run advances to the next row
- Canvas record mode for local typing/click capture, schedules while the local
  app is open, run history, time-saved insight, and most-used macro analytics
- PostgreSQL/FileStore-backed import/export JSON, dark theme,
  Unicode/grapheme-safe text, and responsive layouts

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
non-persistent seeded store explicit in the startup message. It starts with
three safe example macros, which makes it convenient for trying the UI, but it
is not the durable configuration.

### Native Windows desktop app

From this `web` directory, run the current React app in a native desktop
window:

```powershell
npm install
npm run desktop
```

Electron builds the client, starts an internal loopback-only service on a
random port, and opens the same UI in a Windows window. Its macro library,
schedules, and history are persisted locally in Electron's user-data folder as
`library.json`; this is separate from the browser development server and
PostgreSQL library. The renderer is sandboxed, has no Node bridge, blocks new
windows/navigation, and denies browser permission requests.

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

## Local production build

```powershell
npm run build
npm start
```

`npm start` serves the Vite build and API from one Express process. Set
`DATABASE_URL` to a PostgreSQL connection string for durable local data; set
`DATABASE_SSL=true` only when your local database requires TLS. This project is
designed to run locally—deployment is not required.

## Database design

Legacy `scripts` owns reusable one-text typing definitions retained for import
compatibility. The Macro Library uses the richer tables below:

| Column | Purpose |
| --- | --- |
| `macros.id`, `name`, `hotkey` | UUID, display name, and case-insensitive unique macro binding |
| `folder`, `tags` | Organization metadata (`tags` is JSONB) |
| `steps`, `repeat_config` | Ordered JSONB step document and bounded repeat policy |
| `boundary`, `focus_trigger`, `mail_merge` | Safety area, future desktop focus rule, and CSV state |
| `macro_execution_history` | Immutable macro-name/hotkey snapshots, result, duration, steps, and time saved |
| `macro_schedules` | One-shot/interval configuration plus server-owned next-run bookkeeping |

Both history tables retain a name and hotkey snapshot even if their source is
deleted. Indexes cover hotkey uniqueness, recent runs, folder lookup, and due
schedules.

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

## Macro steps, variables, and safety

`Type Text` steps resolve `{date}`, `{time}`, `{counter}`, `{clipboard}`, and
`{csv:ColumnName}` before special-key parsing. Unknown variables stay literal;
a missing CSV column is reported in the plan rather than executed as code.
CSV import accepts quoted cells and advances without wrapping, so each
successful invocation uses the next row until the dataset is exhausted.

Click and Move steps are visual only in the Target Canvas. Their coordinates
are clamped when a boundary is enabled. The runner enforces at least 100 ms
between clicks (10 clicks/second), caps expanded loop plans, and can be stopped
at any time with the visible Kill switch or `Esc`.

## Assumptions and browser boundary

- The assignment's target is modeled as the dedicated Target Canvas in the
  SPA. The browser and Electron desktop companion intentionally simulate typing
  and clicking there rather than sending real input to another operating-system
  app.
- Hotkeys work while focus is anywhere **inside Auto Typer**. The UI calls out
  this boundary and rejects browser/OS-reserved shortcuts.
- Schedules run only while the local app is open. Focus-specific bindings are
  stored as a desktop-ready rule, but are not yet wired to OS window detection.
- There is one default user and no authentication, as requested.
- The target starts at its own current caret/selection and remains editable by
  the user during simulation.
- Cloud sync/team libraries, encryption for sensitive macro contents, browser
  extension control, and true OS-wide typing/clicking are intentionally deferred
  to explicit opt-in integrations. They must not be inferred from the local
  simulator.

## Verification

```powershell
npm test
npm run build
```

The test suite covers parsing, Unicode and brace escaping, target-text edits,
hotkey normalization/conflicts, macro plan/loop/CSV/rate-limit behavior, and
REST persistence/history/schedule flows.
