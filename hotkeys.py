import keyboard

_registered = []

def register(start_key, stop_key, on_start, on_stop):
    unregister_all()
    keyboard.add_hotkey(start_key, on_start)
    keyboard.add_hotkey(stop_key, on_stop)
    _registered.extend([start_key, stop_key])

def unregister_all():
    for key in _registered:
        try:
            keyboard.remove_hotkey(key)
        except Exception:
            pass
    _registered.clear()