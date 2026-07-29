from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Protocol

from script_parser import Action, ActionKind, action_units, parse_script


class EngineState(str, Enum):
    IDLE = "idle"
    COUNTDOWN = "countdown"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"


class InputBackend(Protocol):
    def write_character(self, character: str) -> None: ...

    def press(self, key: str) -> None: ...

    def hotkey(self, shortcut: str) -> None: ...


class KeyboardBackend:
    """System keyboard backend, imported lazily so the core remains testable."""

    def __init__(self, keyboard_module=None) -> None:
        if keyboard_module is None:
            try:
                import keyboard as keyboard_module
            except ImportError as exc:
                raise RuntimeError(
                    "The 'keyboard' package is missing. "
                    "Run: pip install -r requirements.txt"
                ) from exc
        self._keyboard = keyboard_module

    def write_character(self, character: str) -> None:
        # Exact mode preserves case and enables Unicode without using the clipboard.
        self._keyboard.write(character, delay=0, exact=True)

    def press(self, key: str) -> None:
        self._keyboard.press_and_release(key)

    def hotkey(self, shortcut: str) -> None:
        self._keyboard.press_and_release(shortcut)


@dataclass(frozen=True)
class TypingOptions:
    char_delay_ms: int = 45
    jitter_ms: int = 15
    punctuation_pause_ms: int = 120
    startup_delay_ms: int = 3000
    repeat_count: int = 1
    repeat_delay_ms: int = 500

    def validate(self) -> None:
        ranges = {
            "Character delay": (self.char_delay_ms, 0, 5000),
            "Jitter": (self.jitter_ms, 0, 2500),
            "Punctuation pause": (self.punctuation_pause_ms, 0, 10000),
            "Countdown": (self.startup_delay_ms, 0, 60000),
            "Repeat count": (self.repeat_count, 1, 10000),
            "Repeat delay": (self.repeat_delay_ms, 0, 600000),
        }
        for label, (value, minimum, maximum) in ranges.items():
            if not minimum <= value <= maximum:
                raise ValueError(f"{label} must be between {minimum} and {maximum}.")


def estimate_duration_ms(text: str, options: TypingOptions) -> int:
    actions = parse_script(text)
    text_chars = sum(
        len(action.value) for action in actions if action.kind is ActionKind.TEXT
    )
    punctuation = sum(
        1
        for action in actions
        if action.kind is ActionKind.TEXT
        for character in action.value
        if character in ".,!?;:"
    )
    scripted_waits = sum(
        action.duration_ms for action in actions if action.kind is ActionKind.WAIT
    )
    per_repeat = (
        text_chars * options.char_delay_ms
        + punctuation * options.punctuation_pause_ms
        + scripted_waits
    )
    return (
        options.startup_delay_ms
        + per_repeat * options.repeat_count
        + options.repeat_delay_ms * max(0, options.repeat_count - 1)
    )


