from __future__ import annotations

import json
import queue
import re
from pathlib import Path

from PySide6.QtCore import QEvent, QPoint, QRectF, QTimer, Qt, Signal
from PySide6.QtGui import (
    QActionGroup,
    QColor,
    QCloseEvent,
    QFont,
    QIcon,
    QLinearGradient,
    QMouseEvent,
    QPainter,
    QPen,
    QPixmap,
    QShowEvent,
)
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QApplication,
    QFileDialog,
    QFrame,
    QGraphicsDropShadowEffect,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMenu,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QSizeGrip,
    QSpinBox,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from config import SettingsStore, default_legacy_settings_path
from hotkeys import HotkeyError, HotkeyManager
from models import VALID_THEMES, AppSettings, Snippet
from native_glass import GlassResult, apply_native_glass, clear_native_glass
from script_parser import describe_tokens
from typer import EngineState, TypingEngine, TypingOptions, estimate_duration_ms


WINDOW_GEOMETRY = re.compile(
    r"(?P<width>\d{3,5})x(?P<height>\d{3,5})"
    r"(?:(?P<x>[+-]\d+)(?P<y>[+-]\d+))?"
)


GLASS_STYLESHEET = """
* {
    color: #F7FAFF;
    font-family: "Segoe UI Variable Text", "Segoe UI";
    font-size: 10pt;
}

QWidget#windowCanvas {
    background: transparent;
}

QFrame#glassShell {
    background-color: rgba(13, 24, 28, 18);
    border: none;
    border-radius: 22px;
}

QFrame#titleBar {
    background: rgba(255, 255, 255, 8);
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 22);
    border-top-left-radius: 21px;
    border-top-right-radius: 21px;
}

QFrame#sidebarCard,
QFrame#glassCard,
QFrame#editorCard,
QFrame#runCard {
    background-color: rgba(239, 251, 252, 10);
    border: 1px solid rgba(255, 255, 255, 54);
    border-radius: 16px;
}

QFrame#sidebarCard {
    background-color: rgba(8, 24, 27, 28);
}

QFrame#editorCard {
    background-color: rgba(5, 13, 17, 24);
}

QFrame#runCard {
    background-color: rgba(234, 249, 250, 10);
}

QFrame#innerCard {
    background-color: rgba(2, 8, 12, 34);
    border: 1px solid rgba(255, 255, 255, 25);
    border-radius: 12px;
}

QLabel#brandMark {
    background: rgba(126, 106, 246, 215);
    border: 1px solid rgba(255, 255, 255, 64);
    border-radius: 14px;
    color: white;
    font-size: 10pt;
    font-weight: 700;
}

QLabel#windowTitle {
    color: rgba(255, 255, 255, 235);
    font-size: 10pt;
    font-weight: 600;
}

QLabel#glassBadge,
QLabel#platformBadge {
    background: rgba(113, 222, 229, 25);
    border: 1px solid rgba(113, 222, 229, 54);
    border-radius: 10px;
    color: #8CEAF0;
    font-size: 8pt;
    font-weight: 600;
    padding: 4px 9px;
}

QLabel#platformBadge {
    background: rgba(255, 255, 255, 13);
    border-color: rgba(255, 255, 255, 28);
    color: rgba(255, 255, 255, 175);
}

QLabel#pageTitle {
    font-family: "Segoe UI Variable Display", "Segoe UI";
    font-size: 24pt;
    font-weight: 650;
    color: rgba(255, 255, 255, 245);
}

QLabel#brandTitle {
    font-family: "Segoe UI Variable Display", "Segoe UI";
    font-size: 17pt;
    font-weight: 650;
}

QLabel#eyebrow {
    color: #8CEAF0;
    font-size: 8pt;
    font-weight: 650;
    letter-spacing: 1px;
}

QLabel#sectionTitle {
    color: rgba(255, 255, 255, 228);
    font-weight: 600;
}

QLabel#muted,
QLabel#hint,
QLabel#estimate,
QLabel#detail {
    color: rgba(220, 232, 240, 148);
}

QLabel#hint {
    font-size: 8.5pt;
}

QLabel#statusTitle {
    font-size: 10.5pt;
    font-weight: 650;
}

QLabel#statusTitle[tone="ready"] {
    color: #77E6BD;
}

QLabel#statusTitle[tone="warning"] {
    color: #F4D17A;
}

QLabel#statusTitle[tone="error"] {
    color: #FF8DA7;
}

QToolButton#windowButton {
    background: transparent;
    border: none;
    border-radius: 15px;
    color: rgba(255, 255, 255, 190);
    font-size: 11pt;
}

QToolButton#windowButton:hover {
    background: rgba(255, 255, 255, 22);
    color: white;
}

QToolButton#windowButton[kind="close"]:hover {
    background: rgba(232, 67, 86, 210);
}

QPushButton {
    min-height: 34px;
    padding: 0 14px;
    background: rgba(255, 255, 255, 14);
    border: 1px solid rgba(255, 255, 255, 35);
    border-radius: 10px;
    color: rgba(247, 250, 255, 225);
    font-weight: 550;
}

QPushButton:hover {
    background: rgba(255, 255, 255, 30);
    border-color: rgba(255, 255, 255, 62);
}

QPushButton:pressed {
    background: rgba(255, 255, 255, 14);
}

QPushButton[role="primary"] {
    min-height: 39px;
    padding: 0 20px;
    background: rgba(126, 99, 244, 226);
    border-color: rgba(188, 176, 255, 115);
    color: white;
    font-weight: 650;
}

QPushButton[role="primary"]:hover {
    background: rgba(143, 119, 255, 240);
    border-color: rgba(220, 214, 255, 160);
}

QPushButton[role="danger"] {
    color: #FF9BB1;
    background: rgba(166, 47, 76, 42);
    border-color: rgba(255, 126, 155, 42);
}

QPushButton:disabled {
    color: rgba(220, 230, 238, 65);
    background: rgba(255, 255, 255, 7);
    border-color: rgba(255, 255, 255, 12);
}

QLineEdit,
QSpinBox,
QPlainTextEdit {
    selection-background-color: rgba(126, 99, 244, 175);
    selection-color: white;
    background-color: rgba(2, 9, 14, 55);
    border: 1px solid rgba(255, 255, 255, 35);
    border-radius: 10px;
    color: rgba(255, 255, 255, 238);
}

QLineEdit {
    min-height: 38px;
    padding: 0 12px;
}

QLineEdit:focus,
QSpinBox:focus,
QPlainTextEdit:focus {
    background-color: rgba(4, 12, 17, 72);
    border: 1px solid rgba(111, 225, 233, 142);
}

QSpinBox {
    min-height: 34px;
    padding: 0 8px;
}

QSpinBox::up-button,
QSpinBox::down-button {
    width: 17px;
    border: none;
    background: rgba(255, 255, 255, 12);
}

QSpinBox::up-button:hover,
QSpinBox::down-button:hover {
    background: rgba(111, 225, 233, 35);
}

QFrame#numberControl {
    min-height: 38px;
    background: rgba(2, 9, 14, 55);
    border: 1px solid rgba(255, 255, 255, 35);
    border-radius: 10px;
}

QSpinBox#numberValue {
    min-height: 36px;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0 5px;
}

QToolButton#stepButton {
    min-width: 25px;
    max-width: 25px;
    min-height: 28px;
    max-height: 28px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: 13pt;
    font-weight: 700;
}

QToolButton#stepButton[action="subtract"] {
    color: #FF9CB0;
    background: rgba(220, 60, 91, 42);
    border-color: rgba(255, 124, 149, 45);
}

QToolButton#stepButton[action="subtract"]:hover {
    color: white;
    background: rgba(220, 60, 91, 105);
}

QToolButton#stepButton[action="add"] {
    color: #7CF0BE;
    background: rgba(41, 190, 125, 42);
    border-color: rgba(105, 238, 179, 45);
}

QToolButton#stepButton[action="add"]:hover {
    color: white;
    background: rgba(41, 190, 125, 105);
}

QPlainTextEdit {
    padding: 9px;
}

QListWidget {
    outline: none;
    background: rgba(0, 5, 9, 28);
    border: 1px solid rgba(255, 255, 255, 24);
    border-radius: 12px;
    padding: 6px;
}

QListWidget::item {
    min-height: 40px;
    margin: 2px 0;
    padding: 0 10px;
    border-radius: 9px;
    color: rgba(239, 246, 250, 195);
}

QListWidget::item:hover {
    background: rgba(255, 255, 255, 14);
}

QListWidget::item:selected {
    background: rgba(126, 99, 244, 165);
    color: white;
}

QProgressBar {
    min-height: 5px;
    max-height: 5px;
    background: rgba(0, 5, 9, 82);
    border: none;
    border-radius: 2px;
}

QProgressBar::chunk {
    background: #76E3EA;
    border-radius: 2px;
}

QScrollBar:vertical {
    width: 8px;
    margin: 4px 1px;
    background: transparent;
}

QScrollBar::handle:vertical {
    min-height: 30px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 39);
}

QScrollBar::handle:vertical:hover {
    background: rgba(118, 227, 234, 85);
}

QScrollBar::add-line:vertical,
QScrollBar::sub-line:vertical,
QScrollBar::add-page:vertical,
QScrollBar::sub-page:vertical {
    height: 0;
    background: transparent;
}

QToolButton#themeButton {
    background: rgba(255, 255, 255, 10);
    border: 1px solid rgba(255, 255, 255, 28);
    border-radius: 15px;
}

QToolButton#themeButton:hover,
QToolButton#themeButton:pressed {
    background: rgba(255, 255, 255, 25);
    border-color: rgba(118, 227, 234, 75);
}

QMenu {
    background: rgba(18, 25, 32, 246);
    border: 1px solid rgba(255, 255, 255, 42);
    border-radius: 10px;
    padding: 6px;
}

QMenu::item {
    min-width: 126px;
    padding: 8px 14px 8px 10px;
    border-radius: 7px;
}

QMenu::item:selected {
    background: rgba(126, 99, 244, 130);
}

QMenu::indicator {
    width: 0;
    height: 0;
}

QSizeGrip {
    width: 16px;
    height: 16px;
    background: transparent;
}
"""


