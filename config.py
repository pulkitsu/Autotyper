import json
import os

CONFIG_FILE = "settings.json"

DEFAULTS = {
    "text": "",
    "char_delay_ms": 50,
    "repeat_delay_ms": 500,
    "repeat_count": 1,
    "startup_delay_ms": 1000,
    "start_key": "F6",
    "stop_key": "F7"
}

def load():
    if not os.path.exists(CONFIG_FILE):
        return DEFAULTS.copy()
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        return {**DEFAULTS, **data}
    except Exception:
        return DEFAULTS.copy()

def save(settings: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(settings, f, indent=2)