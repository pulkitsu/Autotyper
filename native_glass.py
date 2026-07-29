from __future__ import annotations

import ctypes
import sys
from dataclasses import dataclass
from ctypes import wintypes


@dataclass(frozen=True)
class GlassResult:
    enabled: bool
    mode: str
    detail: str = ""


def abgr_color(red: int, green: int, blue: int, alpha: int) -> int:
    """Pack a Windows AccentPolicy color in AABBGGRR order."""
    channels = [max(0, min(255, int(value))) for value in (red, green, blue, alpha)]
    red, green, blue, alpha = channels
    return (alpha << 24) | (blue << 16) | (green << 8) | red


def apply_native_glass(
    window_handle: int,
    *,
    tint: tuple[int, int, int] = (28, 43, 46),
    opacity: int = 46,
) -> GlassResult:
    """Enable the best available Windows backdrop for a native window.

    Windows 11 prefers thin live Acrylic composition and falls back to the
    system Desktop Acrylic backdrop. Windows 10 receives Acrylic through
    WindowCompositionAttribute. Older systems fall back to DWM blur-behind.
    The Qt interface remains translucent if every native call is unavailable.
    """
    if sys.platform != "win32":
        return GlassResult(False, "Translucent", "Native blur is Windows-only.")

    hwnd = wintypes.HWND(int(window_handle))
    build = sys.getwindowsversion().build
    dwm = ctypes.windll.dwmapi
    user32 = ctypes.windll.user32

    _set_dwm_int(dwm, hwnd, 20, 1) or _set_dwm_int(dwm, hwnd, 19, 1)
    _set_dwm_int(dwm, hwnd, 33, 2)  # DWMWCP_ROUND
    if build >= 26100:
        # Qt supplies premultiplied alpha. Newer DWM builds otherwise ignore it
        # and treat the backing bitmap as opaque, hiding the live backdrop.
        _set_dwm_int(dwm, hwnd, 39, 1)  # DWMWA_REDIRECTIONBITMAP_ALPHA

    if build >= 22621:
        # Avoid stacking the heavier system luminosity layer over thin Acrylic.
        _set_dwm_int(dwm, hwnd, 38, 1)  # DWMSBT_NONE
    acrylic = _set_acrylic(
        user32,
        hwnd,
        abgr_color(tint[0], tint[1], tint[2], opacity),
    )
    if acrylic:
        mode = (
            "Windows 11 thin Acrylic"
            if build >= 22000
            else "Windows 10 Acrylic"
        )
        return GlassResult(True, mode)

    system_backdrop = False
    if build >= 22621:
        # Fall back to the supported Windows 11 Desktop Acrylic backdrop.
        system_backdrop = _set_dwm_int(dwm, hwnd, 38, 3)
    if system_backdrop:
        return GlassResult(True, "Windows 11 system backdrop")
    if _enable_dwm_blur(dwm, hwnd):
        return GlassResult(True, "DWM blur")
    return GlassResult(
        False,
        "Translucent",
        "Windows composition did not expose a blur backdrop.",
    )


def clear_native_glass(window_handle: int) -> None:
    """Remove native backdrop composition for opaque Light and Dark themes."""
    if sys.platform != "win32":
        return
    try:
        hwnd = wintypes.HWND(int(window_handle))
        build = sys.getwindowsversion().build
        dwm = ctypes.windll.dwmapi
        user32 = ctypes.windll.user32
        _set_accent_policy(user32, hwnd, 0, 0, 0)
        if build >= 22621:
            _set_dwm_int(dwm, hwnd, 38, 1)  # DWMSBT_NONE
        if build >= 26100:
            _set_dwm_int(dwm, hwnd, 39, 0)  # Ignore per-pixel alpha.
    except (AttributeError, OSError, ValueError):
        pass


def _set_dwm_int(dwm, hwnd: wintypes.HWND, attribute: int, value: int) -> bool:
    try:
        payload = ctypes.c_int(value)
        result = dwm.DwmSetWindowAttribute(
            hwnd,
            ctypes.c_uint(attribute),
            ctypes.byref(payload),
            ctypes.sizeof(payload),
        )
        return result == 0
    except (AttributeError, OSError, ValueError):
        return False


def _set_acrylic(user32, hwnd: wintypes.HWND, gradient_color: int) -> bool:
    return _set_accent_policy(user32, hwnd, 4, 2, gradient_color)


def _set_accent_policy(
    user32,
    hwnd: wintypes.HWND,
    state: int,
    flags: int,
    gradient_color: int,
) -> bool:
    class AccentPolicy(ctypes.Structure):
        _fields_ = [
            ("accent_state", ctypes.c_int),
            ("accent_flags", ctypes.c_int),
            ("gradient_color", ctypes.c_uint),
            ("animation_id", ctypes.c_int),
        ]

    class WindowCompositionAttributeData(ctypes.Structure):
        _fields_ = [
            ("attribute", ctypes.c_int),
            ("data", ctypes.c_void_p),
            ("size_of_data", ctypes.c_size_t),
        ]

    try:
        setter = user32.SetWindowCompositionAttribute
        setter.restype = wintypes.BOOL
        accent = AccentPolicy(
            state,
            flags,
            gradient_color,
            0,
        )
        data = WindowCompositionAttributeData(
            19,  # WCA_ACCENT_POLICY
            ctypes.cast(ctypes.byref(accent), ctypes.c_void_p),
            ctypes.sizeof(accent),
        )
        return bool(setter(hwnd, ctypes.byref(data)))
    except (AttributeError, OSError, ValueError):
        return False


def _enable_dwm_blur(dwm, hwnd: wintypes.HWND) -> bool:
    class DwmBlurBehind(ctypes.Structure):
        _fields_ = [
            ("flags", wintypes.DWORD),
            ("enable", wintypes.BOOL),
            ("blur_region", wintypes.HRGN),
            ("transition_on_maximized", wintypes.BOOL),
        ]

    try:
        blur = DwmBlurBehind(1, True, None, False)
        return dwm.DwmEnableBlurBehindWindow(hwnd, ctypes.byref(blur)) == 0
    except (AttributeError, OSError, ValueError):
        return False
