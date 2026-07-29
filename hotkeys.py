from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any

from models import Snippet


class HotkeyError(ValueError):
    pass


def normalize(shortcut: str) -> str:
    return "+".join(part.strip().lower() for part in shortcut.split("+") if part.strip())


class HotkeyManager:
    def __init__(self, keyboard_module: Any | None = None) -> None:
        if keyboard_module is None:
            try:
                import keyboard as keyboard_module
            except ImportError as exc:
                raise RuntimeError(
                    "The 'keyboard' package is missing. Run: pip install -r requirements.txt"
                ) from exc
        self._keyboard = keyboard_module
        self._handles: list[Any] = []

    def configure(
        self,
        snippets: Iterable[Snippet],
        pause_hotkey: str,
        stop_hotkey: str,
        emit: Callable[[str, str], None],
    ) -> None:
        bindings: list[tuple[str, str, str, str]] = []
        for snippet in snippets:
            shortcut = normalize(snippet.hotkey)
            if shortcut:
                bindings.append((shortcut, "start", snippet.id, f"“{snippet.name}”"))
        bindings.extend(
            [
                (normalize(pause_hotkey), "pause", "", "Pause"),
                (normalize(stop_hotkey), "stop", "", "Stop"),
            ]
        )

        used: dict[str, str] = {}
        for shortcut, action, _payload, label in bindings:
            if not shortcut:
                raise HotkeyError(f"The {action} hotkey cannot be empty.")
            if shortcut in used:
                raise HotkeyError(
                    f"Hotkey '{shortcut}' is assigned to both {used[shortcut]} and {label}."
                )
            used[shortcut] = label

        new_handles: list[Any] = []
        try:
            for shortcut, action, payload, _label in bindings:
                handle = self._keyboard.add_hotkey(
                    shortcut,
                    lambda event=action, value=payload: emit(event, value),
                )
                new_handles.append(handle)
        except Exception as exc:
            for handle in new_handles:
                try:
                    self._keyboard.remove_hotkey(handle)
                except Exception:
                    pass
            raise HotkeyError(f"Could not register global hotkeys: {exc}") from exc

        self.unregister_all()
        self._handles = new_handles

    def unregister_all(self) -> None:
        for handle in self._handles:
            try:
                self._keyboard.remove_hotkey(handle)
            except Exception:
                pass
        self._handles.clear()


_legacy_manager: HotkeyManager | None = None


def register(start_key: str, stop_key: str, on_start: Callable, on_stop: Callable) -> None:
    global _legacy_manager
    _legacy_manager = _legacy_manager or HotkeyManager()
    snippet = Snippet(name="Current", hotkey=start_key)
    _legacy_manager.configure(
        [snippet],
        pause_hotkey="f8",
        stop_hotkey=stop_key,
        emit=lambda action, _payload: on_start() if action == "start" else on_stop(),
    )


def unregister_all() -> None:
    if _legacy_manager:
        _legacy_manager.unregister_all()
