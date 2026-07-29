import json
import tempfile
import unittest
from pathlib import Path

from config import SettingsStore
from models import AppSettings, Snippet


class SettingsTests(unittest.TestCase):
    def test_round_trip_preserves_unicode_and_snippets(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            snippet = Snippet(name="नमस्ते", text="Hello 🌍", hotkey="ctrl+alt+2")
            original = AppSettings(
                snippets=[snippet],
                selected_snippet_id=snippet.id,
                pause_hotkey="f9",
                theme="light",
            )

            store = SettingsStore(path=path)
            store.save(original)
            loaded = store.load()

            self.assertEqual(loaded.snippets[0].name, "नमस्ते")
            self.assertEqual(loaded.snippets[0].text, "Hello 🌍")
            self.assertEqual(loaded.pause_hotkey, "f9")
            self.assertEqual(loaded.theme, "light")
            self.assertFalse(path.with_suffix(".tmp").exists())

    def test_load_migrates_legacy_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = root / "legacy.json"
            destination = root / "new" / "settings.json"
            legacy.write_text(
                json.dumps(
                    {
                        "text": "legacy",
                        "char_delay_ms": 25,
                        "start_key": "F6",
                        "stop_key": "F7",
                    }
                ),
                encoding="utf-8",
            )

            loaded = SettingsStore(path=destination, legacy_path=legacy).load()

            self.assertEqual(loaded.snippets[0].text, "legacy")
            self.assertEqual(loaded.snippets[0].hotkey, "f6")
            self.assertEqual(loaded.stop_hotkey, "f7")
            self.assertTrue(destination.exists())

    def test_invalid_settings_fall_back_with_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text("{bad json", encoding="utf-8")
            store = SettingsStore(path=path)

            loaded = store.load()

            self.assertTrue(loaded.snippets)
            self.assertIn("Could not load settings", store.warning)


if __name__ == "__main__":
    unittest.main()