DARK_THEME_OVERRIDE = """
QFrame#glassShell { background: #0B121B; }
QFrame#titleBar { background: #101925; }
QFrame#sidebarCard { background: #0A121B; }
QFrame#glassCard, QFrame#runCard { background: #121D29; }
QFrame#editorCard { background: #0A1119; }
QFrame#innerCard { background: #0B131D; }
QFrame#numberControl,
QLineEdit, QSpinBox, QPlainTextEdit { background: #0C141D; }
QSpinBox#numberValue { background: transparent; }
QListWidget { background: #081019; }
QMenu { background: #121B27; }
"""


LIGHT_THEME_OVERRIDE = """
* { color: #1A2733; }
QFrame#glassShell { background: #EEF3F6; }
QFrame#titleBar {
    background: #F8FAFC;
    border-bottom-color: rgba(29, 47, 62, 32);
}
QFrame#sidebarCard {
    background: #F8FBFC;
    border-color: rgba(29, 47, 62, 44);
}
QFrame#glassCard,
QFrame#editorCard,
QFrame#runCard {
    background: rgba(255, 255, 255, 218);
    border-color: rgba(29, 47, 62, 44);
}
QFrame#innerCard {
    background: #F1F5F7;
    border-color: rgba(29, 47, 62, 36);
}
QLabel#windowTitle,
QLabel#pageTitle,
QLabel#brandTitle,
QLabel#sectionTitle { color: #17232E; }
QLabel#muted,
QLabel#hint,
QLabel#estimate,
QLabel#detail { color: #657483; }
QLabel#eyebrow { color: #087C84; }
QLabel#glassBadge,
QLabel#platformBadge {
    color: #087C84;
    background: rgba(8, 124, 132, 13);
    border-color: rgba(8, 124, 132, 42);
}
QLabel#statusTitle[tone="ready"] { color: #138256; }
QLabel#statusTitle[tone="warning"] { color: #986A05; }
QLabel#statusTitle[tone="error"] { color: #C13F5D; }
QToolButton#windowButton { color: #344453; }
QToolButton#windowButton:hover { color: #17232E; background: rgba(29, 47, 62, 15); }
QToolButton#themeButton {
    background: rgba(29, 47, 62, 8);
    border-color: rgba(29, 47, 62, 30);
}
QPushButton {
    color: #263747;
    background: rgba(255, 255, 255, 175);
    border-color: rgba(29, 47, 62, 40);
}
QPushButton:hover {
    background: white;
    border-color: rgba(29, 47, 62, 70);
}
QPushButton[role="primary"] { color: white; }
QPushButton[role="danger"] {
    color: #C83F60;
    background: rgba(210, 53, 88, 16);
}
QPushButton:disabled {
    color: rgba(38, 55, 71, 85);
    background: rgba(29, 47, 62, 7);
}
QLineEdit,
QSpinBox,
QPlainTextEdit,
QFrame#numberControl {
    color: #17232E;
    background: #F8FAFB;
    border-color: rgba(29, 47, 62, 48);
}
QSpinBox#numberValue { color: #17232E; background: transparent; }
QLineEdit:focus,
QSpinBox:focus,
QPlainTextEdit:focus {
    background: white;
    border-color: rgba(8, 142, 151, 150);
}
QListWidget {
    color: #263747;
    background: #F3F7F9;
    border-color: rgba(29, 47, 62, 34);
}
QListWidget::item { color: #405160; }
QListWidget::item:hover { background: rgba(29, 47, 62, 12); }
QListWidget::item:selected { color: white; }
QProgressBar { background: rgba(29, 47, 62, 30); }
QScrollBar::handle:vertical { background: rgba(29, 47, 62, 42); }
QMenu {
    color: #1A2733;
    background: #FFFFFF;
    border-color: rgba(29, 47, 62, 44);
}
QMenu::item:selected { color: white; }
"""


