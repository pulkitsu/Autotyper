import threading
import time
import pyautogui

pyautogui.FAILSAFE = True  # move mouse to top-left corner to abort

class Typer:
    def __init__(self):
        self.running = False
        self._stop_flag = False
        self._thread = None
        self.on_status = None    # callback(msg: str)
        self.on_progress = None  # callback(current: int, total: int)
        self.on_done = None      # callback()

    def start(self, text, char_delay_ms, repeat_delay_ms, repeat_count, startup_delay_ms=1000):
        if self.running:
            return
        self._stop_flag = False
        self._thread = threading.Thread(
            target=self._loop,
            args=(text, char_delay_ms, repeat_delay_ms, repeat_count, startup_delay_ms),
            daemon=True
        )
        self._thread.start()

    def stop(self):
        self._stop_flag = True

    def _loop(self, text, char_delay_ms, repeat_delay_ms, repeat_count, startup_delay_ms):
        self.running = True
        self._notify_status(f"Waiting {startup_delay_ms}ms — switch windows now...")
        time.sleep(startup_delay_ms / 1000)

        total_chars = len(text) * repeat_count
        done = 0

        for rep in range(repeat_count):
            if self._stop_flag:
                break
            self._notify_status(f"Typing repeat {rep + 1} of {repeat_count}...")

            for ch in text:
                if self._stop_flag:
                    break
                if ch == '\n':
                    pyautogui.press('enter')
                else:
                    pyautogui.typewrite(ch, interval=0)
                time.sleep(char_delay_ms / 1000)
                done += 1
                self._notify_progress(done, total_chars)

            if not self._stop_flag and rep < repeat_count - 1:
                time.sleep(repeat_delay_ms / 1000)

        self.running = False
        self._notify_status("Stopped." if self._stop_flag else "Done.")
        if self.on_done:
            self.on_done()

    def _notify_status(self, msg):
        if self.on_status:
            self.on_status(msg)

    def _notify_progress(self, current, total):
        if self.on_progress:
            self.on_progress(current, total)