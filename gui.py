import tkinter as tk
from tkinter import ttk, scrolledtext
from typer import Typer
from hotkeys import register, unregister_all
from config import load, save

class App:
    def __init__(self, root):
        self.root = root
        self.root.title("AutoTyper")
        self.root.resizable(False, False)
        self.root.geometry("460x560")

        self.typer = Typer()
        self.typer.on_status = self._on_status
        self.typer.on_progress = self._on_progress
        self.typer.on_done = self._on_done

        self.settings = load()
        self._build_ui()
        self._load_settings_into_ui()
        self._register_hotkeys()

    def _build_ui(self):
        # --- Text area ---
        tk.Label(self.root, text="Text to type (auto-syncs from clipboard)", anchor="w").pack(fill="x", padx=12, pady=(12, 2))
        self.text_box = tk.Text(self.root, height=6, font=("Courier", 10), wrap="word")
        self.text_box.pack(fill="x", padx=12)

        self.root.bind("<FocusIn>", self._sync_clipboard)

        # --- Timing ---
        timing_frame = tk.LabelFrame(self.root, text="Timing", padx=8, pady=6)
        timing_frame.pack(fill="x", padx=12, pady=8)

        tk.Label(timing_frame, text="Char delay (ms)").grid(row=0, column=0, sticky="w")
        self.char_delay = tk.IntVar()
        tk.Spinbox(timing_frame, from_=1, to=5000, textvariable=self.char_delay, width=8).grid(row=0, column=1, padx=8)

        tk.Label(timing_frame, text="Repeat delay (ms)").grid(row=0, column=2, sticky="w")
        self.repeat_delay = tk.IntVar()
        tk.Spinbox(timing_frame, from_=0, to=30000, textvariable=self.repeat_delay, width=8).grid(row=0, column=3, padx=8)

        tk.Label(timing_frame, text="Repeat count").grid(row=1, column=0, sticky="w", pady=(6,0))
        self.repeat_count = tk.IntVar()
        tk.Spinbox(timing_frame, from_=1, to=9999, textvariable=self.repeat_count, width=8).grid(row=1, column=1, padx=8, pady=(6,0))

        tk.Label(timing_frame, text="Startup delay (ms)").grid(row=1, column=2, sticky="w", pady=(6,0))
        self.startup_delay = tk.IntVar()
        tk.Spinbox(timing_frame, from_=100, to=10000, textvariable=self.startup_delay, width=8).grid(row=1, column=3, padx=8, pady=(6,0))

        # --- Hotkeys ---
        hk_frame = tk.LabelFrame(self.root, text="Hotkeys", padx=8, pady=6)
        hk_frame.pack(fill="x", padx=12, pady=(0, 8))

        fkeys = [f"F{i}" for i in range(1, 13)]

        tk.Label(hk_frame, text="Start key").grid(row=0, column=0, sticky="w")
        self.start_key = tk.StringVar()
        ttk.Combobox(hk_frame, textvariable=self.start_key, values=fkeys, width=6, state="readonly").grid(row=0, column=1, padx=8)
        self.start_key.trace_add("write", lambda *_: self._register_hotkeys())

        tk.Label(hk_frame, text="Stop key").grid(row=0, column=2, sticky="w")
        self.stop_key = tk.StringVar()
        ttk.Combobox(hk_frame, textvariable=self.stop_key, values=fkeys, width=6, state="readonly").grid(row=0, column=3, padx=8)
        self.stop_key.trace_add("write", lambda *_: self._register_hotkeys())

        # --- Progress bar ---
        self.progress = ttk.Progressbar(self.root, mode="determinate", maximum=100)
        self.progress.pack(fill="x", padx=12, pady=(0, 4))

        # --- Status label ---
        self.status_var = tk.StringVar(value="Ready — copy any text and press F6")
        tk.Label(self.root, textvariable=self.status_var, anchor="w",
                 fg="gray").pack(fill="x", padx=14)

        # --- Buttons ---
        btn_frame = tk.Frame(self.root)
        btn_frame.pack(fill="x", padx=12, pady=8)

        self.start_btn = tk.Button(btn_frame, text="▶  Start", width=14,
                                   bg="#185FA5", fg="white", relief="flat",
                                   command=self._start)
        self.start_btn.pack(side="left", padx=(0, 6))

        self.stop_btn = tk.Button(btn_frame, text="■  Stop", width=10,
                                  relief="flat", state="disabled",
                                  command=self._stop)
        self.stop_btn.pack(side="left", padx=(0, 6))

        tk.Button(btn_frame, text="Save settings", relief="flat",
                  command=self._save_settings).pack(side="right")

        # --- Log ---
        tk.Label(self.root, text="Log", anchor="w").pack(fill="x", padx=12)
        self.log = scrolledtext.ScrolledText(self.root, height=5, state="disabled",
                                             font=("Courier", 9), bg="#f5f5f5")
        self.log.pack(fill="x", padx=12, pady=(2, 12))

    def _sync_clipboard(self, event=None):
        try:
            clipboard = self.root.clipboard_get()
            if clipboard:
                self.text_box.delete("1.0", "end")
                self.text_box.insert("1.0", clipboard)
                self.status_var.set("Clipboard loaded — press F6 to start")
        except tk.TclError:
            pass

    def _load_settings_into_ui(self):
        s = self.settings
        self.text_box.insert("1.0", s["text"])
        self.char_delay.set(s["char_delay_ms"])
        self.repeat_delay.set(s["repeat_delay_ms"])
        self.repeat_count.set(s["repeat_count"])
        self.startup_delay.set(s["startup_delay_ms"])
        self.start_key.set(s["start_key"])
        self.stop_key.set(s["stop_key"])

    def _collect_settings(self):
        return {
            "text": self.text_box.get("1.0", "end-1c"),
            "char_delay_ms": self.char_delay.get(),
            "repeat_delay_ms": self.repeat_delay.get(),
            "repeat_count": self.repeat_count.get(),
            "startup_delay_ms": self.startup_delay.get(),
            "start_key": self.start_key.get(),
            "stop_key": self.stop_key.get(),
        }

    def _save_settings(self):
        save(self._collect_settings())
        self._log("Settings saved.")

    def _register_hotkeys(self):
        try:
            register(
                self.start_key.get(),
                self.stop_key.get(),
                on_start=self._start,
                on_stop=self._stop
            )
        except Exception as e:
            self._log(f"Hotkey error: {e}")

    def _start(self):
        self._sync_clipboard()
        if self.typer.running:
            return
        s = self._collect_settings()
        self.progress["value"] = 0
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self._log("Starting — switch to target window...")
        self.typer.start(
            text=s["text"],
            char_delay_ms=s["char_delay_ms"],
            repeat_delay_ms=s["repeat_delay_ms"],
            repeat_count=s["repeat_count"],
            startup_delay_ms=s["startup_delay_ms"]
        )

    def _stop(self):
        self.typer.stop()
        self._log("Stop requested.")

    def _on_status(self, msg):
        self.root.after(0, lambda: self.status_var.set(msg))
        self.root.after(0, lambda: self._log(msg))

    def _on_progress(self, current, total):
        pct = (current / total) * 100
        self.root.after(0, lambda: self.progress.configure(value=pct))

    def _on_done(self):
        self.root.after(0, self._reset_buttons)

    def _reset_buttons(self):
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.status_var.set("Done — copy new text and press F6 again")

    def _log(self, msg):
        self.log.config(state="normal")
        self.log.insert("end", f"{msg}\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        unregister_all()
        self.root.destroy()