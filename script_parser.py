from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class ActionKind(str, Enum):
    TEXT = "text"
    KEY = "key"
    HOTKEY = "hotkey"
    WAIT = "wait"


@dataclass(frozen=True)
class Action:
    kind: ActionKind
    value: str = ""
    duration_ms: int = 0


KEY_NAMES = {
    "BACKSPACE": "backspace",
    "DELETE": "delete",
    "DOWN": "down",
    "END": "end",
    "ENTER": "enter",
    "ESC": "esc",
    "ESCAPE": "esc",
    "HOME": "home",
    "LEFT": "left",
    "PAGEDOWN": "pagedown",
    "PAGEUP": "pageup",
    "RIGHT": "right",
    "SPACE": "space",
    "TAB": "tab",
    "UP": "up",
    **{f"F{number}": f"f{number}" for number in range(1, 25)},
}
MODIFIERS = {"ALT", "CTRL", "CONTROL", "SHIFT", "WIN", "WINDOWS"}
WAIT_PATTERN = re.compile(r"^WAIT(?:\s+|:)(\d{1,7})$", re.IGNORECASE)


def _append_text(actions: list[Action], text: str) -> None:
    if not text:
        return
    if actions and actions[-1].kind is ActionKind.TEXT:
        previous = actions[-1]
        actions[-1] = Action(ActionKind.TEXT, previous.value + text)
    else:
        actions.append(Action(ActionKind.TEXT, text))


def _parse_token(token: str) -> Action | None:
    normalized = token.strip().upper()
    if normalized in KEY_NAMES:
        return Action(ActionKind.KEY, KEY_NAMES[normalized])

    wait_match = WAIT_PATTERN.fullmatch(normalized)
    if wait_match:
        return Action(ActionKind.WAIT, duration_ms=int(wait_match.group(1)))

    parts = [part.strip().upper() for part in normalized.split("+")]
    if len(parts) >= 2 and all(parts) and all(part in MODIFIERS for part in parts[:-1]):
        aliases = {
            "CONTROL": "ctrl",
            "CTRL": "ctrl",
            "WINDOWS": "windows",
            "WIN": "windows",
            "ALT": "alt",
            "SHIFT": "shift",
        }
        final = KEY_NAMES.get(parts[-1], parts[-1].lower())
        return Action(
            ActionKind.HOTKEY,
            "+".join([aliases[part] for part in parts[:-1]] + [final]),
        )
    return None


def parse_script(script: str) -> list[Action]:
    """Parse AutoTyper tokens while leaving unknown braces as ordinary text."""
    actions: list[Action] = []
    index = 0
    while index < len(script):
        if script.startswith("{{", index):
            _append_text(actions, "{")
            index += 2
            continue
        if script.startswith("}}", index):
            _append_text(actions, "}")
            index += 2
            continue
        if script[index] != "{":
            next_open = script.find("{", index)
            next_close = script.find("}}", index)
            candidates = [position for position in (next_open, next_close) if position >= 0]
            end = min(candidates) if candidates else len(script)
            _append_text(actions, script[index:end])
            index = end
            continue

        close = script.find("}", index + 1)
        if close < 0:
            _append_text(actions, script[index:])
            break
        token_text = script[index + 1 : close]
        action = _parse_token(token_text)
        if action is None:
            _append_text(actions, script[index : close + 1])
        else:
            actions.append(action)
        index = close + 1
    return actions


def action_units(actions: list[Action]) -> int:
    return sum(
        len(action.value) if action.kind is ActionKind.TEXT else 1
        for action in actions
        if action.kind is not ActionKind.WAIT
    )


def describe_tokens() -> str:
    return (
        "Tokens: {ENTER}  {TAB}  {WAIT 500}  {CTRL+ENTER}  "
        "{UP}/{DOWN}. Use {{ for a literal brace."
    )
