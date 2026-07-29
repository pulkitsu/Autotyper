import unittest

from native_glass import abgr_color


class NativeGlassTests(unittest.TestCase):
    def test_abgr_color_matches_windows_accent_layout(self):
        self.assertEqual(abgr_color(0x11, 0x22, 0x33, 0x44), 0x44332211)

    def test_abgr_color_clamps_channels(self):
        self.assertEqual(abgr_color(-1, 256, 3, 999), 0xFF03FF00)


if __name__ == "__main__":
    unittest.main()