class TypingEngine:
    def __init__(
        self,
        backend: InputBackend | None = None,
        rng: random.Random | None = None,
    ) -> None:
        self._backend = backend
        self._rng = rng or random.Random()
        self._state = EngineState.IDLE
        self._state_lock = threading.RLock()
        self._stop_event = threading.Event()
        self._active_event = threading.Event()
        self._active_event.set()
        self._thread: threading.Thread | None = None

        self.on_state: Callable[[EngineState, str], None] | None = None
        self.on_progress: Callable[[int, int], None] | None = None
        self.on_done: Callable[[str], None] | None = None
        self.on_error: Callable[[Exception], None] | None = None

    @property
    def state(self) -> EngineState:
        with self._state_lock:
            return self._state

    @property
    def running(self) -> bool:
        return self.state is not EngineState.IDLE

    def start(self, text: str, options: TypingOptions) -> bool:
        options.validate()
        if not text:
            raise ValueError("Enter some text before starting.")
        actions = parse_script(text)
        if not actions:
            raise ValueError("The script does not contain any typing actions.")

        with self._state_lock:
            if self._state is not EngineState.IDLE:
                return False
            self._stop_event.clear()
            self._active_event.set()
            self._state = (
                EngineState.COUNTDOWN
                if options.startup_delay_ms
                else EngineState.RUNNING
            )
            self._thread = threading.Thread(
                target=self._run,
                args=(actions, options),
                daemon=True,
                name="autotyper-engine",
            )
            self._thread.start()
        return True

    def toggle_pause(self) -> EngineState:
        with self._state_lock:
            if self._state is EngineState.RUNNING:
                self._state = EngineState.PAUSED
                self._active_event.clear()
                self._notify_state("Paused")
            elif self._state is EngineState.PAUSED:
                self._state = EngineState.RUNNING
                self._active_event.set()
                self._notify_state("Typing")
            return self._state

    def stop(self) -> None:
        with self._state_lock:
            if self._state is EngineState.IDLE:
                return
            self._state = EngineState.STOPPING
            self._stop_event.set()
            self._active_event.set()
            self._notify_state("Stopping")

    def join(self, timeout: float | None = None) -> bool:
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout)
        return not thread or not thread.is_alive()

    def _run(self, actions: list[Action], options: TypingOptions) -> None:
        outcome = "completed"
        try:
            backend = self._backend or KeyboardBackend()
            self._backend = backend
            total = action_units(actions) * options.repeat_count
            completed = 0
            self._notify_progress(completed, total)

            if options.startup_delay_ms:
                self._notify_state(
                    f"Starting in {options.startup_delay_ms / 1000:g}s — focus the target"
                )
                if not self._wait(options.startup_delay_ms / 1000):
                    outcome = "stopped"
                    return

            self._set_state(EngineState.RUNNING, "Typing")

            def advance() -> None:
                nonlocal completed
                completed += 1
                self._notify_progress(completed, total)

            for repeat_index in range(options.repeat_count):
                if self._stop_event.is_set():
                    outcome = "stopped"
                    break
                for action in actions:
                    if not self._execute_action(action, options, backend, advance):
                        outcome = "stopped"
                        break
                if outcome == "stopped":
                    break
                if repeat_index < options.repeat_count - 1:
                    self._notify_state(
                        f"Repeat {repeat_index + 1}/{options.repeat_count} complete"
                    )
                    if not self._wait(options.repeat_delay_ms / 1000):
                        outcome = "stopped"
                        break
        except Exception as exc:
            outcome = "error"
            if self.on_error:
                self.on_error(exc)
        finally:
            with self._state_lock:
                self._state = EngineState.IDLE
            self._notify_state("Stopped" if outcome == "stopped" else "Ready")
            if self.on_done:
                self.on_done(outcome)

    def _execute_action(
        self,
        action: Action,
        options: TypingOptions,
        backend: InputBackend,
        advance: Callable[[], None],
    ) -> bool:
        if action.kind is ActionKind.WAIT:
            return self._wait(action.duration_ms / 1000)
        if not self._wait_until_active():
            return False
        if action.kind is ActionKind.KEY:
            backend.press(action.value)
            advance()
            return True
        if action.kind is ActionKind.HOTKEY:
            backend.hotkey(action.value)
            advance()
            return True

        for character in action.value:
            if not self._wait_until_active():
                return False
            if character in "\r\n":
                backend.press("enter")
            elif character == "\t":
                backend.press("tab")
            else:
                backend.write_character(character)
            advance()
            delay_ms = max(
                0,
                options.char_delay_ms
                + self._rng.uniform(-options.jitter_ms, options.jitter_ms),
            )
            if character in ".,!?;:":
                delay_ms += options.punctuation_pause_ms
            if not self._wait(delay_ms / 1000):
                return False
        return True

    def _wait_until_active(self) -> bool:
        while not self._stop_event.is_set():
            if self._active_event.wait(0.05):
                return True
        return False

    def _wait(self, seconds: float) -> bool:
        remaining = max(0.0, seconds)
        while remaining > 0:
            if not self._wait_until_active():
                return False
            started = time.monotonic()
            if self._stop_event.wait(min(0.05, remaining)):
                return False
            remaining -= time.monotonic() - started
        return not self._stop_event.is_set()

    def _set_state(self, state: EngineState, message: str) -> None:
        with self._state_lock:
            if self._state is EngineState.STOPPING:
                return
            self._state = state
        self._notify_state(message)

    def _notify_state(self, message: str) -> None:
        if self.on_state:
            self.on_state(self.state, message)

    def _notify_progress(self, current: int, total: int) -> None:
        if self.on_progress:
            self.on_progress(current, total)


Typer = TypingEngine
