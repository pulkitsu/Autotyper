import unittest

from script_parser import ActionKind, action_units, parse_script


class ScriptParserTests(unittest.TestCase):
    def test_parses_text_keys_waits_and_hotkeys(self):
        actions = parse_script("Hello{ENTER}{WAIT 250}{CTRL+SHIFT+V}")

        self.assertEqual(
            [action.kind for action in actions],
            [ActionKind.TEXT, ActionKind.KEY, ActionKind.WAIT, ActionKind.HOTKEY],
        )
        self.assertEqual(actions[1].value, "enter")
        self.assertEqual(actions[2].duration_ms, 250)
        self.assertEqual(actions[3].value, "ctrl+shift+v")
        self.assertEqual(action_units(actions), 7)

    def test_unknown_tokens_remain_literal_text(self):
        actions = parse_script("Use {customer_name} here")

        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].value, "Use {customer_name} here")

    def test_double_braces_escape_literal_braces(self):
        actions = parse_script("JSON: {{\"ok\": true}}")

        self.assertEqual(actions[0].value, 'JSON: {"ok": true}')

    def test_unclosed_brace_remains_literal(self):
        actions = parse_script("function {")

        self.assertEqual(actions[0].value, "function {")


if __name__ == "__main__":
    unittest.main()