def stylesheet_for_theme(theme: str) -> str:
    if theme == "light":
        return GLASS_STYLESHEET + LIGHT_THEME_OVERRIDE
    if theme == "dark":
        return GLASS_STYLESHEET + DARK_THEME_OVERRIDE
    return GLASS_STYLESHEET


def theme_icon(theme: str, size: int = 22) -> QIcon:
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    bounds = QRectF(3, 3, size - 6, size - 6)

    if theme == "light":
        painter.setPen(QPen(QColor("#D89A22"), 1.5))
        painter.setBrush(QColor("#FFD56A"))
        painter.drawEllipse(bounds.adjusted(3, 3, -3, -3))
        center = size // 2
        for start, end in (
            ((center, 1), (center, 4)),
            ((center, size - 1), (center, size - 4)),
            ((1, center), (4, center)),
            ((size - 1, center), (size - 4, center)),
        ):
            painter.drawLine(*start, *end)
    elif theme == "dark":
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#8797FF"))
        painter.drawEllipse(bounds)
        painter.setCompositionMode(QPainter.CompositionMode.CompositionMode_Clear)
        painter.drawEllipse(bounds.translated(5, -3))
    else:
        gradient = QLinearGradient(bounds.topLeft(), bounds.bottomRight())
        gradient.setColorAt(0, QColor("#55D6D9"))
        gradient.setColorAt(0.5, QColor("#7765F5"))
        gradient.setColorAt(1, QColor("#E071A0"))
        painter.setPen(QPen(QColor(255, 255, 255, 155), 1))
        painter.setBrush(gradient)
        painter.drawRoundedRect(bounds, 5, 5)
    painter.end()
    return QIcon(pixmap)


class NumberControl(QFrame):
    valueChanged = Signal(int)

    def __init__(
        self,
        minimum: int,
        maximum: int,
        suffix: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName("numberControl")
        self.setMinimumWidth(106)
        self.setFixedHeight(40)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(4, 0, 4, 0)
        layout.setSpacing(2)

        subtract = QToolButton()
        subtract.setObjectName("stepButton")
        subtract.setProperty("action", "subtract")
        subtract.setText("−")
        subtract.setToolTip("Decrease")
        subtract.clicked.connect(self._step_down)
        layout.addWidget(subtract)

        self.spin = QSpinBox()
        self.spin.setObjectName("numberValue")
        self.spin.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        self.spin.setRange(minimum, maximum)
        self.spin.setSuffix(suffix)
        self.spin.setAccelerated(True)
        self.spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.spin.valueChanged.connect(self.valueChanged)
        layout.addWidget(self.spin, 1)

        add = QToolButton()
        add.setObjectName("stepButton")
        add.setProperty("action", "add")
        add.setText("+")
        add.setToolTip("Increase")
        add.clicked.connect(self._step_up)
        layout.addWidget(add)

    def _step_down(self) -> None:
        self.spin.stepDown()

    def _step_up(self) -> None:
        self.spin.stepUp()

    def value(self) -> int:
        return self.spin.value()

    def setValue(self, value: int) -> None:
        self.spin.setValue(value)


class TitleBar(QFrame):
    def __init__(self, owner: "App") -> None:
        super().__init__(owner)
        self.owner = owner
        self.setObjectName("titleBar")
        self.setFixedHeight(48)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 6, 10, 6)
        layout.setSpacing(9)

        mark = QLabel("AT")
        mark.setObjectName("brandMark")
        mark.setAlignment(Qt.AlignmentFlag.AlignCenter)
        mark.setFixedSize(29, 29)
        layout.addWidget(mark)

        title = QLabel("AutoTyper Studio")
        title.setObjectName("windowTitle")
        layout.addWidget(title)
        layout.addStretch(1)

        self.theme_button = QToolButton()
        self.theme_button.setObjectName("themeButton")
        self.theme_button.setFixedSize(31, 31)
        self.theme_button.setToolTip("Choose theme")
        self.theme_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        theme_menu = QMenu(self.theme_button)
        theme_group = QActionGroup(theme_menu)
        theme_group.setExclusive(True)
        self.theme_actions = {}
        for theme, label in (
            ("light", "Light"),
            ("dark", "Dark"),
            ("glass", "Glass"),
        ):
            action = theme_menu.addAction(theme_icon(theme), label)
            action.setCheckable(True)
            action.triggered.connect(
                lambda _checked=False, value=theme: owner.set_theme(value)
            )
            theme_group.addAction(action)
            self.theme_actions[theme] = action
        self.theme_button.setMenu(theme_menu)
        layout.addWidget(self.theme_button)

        self.glass_badge = QLabel("NATIVE GLASS")
        self.glass_badge.setObjectName("glassBadge")
        layout.addWidget(self.glass_badge)

        for symbol, callback, kind in (
            ("—", owner.showMinimized, "minimize"),
            ("□", owner.toggle_maximized, "maximize"),
            ("×", owner.close, "close"),
        ):
            button = QToolButton()
            button.setObjectName("windowButton")
            button.setProperty("kind", kind)
            button.setText(symbol)
            button.setFixedSize(31, 31)
            button.clicked.connect(callback)
            if kind == "maximize":
                owner.maximize_button = button
            layout.addWidget(button)
        self.set_theme(owner.theme)

    def set_theme(self, theme: str) -> None:
        self.theme_button.setIcon(theme_icon(theme))
        self.theme_button.setToolTip(f"Theme: {theme.title()}")
        action = self.theme_actions.get(theme)
        if action:
            action.setChecked(True)

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            handle = self.owner.windowHandle()
            if handle is not None:
                handle.startSystemMove()
                event.accept()
                return
        super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.owner.toggle_maximized()
            event.accept()
            return
        super().mouseDoubleClickEvent(event)


