from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from models import AppSettings


APP_DIRECTORY = "AutoTyperStudio"
SETTINGS_FILENAME = "settings.json"


def default_settings_path() -> Path:
    override = os.environ.get("AUTOTYPER_CONFIG_DIR")
    if override:
        return Path(override).expanduser() / SETTINGS_FILENAME

    if sys.platform == "win32":
        root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if root:
            return Path(root) / APP_DIRECTORY / SETTINGS_FILENAME
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIRECTORY / SETTINGS_FILENAME

    config_home = os.environ.get("XDG_CONFIG_HOME")
    root = Path(config_home).expanduser() if config_home else Path.home() / ".config"
    return root / APP_DIRECTORY.lower() / SETTINGS_FILENAME


def default_legacy_settings_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / SETTINGS_FILENAME
    return Path(__file__).resolve().parent / SETTINGS_FILENAME


class SettingsStore:
    def __init__(
        self,
        path: Path | None = None,
        legacy_path: Path | None = None,
    ) -> None:
        self.path = path or default_settings_path()
        self.legacy_path = legacy_path
        self.warning = ""

    def load(self) -> AppSettings:
        source = self.path
        migrated = False
        if not source.exists() and self.legacy_path and self.legacy_path.exists():
            source = self.legacy_path
            migrated = True
        if not source.exists():
            return AppSettings()

        try:
            raw: Any = json.loads(source.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("settings root must be an object")
            settings = AppSettings.from_dict(raw)
            if migrated:
                self.save(settings)
            return settings
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
            self.warning = f"Could not load settings: {exc}"
            return AppSettings()

    def save(self, settings: AppSettings) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        payload = json.dumps(settings.to_dict(), ensure_ascii=False, indent=2)
        temporary.write_text(payload + "\n", encoding="utf-8")
        os.replace(temporary, self.path)


def load() -> dict[str, Any]:
    """Compatibility helper for integrations using the original API."""
    return SettingsStore(legacy_path=Path.cwd() / SETTINGS_FILENAME).load().to_dict()


def save(settings: dict[str, Any]) -> None:
    """Compatibility helper for integrations using the original API."""
    SettingsStore().save(AppSettings.from_dict(settings))
