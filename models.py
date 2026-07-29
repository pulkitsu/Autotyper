from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
from uuid import uuid4


SETTINGS_VERSION = 2
VALID_THEMES = {"light", "dark", "glass"}


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


@dataclass
class Snippet:
    id: str = field(default_factory=lambda: uuid4().hex)
    name: str = "Untitled snippet"
    text: str = ""
    hotkey: str = ""
    char_delay_ms: int = 45
    jitter_ms: int = 15
    punctuation_pause_ms: int = 120
    startup_delay_ms: int = 3000
    repeat_count: int = 1
    repeat_delay_ms: int = 500

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Snippet":
        return cls(
            id=str(data.get("id") or uuid4().hex),
            name=str(data.get("name") or "Untitled snippet")[:80],
            text=str(data.get("text") or ""),
            hotkey=str(data.get("hotkey") or "").strip().lower()[:80],
            char_delay_ms=_bounded_int(data.get("char_delay_ms"), 45, 0, 5000),
            jitter_ms=_bounded_int(data.get("jitter_ms"), 15, 0, 2500),
            punctuation_pause_ms=_bounded_int(
                data.get("punctuation_pause_ms"), 120, 0, 10000
            ),
            startup_delay_ms=_bounded_int(
                data.get("startup_delay_ms"), 3000, 0, 60000
            ),
            repeat_count=_bounded_int(data.get("repeat_count"), 1, 1, 10000),
            repeat_delay_ms=_bounded_int(
                data.get("repeat_delay_ms"), 500, 0, 600000
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def welcome_snippet() -> Snippet:
    return Snippet(
        name="Welcome",
        hotkey="ctrl+alt+1",
        text=(
            "AutoTyper Studio is ready.{ENTER}"
            "Edit this snippet, choose a typing rhythm, then press Ctrl+Alt+1."
        ),
    )


@dataclass
class AppSettings:
    version: int = SETTINGS_VERSION
    snippets: list[Snippet] = field(default_factory=lambda: [welcome_snippet()])
    selected_snippet_id: str = ""
    pause_hotkey: str = "f8"
    stop_hotkey: str = "f7"
    window_geometry: str = "1180x760"
    theme: str = "glass"

    def __post_init__(self) -> None:
        if not self.snippets:
            self.snippets = [welcome_snippet()]
        valid_ids = {snippet.id for snippet in self.snippets}
        if self.selected_snippet_id not in valid_ids:
            self.selected_snippet_id = self.snippets[0].id
        if self.theme not in VALID_THEMES:
            self.theme = "glass"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppSettings":
        if "snippets" not in data:
            return cls.from_legacy_dict(data)

        raw_snippets = data.get("snippets")
        snippets = (
            [Snippet.from_dict(item) for item in raw_snippets if isinstance(item, dict)]
            if isinstance(raw_snippets, list)
            else []
        )
        return cls(
            version=SETTINGS_VERSION,
            snippets=snippets or [welcome_snippet()],
            selected_snippet_id=str(data.get("selected_snippet_id") or ""),
            pause_hotkey=str(data.get("pause_hotkey") or "f8").strip().lower(),
            stop_hotkey=str(data.get("stop_hotkey") or "f7").strip().lower(),
            window_geometry=str(data.get("window_geometry") or "1180x760"),
            theme=str(data.get("theme") or "glass").strip().lower(),
        )

    @classmethod
    def from_legacy_dict(cls, data: dict[str, Any]) -> "AppSettings":
        snippet = Snippet.from_dict(
            {
                "name": "Imported snippet",
                "text": data.get("text", ""),
                "hotkey": data.get("start_key", "f6"),
                "char_delay_ms": data.get("char_delay_ms", 50),
                "startup_delay_ms": data.get("startup_delay_ms", 1000),
                "repeat_count": data.get("repeat_count", 1),
                "repeat_delay_ms": data.get("repeat_delay_ms", 500),
            }
        )
        return cls(
            snippets=[snippet],
            selected_snippet_id=snippet.id,
            stop_hotkey=str(data.get("stop_key") or "f7").strip().lower(),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": SETTINGS_VERSION,
            "snippets": [snippet.to_dict() for snippet in self.snippets],
            "selected_snippet_id": self.selected_snippet_id,
            "pause_hotkey": self.pause_hotkey,
            "stop_hotkey": self.stop_hotkey,
            "window_geometry": self.window_geometry,
            "theme": self.theme,
        }

    def selected_snippet(self) -> Snippet:
        for snippet in self.snippets:
            if snippet.id == self.selected_snippet_id:
                return snippet
        self.selected_snippet_id = self.snippets[0].id
        return self.snippets[0]