class App(QMainWindow):
    def __init__(
        self,
        store: SettingsStore | None = None,
        *,
        initialize_hotkeys: bool = True,
    ) -> None:
        super().__init__()
        self.store = store or SettingsStore(legacy_path=default_legacy_settings_path())
        self.settings = self.store.load()
        self.theme = (
            self.settings.theme if self.settings.theme in VALID_THEMES else "glass"
        )
        self.engine = TypingEngine()
        self.hotkeys: HotkeyManager | None = None
        self._events: queue.Queue[tuple] = queue.Queue()
        self._current_id = ""
        self._changing_selection = False
        self._backdrop_applied = False
        self.glass_result: GlassResult | None = None

        self.engine.on_state = (
            lambda state, message: self._events.put(("state", state, message))
        )
        self.engine.on_progress = (
            lambda current, total: self._events.put(("progress", current, total))
        )
        self.engine.on_done = lambda outcome: self._events.put(("done", outcome))
        self.engine.on_error = lambda error: self._events.put(("error", error))

        self._configure_window()
        self._build_ui()
        self._refresh_library()
        self._show_snippet(self.settings.selected_snippet_id)
        if initialize_hotkeys:
            self._initialize_hotkeys()
        self._update_estimate()
        self._set_status(
            self.store.warning or "Ready",
            "Choose a snippet or press its shortcut.",
            "warning" if self.store.warning else "ready",
        )

        self.event_timer = QTimer(self)
        self.event_timer.setInterval(50)
        self.event_timer.timeout.connect(self._poll_events)
        self.event_timer.start()

        self.estimate_timer = QTimer(self)
        self.estimate_timer.setSingleShot(True)
        self.estimate_timer.setInterval(120)
        self.estimate_timer.timeout.connect(self._update_estimate)

    def _configure_window(self) -> None:
        self.setWindowTitle("AutoTyper Studio")
        self.setObjectName("autoTyperWindow")
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setWindowFlags(
            Qt.WindowType.Window
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowSystemMenuHint
            | Qt.WindowType.WindowMinMaxButtonsHint
        )
        self.setMinimumSize(1000, 680)
        self.setStyleSheet(stylesheet_for_theme(self.theme))

        match = WINDOW_GEOMETRY.fullmatch(self.settings.window_geometry.strip())
        width = int(match.group("width")) if match else 1180
        height = int(match.group("height")) if match else 760
        self.resize(max(1000, width), max(680, height))
        if match and match.group("x") and match.group("y"):
            self.move(int(match.group("x")), int(match.group("y")))

    def _build_ui(self) -> None:
        canvas = QWidget()
        canvas.setObjectName("windowCanvas")
        self.setCentralWidget(canvas)

        self.outer_layout = QVBoxLayout(canvas)
        self.outer_layout.setContentsMargins(12, 12, 12, 12)

        self.shell = QFrame()
        self.shell.setObjectName("glassShell")
        self.outer_layout.addWidget(self.shell)

        self.shadow = QGraphicsDropShadowEffect(self.shell)
        self.shadow.setBlurRadius(42)
        self.shadow.setOffset(0, 10)
        self.shadow.setColor(QColor(0, 0, 0, 145))
        self.shell.setGraphicsEffect(self.shadow)

        shell_layout = QVBoxLayout(self.shell)
        shell_layout.setContentsMargins(0, 0, 0, 0)
        shell_layout.setSpacing(0)

        self.title_bar = TitleBar(self)
        shell_layout.addWidget(self.title_bar)

        body = QWidget()
        body_layout = QHBoxLayout(body)
        body_layout.setContentsMargins(16, 15, 16, 16)
        body_layout.setSpacing(14)
        shell_layout.addWidget(body, 1)

        body_layout.addWidget(self._build_sidebar())
        body_layout.addWidget(self._build_workspace(), 1)

        self.size_grip = QSizeGrip(self.shell)
        self.size_grip.raise_()

    def _build_sidebar(self) -> QFrame:
        sidebar = QFrame()
        sidebar.setObjectName("sidebarCard")
        sidebar.setFixedWidth(258)
        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(15, 16, 15, 15)
        layout.setSpacing(11)

        brand = QLabel("AutoTyper")
        brand.setObjectName("brandTitle")
        layout.addWidget(brand)

        edition = QLabel("STUDIO 2.0  /  GLASS EDITION")
        edition.setObjectName("eyebrow")
        layout.addWidget(edition)

        heading_row = QHBoxLayout()
        heading = QLabel("SNIPPET LIBRARY")
        heading.setObjectName("sectionTitle")
        heading_row.addWidget(heading)
        heading_row.addStretch(1)
        self.snippet_count = QLabel("0")
        self.snippet_count.setObjectName("muted")
        heading_row.addWidget(self.snippet_count)
        layout.addLayout(heading_row)

        self.snippet_list = QListWidget()
        self.snippet_list.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff
        )
        self.snippet_list.currentItemChanged.connect(self._on_library_select)
        layout.addWidget(self.snippet_list, 1)

        library_actions = QGridLayout()
        library_actions.setHorizontalSpacing(6)
        library_actions.setVerticalSpacing(6)
        new_button = self._button("+  New", self._new_snippet)
        copy_button = self._button("Duplicate", self._duplicate_snippet)
        delete_button = self._button("Delete", self._delete_snippet, role="danger")
        library_actions.addWidget(new_button, 0, 0, 1, 2)
        library_actions.addWidget(copy_button, 1, 0)
        library_actions.addWidget(delete_button, 1, 1)
        layout.addLayout(library_actions)

        global_card = QFrame()
        global_card.setObjectName("innerCard")
        global_layout = QGridLayout(global_card)
        global_layout.setContentsMargins(11, 10, 11, 10)
        global_layout.setHorizontalSpacing(8)
        global_layout.setVerticalSpacing(7)
        global_heading = QLabel("GLOBAL CONTROLS")
        global_heading.setObjectName("eyebrow")
        global_layout.addWidget(global_heading, 0, 0, 1, 2)
        global_layout.addWidget(QLabel("Pause"), 1, 0)
        self.pause_hotkey_edit = QLineEdit(self.settings.pause_hotkey)
        self.pause_hotkey_edit.setFixedHeight(34)
        global_layout.addWidget(self.pause_hotkey_edit, 1, 1)
        global_layout.addWidget(QLabel("Stop"), 2, 0)
        self.stop_hotkey_edit = QLineEdit(self.settings.stop_hotkey)
        self.stop_hotkey_edit.setFixedHeight(34)
        global_layout.addWidget(self.stop_hotkey_edit, 2, 1)
        note = QLabel("Save changes to apply shortcuts")
        note.setObjectName("hint")
        note.setWordWrap(True)
        global_layout.addWidget(note, 3, 0, 1, 2)
        layout.addWidget(global_card)

        transfer = QHBoxLayout()
        transfer.setSpacing(6)
        transfer.addWidget(self._button("Import", self._import_library))
        transfer.addWidget(self._button("Export", self._export_library))
        layout.addLayout(transfer)
        return sidebar

    def _build_workspace(self) -> QWidget:
        workspace = QWidget()
        layout = QVBoxLayout(workspace)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(11)

        header = QHBoxLayout()
        title_column = QVBoxLayout()
        title_column.setSpacing(1)
        title = QLabel("Typing workspace")
        title.setObjectName("pageTitle")
        title_column.addWidget(title)
        subtitle = QLabel(
            "A calm, native-glass cockpit for precise text automation."
        )
        subtitle.setObjectName("muted")
        title_column.addWidget(subtitle)
        header.addLayout(title_column, 1)

        save_button = self._button("Save changes", self._save_current)
        save_button.setMinimumWidth(128)
        header.addWidget(save_button)
        layout.addLayout(header)

        identity_card = QFrame()
        identity_card.setObjectName("glassCard")
        identity_layout = QHBoxLayout(identity_card)
        identity_layout.setContentsMargins(14, 11, 14, 12)
        identity_layout.setSpacing(12)
        name_column = QVBoxLayout()
        name_column.setSpacing(5)
        name_column.addWidget(self._section_label("Snippet name"))
        self.name_edit = QLineEdit()
        self.name_edit.setPlaceholderText("Name this snippet")
        name_column.addWidget(self.name_edit)
        identity_layout.addLayout(name_column, 1)
        hotkey_column = QVBoxLayout()
        hotkey_column.setSpacing(5)
        hotkey_column.addWidget(self._section_label("Global shortcut"))
        self.hotkey_edit = QLineEdit()
        self.hotkey_edit.setPlaceholderText("ctrl+alt+1")
        self.hotkey_edit.setFixedWidth(205)
        hotkey_column.addWidget(self.hotkey_edit)
        identity_layout.addLayout(hotkey_column)
        layout.addWidget(identity_card)

        editor_card = QFrame()
        editor_card.setObjectName("editorCard")
        editor_layout = QVBoxLayout(editor_card)
        editor_layout.setContentsMargins(13, 11, 13, 10)
        editor_layout.setSpacing(7)
        editor_header = QHBoxLayout()
        editor_header.addWidget(self._section_label("Text or script"))
        editor_header.addStretch(1)
        editor_header.addWidget(
            self._button("Paste from clipboard", self._paste_clipboard)
        )
        editor_layout.addLayout(editor_header)

        self.text_edit = QPlainTextEdit()
        self.text_edit.setPlaceholderText("Type or paste the text to automate…")
        self.text_edit.setMinimumHeight(130)
        self.text_edit.setFont(QFont("Cascadia Mono", 10))
        self.text_edit.textChanged.connect(self._schedule_estimate)
        editor_layout.addWidget(self.text_edit, 1)
        token_hint = QLabel(describe_tokens())
        token_hint.setObjectName("hint")
        token_hint.setWordWrap(True)
        editor_layout.addWidget(token_hint)
        layout.addWidget(editor_card, 1)

        settings_card = QFrame()
        settings_card.setObjectName("glassCard")
        settings_layout = QGridLayout(settings_card)
        settings_layout.setContentsMargins(13, 10, 13, 11)
        settings_layout.setHorizontalSpacing(9)
        settings_layout.setVerticalSpacing(5)

        fields = (
            ("Delay (ms)", 0, 5000),
            ("Jitter (ms)", 0, 2500),
            ("Punctuation", 0, 10000),
            ("Countdown (ms)", 0, 60000),
            ("Repeats", 1, 10000),
            ("Repeat gap (ms)", 0, 600000),
        )
        self.option_spins: list[NumberControl] = []
        for column, (label, minimum, maximum) in enumerate(fields):
            settings_layout.addWidget(self._section_label(label), 0, column)
            spin = NumberControl(minimum, maximum, "")
            spin.valueChanged.connect(self._schedule_estimate)
            settings_layout.addWidget(spin, 1, column)
            settings_layout.setColumnStretch(column, 1)
            settings_layout.setColumnMinimumWidth(column, 106)
            self.option_spins.append(spin)
        (
            self.delay_spin,
            self.jitter_spin,
            self.punctuation_spin,
            self.countdown_spin,
            self.repeat_spin,
            self.repeat_delay_spin,
        ) = self.option_spins
        layout.addWidget(settings_card)

        run_card = QFrame()
        run_card.setObjectName("runCard")
        run_layout = QHBoxLayout(run_card)
        run_layout.setContentsMargins(16, 11, 13, 11)
        run_layout.setSpacing(14)

        status_column = QVBoxLayout()
        status_column.setSpacing(3)
        status_top = QHBoxLayout()
        self.status_title = QLabel("Ready")
        self.status_title.setObjectName("statusTitle")
        self.status_title.setProperty("tone", "ready")
        status_top.addWidget(self.status_title)
        status_top.addStretch(1)
        self.estimate_label = QLabel("Estimated duration: —")
        self.estimate_label.setObjectName("estimate")
        status_top.addWidget(self.estimate_label)
        status_column.addLayout(status_top)
        self.detail_label = QLabel("")
        self.detail_label.setObjectName("detail")
        status_column.addWidget(self.detail_label)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setTextVisible(False)
        status_column.addWidget(self.progress)
        run_layout.addLayout(status_column, 1)

        actions = QHBoxLayout()
        actions.setSpacing(7)
        self.start_button = self._button(
            "Start typing", self._start_selected, role="primary"
        )
        self.pause_button = self._button("Pause", self._toggle_pause)
        self.stop_button = self._button("Stop", self._stop, role="danger")
        self.pause_button.setEnabled(False)
        self.stop_button.setEnabled(False)
        actions.addWidget(self.start_button)
        actions.addWidget(self.pause_button)
        actions.addWidget(self.stop_button)
        run_layout.addLayout(actions)
        layout.addWidget(run_card)
        return workspace

    def _button(self, text: str, callback, *, role: str = "") -> QPushButton:
        button = QPushButton(text)
        if role:
            button.setProperty("role", role)
        button.clicked.connect(callback)
        return button

    def _section_label(self, text: str) -> QLabel:
        label = QLabel(text)
        label.setObjectName("sectionTitle")
        return label

    def _initialize_hotkeys(self) -> None:
        try:
            self.hotkeys = HotkeyManager()
            self._configure_hotkeys()
        except (RuntimeError, HotkeyError) as exc:
            self.hotkeys = None
            self._set_status("Hotkeys unavailable", str(exc), "warning")

    def _configure_hotkeys(self) -> None:
        if not self.hotkeys:
            return
        self.hotkeys.configure(
            self.settings.snippets,
            self.settings.pause_hotkey,
            self.settings.stop_hotkey,
            emit=lambda action, payload: self._events.put(
                ("hotkey", action, payload)
            ),
        )

    def _refresh_library(self) -> None:
        selected_id = self._current_id or self.settings.selected_snippet_id
        self._changing_selection = True
        self.snippet_list.clear()
        selected_item: QListWidgetItem | None = None
        for snippet in self.settings.snippets:
            shortcut = snippet.hotkey.upper() if snippet.hotkey else "NO SHORTCUT"
            item = QListWidgetItem(f"{snippet.name}\n{shortcut}")
            item.setData(Qt.ItemDataRole.UserRole, snippet.id)
            item.setToolTip(snippet.name)
            self.snippet_list.addItem(item)
            if snippet.id == selected_id:
                selected_item = item
        self.snippet_count.setText(str(len(self.settings.snippets)))
        if selected_item is None and self.snippet_list.count():
            selected_item = self.snippet_list.item(0)
        self.snippet_list.setCurrentItem(selected_item)
        if selected_item:
            self.snippet_list.scrollToItem(selected_item)
        self._changing_selection = False

    def _show_snippet(self, snippet_id: str) -> None:
        snippet = self._find_snippet(snippet_id) or self.settings.snippets[0]
        self._current_id = snippet.id
        self.settings.selected_snippet_id = snippet.id
        self.name_edit.setText(snippet.name)
        self.hotkey_edit.setText(snippet.hotkey)
        self.delay_spin.setValue(snippet.char_delay_ms)
        self.jitter_spin.setValue(snippet.jitter_ms)
        self.punctuation_spin.setValue(snippet.punctuation_pause_ms)
        self.countdown_spin.setValue(snippet.startup_delay_ms)
        self.repeat_spin.setValue(snippet.repeat_count)
        self.repeat_delay_spin.setValue(snippet.repeat_delay_ms)
        self.text_edit.setPlainText(snippet.text)
        self._update_estimate()

    def _find_snippet(self, snippet_id: str) -> Snippet | None:
        return next(
            (item for item in self.settings.snippets if item.id == snippet_id),
            None,
        )

    def _on_library_select(
        self,
        current: QListWidgetItem | None,
        _previous: QListWidgetItem | None,
    ) -> None:
        if self._changing_selection or current is None:
            return
        new_id = str(current.data(Qt.ItemDataRole.UserRole) or "")
        if not new_id or new_id == self._current_id:
            return
        self._write_ui_to_model(strict=False)
        self._show_snippet(new_id)

    def _options_from_ui(self) -> TypingOptions:
        options = TypingOptions(
            char_delay_ms=self.delay_spin.value(),
            jitter_ms=self.jitter_spin.value(),
            punctuation_pause_ms=self.punctuation_spin.value(),
            startup_delay_ms=self.countdown_spin.value(),
            repeat_count=self.repeat_spin.value(),
            repeat_delay_ms=self.repeat_delay_spin.value(),
        )
        options.validate()
        return options

    def _write_ui_to_model(self, strict: bool) -> Snippet:
        snippet = self._find_snippet(self._current_id)
        if snippet is None:
            raise ValueError("No snippet is selected.")
        snippet.name = self.name_edit.text().strip()[:80] or "Untitled snippet"
        snippet.text = self.text_edit.toPlainText()
        snippet.hotkey = self.hotkey_edit.text().strip().lower()
        options = self._options_from_ui()
        snippet.char_delay_ms = options.char_delay_ms
        snippet.jitter_ms = options.jitter_ms
        snippet.punctuation_pause_ms = options.punctuation_pause_ms
        snippet.startup_delay_ms = options.startup_delay_ms
        snippet.repeat_count = options.repeat_count
        snippet.repeat_delay_ms = options.repeat_delay_ms
        return snippet

    def _save_current(self, silent: bool = False) -> bool:
        try:
            self._write_ui_to_model(strict=True)
            self.settings.pause_hotkey = (
                self.pause_hotkey_edit.text().strip().lower()
            )
            self.settings.stop_hotkey = self.stop_hotkey_edit.text().strip().lower()
            self._configure_hotkeys()
            self.store.save(self.settings)
            self._refresh_library()
            if not silent:
                self._set_status(
                    "Saved",
                    f"Library stored at {self.store.path}",
                    "ready",
                )
            return True
        except (OSError, ValueError, HotkeyError) as exc:
            if not silent:
                QMessageBox.critical(self, "Could not save", str(exc))
            self._set_status("Save failed", str(exc), "error")
            return False

    def _new_snippet(self) -> None:
        self._write_ui_to_model(strict=False)
        snippet = Snippet(name=f"Snippet {len(self.settings.snippets) + 1}")
        self.settings.snippets.append(snippet)
        self.settings.selected_snippet_id = snippet.id
        self._current_id = snippet.id
        self._refresh_library()
        self._show_snippet(snippet.id)
        self.name_entry_focus()

    def name_entry_focus(self) -> None:
        self.name_edit.setFocus()
        self.name_edit.selectAll()

    def _duplicate_snippet(self) -> None:
        original = self._write_ui_to_model(strict=False)
        clone = Snippet.from_dict(original.to_dict())
        clone.id = Snippet().id
        clone.name = f"{original.name} copy"[:80]
        clone.hotkey = ""
        self.settings.snippets.append(clone)
        self._current_id = clone.id
        self.settings.selected_snippet_id = clone.id
        self._refresh_library()
        self._show_snippet(clone.id)

    def _delete_snippet(self) -> None:
        snippet = self._find_snippet(self._current_id)
        if not snippet:
            return
        if len(self.settings.snippets) == 1:
            QMessageBox.information(
                self,
                "Keep one snippet",
                "Create another snippet before deleting this one.",
            )
            return
        answer = QMessageBox.question(
            self,
            "Delete snippet?",
            f'Delete “{snippet.name}”? This can be undone only from an export.',
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        index = self.settings.snippets.index(snippet)
        self.settings.snippets.remove(snippet)
        replacement = self.settings.snippets[min(index, len(self.settings.snippets) - 1)]
        self._current_id = replacement.id
        self.settings.selected_snippet_id = replacement.id
        self._refresh_library()
        self._show_snippet(replacement.id)
        self._save_current(silent=True)

    def _paste_clipboard(self) -> None:
        value = QApplication.clipboard().text()
        if not value:
            QMessageBox.information(
                self,
                "Clipboard is empty",
                "Copy some text, then try again.",
            )
            return
        self.text_edit.setPlainText(value)
        self._update_estimate()
        self._set_status("Clipboard loaded", "Review the text before starting.", "ready")

    def _export_library(self) -> None:
        if not self._save_current(silent=True):
            return
        destination, _filter = QFileDialog.getSaveFileName(
            self,
            "Export AutoTyper library",
            "autotyper-library.json",
            "AutoTyper library (*.json);;JSON (*.json)",
        )
        if not destination:
            return
        if not destination.lower().endswith(".json"):
            destination += ".json"
        try:
            Path(destination).write_text(
                json.dumps(self.settings.to_dict(), ensure_ascii=False, indent=2)
                + "\n",
                encoding="utf-8",
            )
            self._set_status("Library exported", destination, "ready")
        except OSError as exc:
            QMessageBox.critical(self, "Export failed", str(exc))

    def _import_library(self) -> None:
        source, _filter = QFileDialog.getOpenFileName(
            self,
            "Import AutoTyper library",
            "",
            "AutoTyper library (*.json);;JSON (*.json)",
        )
        if not source:
            return
        try:
            raw = json.loads(Path(source).read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("The selected file is not an AutoTyper library.")
            imported = AppSettings.from_dict(raw)
            answer = QMessageBox.question(
                self,
                "Replace current library?",
                f"Import {len(imported.snippets)} snippet(s) and replace the current library?",
            )
            if answer != QMessageBox.StandardButton.Yes:
                return
            self.settings = imported
            self.pause_hotkey_edit.setText(imported.pause_hotkey)
            self.stop_hotkey_edit.setText(imported.stop_hotkey)
            self._current_id = imported.selected_snippet_id
            self._configure_hotkeys()
            self.store.save(imported)
            self._refresh_library()
            self._show_snippet(imported.selected_snippet_id)
            self._set_status("Library imported", source, "ready")
        except (
            OSError,
            UnicodeError,
            json.JSONDecodeError,
            ValueError,
            HotkeyError,
        ) as exc:
            QMessageBox.critical(self, "Import failed", str(exc))

    def _start_selected(self) -> None:
        self._start_snippet(self._current_id)

    def _start_snippet(self, snippet_id: str) -> None:
        if self.engine.running:
            self._set_status(
                "Already running",
                "Pause or stop the current job before starting another.",
                "warning",
            )
            return
        if snippet_id != self._current_id:
            self._write_ui_to_model(strict=False)
            self._show_snippet(snippet_id)
            self._refresh_library()
        if not self._save_current(silent=True):
            return
        snippet = self._find_snippet(snippet_id)
        if not snippet:
            return
        try:
            options = TypingOptions(
                char_delay_ms=snippet.char_delay_ms,
                jitter_ms=snippet.jitter_ms,
                punctuation_pause_ms=snippet.punctuation_pause_ms,
                startup_delay_ms=snippet.startup_delay_ms,
                repeat_count=snippet.repeat_count,
                repeat_delay_ms=snippet.repeat_delay_ms,
            )
            if self.engine.start(snippet.text, options):
                self.progress.setValue(0)
                self._set_running_controls(True)
        except (RuntimeError, ValueError) as exc:
            QMessageBox.critical(self, "Could not start", str(exc))
            self._set_status("Start failed", str(exc), "error")

    def _toggle_pause(self) -> None:
        state = self.engine.toggle_pause()
        self.pause_button.setText(
            "Resume" if state is EngineState.PAUSED else "Pause"
        )

    def _stop(self) -> None:
        self.engine.stop()

    def _set_running_controls(self, running: bool) -> None:
        self.start_button.setEnabled(not running)
        self.pause_button.setEnabled(running)
        self.stop_button.setEnabled(running)
        if not running:
            self.pause_button.setText("Pause")

    def _schedule_estimate(self, *_args) -> None:
        if hasattr(self, "estimate_timer"):
            self.estimate_timer.start()

    def _update_estimate(self) -> None:
        try:
            options = self._options_from_ui()
            milliseconds = estimate_duration_ms(
                self.text_edit.toPlainText(),
                options,
            )
            seconds = milliseconds / 1000
            if seconds < 60:
                label = f"{seconds:.1f}s"
            else:
                minutes, remainder = divmod(int(seconds), 60)
                label = f"{minutes}m {remainder:02d}s"
            self.estimate_label.setText(f"Estimated duration: {label}")
        except ValueError:
            self.estimate_label.setText("Estimated duration: check settings")

    def _poll_events(self) -> None:
        try:
            while True:
                event = self._events.get_nowait()
                kind = event[0]
                if kind == "hotkey":
                    self._handle_hotkey(event[1], event[2])
                elif kind == "state":
                    self._handle_state(event[1], event[2])
                elif kind == "progress":
                    current, total = event[1], event[2]
                    self.progress.setValue(
                        round(current / total * 100) if total else 0
                    )
                elif kind == "done":
                    self._handle_done(event[1])
                elif kind == "error":
                    self._handle_error(event[1])
        except queue.Empty:
            pass

    def _handle_hotkey(self, action: str, payload: str) -> None:
        if action == "start":
            self._start_snippet(payload)
        elif action == "pause":
            self._toggle_pause()
        elif action == "stop":
            self._stop()

    def _handle_state(self, state: EngineState, message: str) -> None:
        details = {
            EngineState.COUNTDOWN: "Switch to the target window now.",
            EngineState.RUNNING: (
                f"Press {self.settings.pause_hotkey.upper()} to pause or "
                f"{self.settings.stop_hotkey.upper()} to stop."
            ),
            EngineState.PAUSED: (
                f"Press {self.settings.pause_hotkey.upper()} to resume."
            ),
            EngineState.STOPPING: "Finishing the current input action.",
            EngineState.IDLE: "Choose a snippet or press its shortcut.",
        }
        tone = (
            "warning"
            if state in {EngineState.COUNTDOWN, EngineState.PAUSED}
            else "ready"
        )
        self._set_status(message, details[state], tone)
        if state is EngineState.PAUSED:
            self.pause_button.setText("Resume")
        elif state is EngineState.RUNNING:
            self.pause_button.setText("Pause")

    def _handle_done(self, outcome: str) -> None:
        self._set_running_controls(False)
        if outcome == "completed":
            self.progress.setValue(100)
            self._set_status("Completed", "The full script was typed.", "ready")
        elif outcome == "stopped":
            self._set_status("Stopped", "The job ended safely.", "warning")

    def _handle_error(self, error: Exception) -> None:
        self._set_status("Typing failed", str(error), "error")
        QMessageBox.critical(self, "Typing failed", str(error))

    def _set_status(self, title: str, detail: str, tone: str) -> None:
        self.status_title.setText(title)
        self.detail_label.setText(detail)
        self.status_title.setProperty("tone", tone)
        self.status_title.style().unpolish(self.status_title)
        self.status_title.style().polish(self.status_title)

    def set_theme(self, theme: str) -> None:
        if theme not in VALID_THEMES:
            return
        self.theme = theme
        self.settings.theme = theme
        self.setStyleSheet(stylesheet_for_theme(theme))
        if hasattr(self, "title_bar"):
            self.title_bar.set_theme(theme)
        if self.isVisible():
            self._apply_backdrop()
        try:
            if self._current_id:
                self._write_ui_to_model(strict=False)
            self.store.save(self.settings)
        except (OSError, ValueError):
            pass

    def toggle_maximized(self) -> None:
        if self.isMaximized():
            self.showNormal()
            self.maximize_button.setText("□")
        else:
            self.showMaximized()
            self.maximize_button.setText("❐")

    def showEvent(self, event: QShowEvent) -> None:
        super().showEvent(event)
        if not self._backdrop_applied:
            QTimer.singleShot(40, self._apply_backdrop)

    def _apply_backdrop(self) -> None:
        if self.theme == "glass":
            result: GlassResult = apply_native_glass(int(self.winId()))
            self.glass_result = result
            self.title_bar.glass_badge.setText(
                "LIVE GLASS" if result.enabled else "TRANSLUCENT"
            )
            self.title_bar.glass_badge.setToolTip(
                result.mode
                if not result.detail
                else f"{result.mode}: {result.detail}"
            )
        else:
            clear_native_glass(int(self.winId()))
            self.glass_result = GlassResult(False, self.theme.title())
            self.title_bar.glass_badge.setText(self.theme.upper())
            self.title_bar.glass_badge.setToolTip(
                f"{self.theme.title()} theme — native blur disabled"
            )
        self._backdrop_applied = True

    def changeEvent(self, event: QEvent) -> None:
        super().changeEvent(event)
        if event.type() == QEvent.Type.WindowStateChange:
            maximized = self.isMaximized()
            margin = 0 if maximized else 12
            self.outer_layout.setContentsMargins(margin, margin, margin, margin)
            self.shadow.setEnabled(not maximized)
            self.maximize_button.setText("❐" if maximized else "□")

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if hasattr(self, "size_grip"):
            grip_size = self.size_grip.sizeHint()
            self.size_grip.move(
                self.shell.width() - grip_size.width() - 2,
                self.shell.height() - grip_size.height() - 2,
            )

    def closeEvent(self, event: QCloseEvent) -> None:
        try:
            self._write_ui_to_model(strict=False)
            position: QPoint = self.pos()
            self.settings.window_geometry = (
                f"{self.width()}x{self.height()}+{position.x()}+{position.y()}"
            )
            self.store.save(self.settings)
        except (OSError, ValueError):
            pass
        self.engine.stop()
        self.engine.join(0.25)
        if self.hotkeys:
            self.hotkeys.unregister_all()
        event.accept()

    def run(self) -> None:
        self.show()
