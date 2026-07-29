import threading
import time
import unittest

from typer import (
    EngineState,
    KeyboardBackend,
    TypingEngine,
    TypingOptions,
    estimate_duration_ms,
)


class RecordingBackend:
    def __init__(self):
        self.actions = []
        self.lock = threading.Lock()

    def write_character(self, character):
        with self.lock:
            self.actions.append(("text", character))

    def press(self, key):
        with self.lock:
            self.actions.append(("key", key))

    def hotkey(self, shortcut):
        with self.lock:
            self.actions.append(("hotkey", shortcut))

    def count(self):
        with self.lock:
            return len(self.actions)


class TypingEngineTests(unittest.TestCase):
    def test_system_backend_uses_exact_mode_for_case_and_unicode(self):
        class FakeKeyboard:
            def __init__(self):
                self.calls = []

            def write(self, character, delay, exact):
                self.calls.append((character, delay, exact))

        keyboard = FakeKeyboard()
        backend = KeyboardBackend(keyboard_module=keyboard)

        backend.write_character("H")
        backend.write_character("न")

        self.assertEqual(keyboard.calls, [("H", 0, True), ("न", 0, True)])

    def test_executes_script_and_reports_completion(self):
        backend = RecordingBackend()
        engine = TypingEngine(backend=backend)
        completed = threading.Event()
        outcomes = []
        engine.on_done = lambda outcome: (outcomes.append(outcome), completed.set())

        started = engine.start(
            "Hi{ENTER}{CTRL+A}{WAIT 1}",
            TypingOptions(
                char_delay_ms=0,
                jitter_ms=0,
                punctuation_pause_ms=0,
                startup_delay_ms=0,
                repeat_delay_ms=0,
            ),
        )

        self.assertTrue(started)
        self.assertTrue(completed.wait(1))
        self.assertEqual(outcomes, ["completed"])
        self.assertEqual(
            backend.actions,
            [
                ("text", "H"),
                ("text", "i"),
                ("key", "enter"),
                ("hotkey", "ctrl+a"),
            ],
        )
        self.assertEqual(engine.state, EngineState.IDLE)

    def test_stop_interrupts_countdown(self):
        engine = TypingEngine(backend=RecordingBackend())
        completed = threading.Event()
        outcomes = []
        engine.on_done = lambda outcome: (outcomes.append(outcome), completed.set())
        engine.start("Never typed", TypingOptions(startup_delay_ms=5000))

        engine.stop()

        self.assertTrue(completed.wait(0.5))
        self.assertEqual(outcomes, ["stopped"])

    def test_pause_and_resume_halts_character_output(self):
        backend = RecordingBackend()
        engine = TypingEngine(backend=backend)
        completed = threading.Event()
        engine.on_done = lambda _outcome: completed.set()
        engine.start(
            "abcdefgh",
            TypingOptions(
                char_delay_ms=40,
                jitter_ms=0,
                punctuation_pause_ms=0,
                startup_delay_ms=0,
            ),
        )
        deadline = time.monotonic() + 0.5
        while backend.count() < 2 and time.monotonic() < deadline:
            time.sleep(0.005)

        self.assertEqual(engine.toggle_pause(), EngineState.PAUSED)
        time.sleep(0.08)
        paused_count = backend.count()
        time.sleep(0.12)
        self.assertEqual(backend.count(), paused_count)

        self.assertEqual(engine.toggle_pause(), EngineState.RUNNING)
        self.assertTrue(completed.wait(1))
        self.assertEqual(backend.count(), 8)

    def test_estimate_includes_repeats_waits_and_countdown(self):
        options = TypingOptions(
            char_delay_ms=10,
            jitter_ms=5,
            punctuation_pause_ms=100,
            startup_delay_ms=1000,
            repeat_count=2,
            repeat_delay_ms=500,
        )

        estimate = estimate_duration_ms("Hi!{WAIT 250}", options)

        self.assertEqual(estimate, 2260)


if __name__ == "__main__":
    unittest.main()
