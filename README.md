# AutoTyper — local macro automation for web and desktop

The current implementation is the React + Express + PostgreSQL application in
[web/README.md](web/README.md). It is a MurGee-inspired macro utility with an
ordered Macro Library, a visual Target Canvas, local history/insights, JSON
portability, schedules, and a safety-first recorder. It runs locally in a
browser or as the same standalone Windows desktop UI through Electron:

```powershell
cd web
npm install
npm run desktop
```

Build the portable desktop executable with `npm run desktop:package`; it is
written to `web/desktop-dist/` and keeps its own persistent local macro
library. The older PySide desktop project below remains preserved as a separate
predecessor/reference, not as the current desktop UI.

The current macro tool safely simulates all pointer and keyboard actions inside
its Target Canvas. True OS-wide input, cloud/team sync, browser extensions, and
encrypted shared vaults are deliberately future milestones rather than hidden
behavior in a local build.

The original Windows PySide desktop project remains below as a separate,
preserved predecessor/reference.

## AutoTyper Studio (desktop predecessor)

AutoTyper Studio is a Windows-first desktop app for safe, repeatable text entry.
It combines reusable snippets, per-snippet global shortcuts, natural timing,
Unicode input, and a small script language in one responsive interface.

## What makes version 2 different

- **Snippet library:** Save any number of named typing scripts and assign each
  one its own global shortcut.
- **Interruptible controls:** Pause, resume, or stop during typing, countdowns,
  scripted waits, and delays between repeats.
- **Natural rhythm:** Configure the base delay, random jitter, and an extra
  pause after punctuation for every snippet.
- **Unicode input:** Type non-English text without silently replacing it with
  unsupported characters.
- **Action tokens:** Mix text with keys, waits, and shortcuts.
- **Portable libraries:** Import or export every snippet and setting as JSON.
- **Safer clipboard behavior:** Clipboard text is loaded only when you click
  the button; focusing the app never destroys an edit.
- **Durable settings:** Atomic, UTF-8 settings are stored in the user's local
  application-data folder instead of beside the executable.
- **Native Windows glass:** The interface uses Windows Acrylic/Mica composition
  with genuinely translucent Qt panels instead of a painted blur imitation.
- **Three persistent themes:** Switch between Light, Dark, and live
  background-reactive Glass from the icon-only title-bar control.
- **Clear timing controls:** Every numeric field uses aligned red decrease and
  green increase buttons with the unit shown in its field label.
- **Release discipline:** The repository includes automated engine, parser,
  migration, and Windows packaging checks.

The goal is to beat the core MurGee Auto Typer workflow with a modern, reusable
library and stronger run controls. OCR and general mouse automation are
deliberately outside this app's scope.

## Script tokens

Tokens are case-insensitive and can appear anywhere in a snippet:

| Token | Result |
| --- | --- |
| `{ENTER}`, `{TAB}`, `{ESC}` | Press a special key |
| `{UP}`, `{DOWN}`, `{LEFT}`, `{RIGHT}` | Press an arrow key |
| `{WAIT 750}` | Wait for 750 milliseconds |
| `{CTRL+ENTER}`, `{CTRL+SHIFT+V}` | Press a key combination |
| `{{` or `}}` | Type a literal opening or closing brace |

Unknown tokens such as `{customer_name}` are typed literally, so ordinary
templates and code do not break unexpectedly.

## Run from source

Requirements:

- Windows 10 or 11
- Python 3.10+

```powershell
git clone https://github.com/pulkitsu/Autotyper.git
cd Autotyper
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python main.py
```

Global keyboard hooks can interact only with applications running at the same
or a lower Windows integrity level. If you need to type into an elevated app,
run AutoTyper Studio at the same level.

## Test and build

The core tests do not emit real keyboard input.

```powershell
python -m unittest discover -s tests -v
python -m pip install -r requirements-dev.txt
pyinstaller --clean --noconfirm main.spec
```

The folder-based package is created at
`dist/AutoTyperStudio/AutoTyperStudio.exe`. GitHub Actions runs the same tests
and publishes the unsigned Windows package as a workflow artifact. Production
releases should be Authenticode-signed before distribution.

## Safety

AutoTyper Studio types into whichever window is focused after the countdown.
Review every script, use a countdown while testing, and keep the Stop shortcut
available. The app does not submit forms or click buttons on its own.

## Copyright

Copyright © 2026 Pulkit Sulekh. All rights reserved. No license is granted to
use, modify, or distribute this software without explicit permission.
