import unittest

from hotkeys import HotkeyError, HotkeyManager
from models import Snippet


class FakeKeyboard:
    def __init__(self):
        self.bindings = {}
        self.removed = []

    def add_hotkey(self, shortcut, callback):
        handle = f"handle-{len(self.bindings)}"
        self.bindings[handle] = (shortcut, callback)
        return handle

    def remove_hotkey(self, handle):
        self.removed.append(handle)
        self.bindings.pop(handle, None)


class HotkeyManagerTests(unittest.TestCase):
    def test_registers_snippet_and_safety_hotkeys(self):
        keyboard = FakeKeyboard()
        manager = HotkeyManager(keyboard_module=keyboard)
        events = []
        snippet = Snippet(name="Greeting", hotkey=" Ctrl + Alt + 1 ")

        manager.configure(
            [snippet],
            pause_hotkey="F8",
            stop_hotkey="F7",
            emit=lambda action, payload: events.append((action, payload)),
        )

        shortcuts = [binding[0] for binding in keyboard.bindings.values()]
        self.assertEqual(shortcuts, ["ctrl+alt+1", "f8", "f7"])
        keyboard.bindings["handle-0"][1]()
        self.assertEqual(events, [("start", snippet.id)])

    def test_rejects_duplicate_shortcuts_before_registration(self):
        keyboard = FakeKeyboard()
        manager = HotkeyManager(keyboard_module=keyboard)
        first = Snippet(name="First", hotkey="ctrl+1")
        second = Snippet(name="Second", hotkey="CTRL + 1")

        with self.assertRaisesRegex(HotkeyError, "both “First” and “Second”"):
            manager.configure(
                [first, second],
                pause_hotkey="f8",
                stop_hotkey="f7",
                emit=lambda *_: None,
            )

        self.assertFalse(keyboard.bindings)


if __name__ == "__main__":
    unittest.main()
