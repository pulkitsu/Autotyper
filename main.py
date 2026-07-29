from __future__ import annotations

import ctypes
import sys

from PySide6.QtWidgets import QApplication

from gui import App


def configure_windows() -> None:
    if sys.platform != "win32":
        return
    dpi_configured = False
    try:
        dpi_configured = bool(
            ctypes.windll.user32.SetProcessDpiAwarenessContext(
                ctypes.c_void_p(-4)  # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            )
        )
    except (AttributeError, OSError):
        pass
    if not dpi_configured:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except (AttributeError, OSError):
            pass
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
            "PulkitSulekh.AutoTyperStudio.2"
        )
    except (AttributeError, OSError):
        pass


def main() -> None:
    configure_windows()
    application = QApplication(sys.argv)
    application.setApplicationName("AutoTyper Studio")
    application.setApplicationDisplayName("AutoTyper Studio")
    application.setOrganizationName("Pulkit Sulekh")
    application.setStyle("Fusion")
    window = App()
    window.show()
    raise SystemExit(application.exec())


if __name__ == "__main__":
    main()
