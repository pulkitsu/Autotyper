import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from config import SettingsStore
from gui import App


class GlassGuiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.qt = QApplication.instance() or QApplication([])
        cls.qt.setStyle("Fusion")

    def test_glass_workspace_constructs_and_edits_library(self):
        with tempfile.TemporaryDirectory() as directory:
            store = SettingsStore(path=Path(directory) / "settings.json")
            window = App(store, initialize_hotkeys=False)
            window.show()
            self.qt.processEvents()

            self.assertEqual(window.windowTitle(), "AutoTyper Studio")
            self.assertEqual(window.snippet_list.count(), 1)
            self.assertEqual(window.theme, "glass")

            window.name_edit.setText("Glass greeting")
            window._duplicate_snippet()
            self.assertEqual(window.snippet_list.count(), 2)
            self.assertEqual(window.name_edit.text(), "Glass greeting copy")

            window.set_theme("dark")
            self.assertEqual(window.settings.theme, "dark")
            self.assertTrue(window.title_bar.theme_actions["dark"].isChecked())
            window.set_theme("light")
            self.assertEqual(window.settings.theme, "light")

            window.close()
            self.qt.processEvents()
            self.assertTrue(store.path.exists())


if __name__ == "__main__":
    unittest.main()
