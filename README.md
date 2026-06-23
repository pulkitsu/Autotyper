# Autotyper

A lightweight, desktop-based automated typing application built in Python that simulates human-like keystrokes. Designed to streamline repetitive data entry, test automation, and workflow optimization, it provides a seamless user experience via a responsive graphical interface.

## 🚀 Features

* **Human-Like Simulation:** Configures natural typing intervals instead of instant, detectable copy-pasting.
* **Customizable Delays:** Fine-tune interval delays and pre-start countdowns to match system responsiveness or application requirements.
* **Hotkey Integration:** Global keyboard shortcuts to safely start, pause, or abort typing operations instantly.
* **Intuitive GUI:** Built with a clean, user-friendly desktop interface for zero-configuration execution.
* **Cross-Platform Compatibility:** Runs seamlessly across Windows, macOS, and Linux systems.

## 🛠️ Tech Stack

* **Language:** Python 3.x
* **Automation Framework:** [PyAutoGUI](https://pyautogui.readthedocs.io/) (GUI automation and keystroke simulation)
* **GUI Framework:** Tkinter (Python's built-in standard GUI library)

## 📦 Installation & Setup

Copy and run the following commands sequentially in your terminal to set up and start the application:

```bash
# 1. Clone the Repository
git clone [https://github.com/pulkitsu/Autotyper.git](https://github.com/pulkitsu/Autotyper.git)
cd Autotyper

# 2. Set Up a Virtual Environment (Optional but Recommended)
# For Windows:
python -m venv venv
venv\Scripts\activate
# For macOS/Linux:
python3 -m venv venv
source venv/bin/activate

# 3. Install Dependencies
pip install pyautogui

# 4. Run the Application
python main.py
```
## 🎮 How to Use
* **Input Text:** Paste or type the text sequence you want automated into the main application text area.

* **Configure Speed:** Set your preferred delay interval (in seconds) between individual keystrokes or words.

* **Set Countdown:** Give yourself a few seconds of buffer time to click into your target text field before typing begins.

* **Execute:** Click the Start button (or press the designated hotkey), click into your destination window (e.g., Notepad, Excel, browser input), and watch it type.

* **Emergency Stop:** Utilize the built-in global fail-safe hotkey if you need to stop execution immediately.

## 📜 Copyright and License
Copyright (c) 2026 Pulkit Sulekh. All Rights Reserved.

This project and its original content, features, and functionality are owned by Pulkit Sulekh and are protected by international copyright, trademark, patent, trade secret, and other intellectual property or proprietary rights laws.

No license is granted to use, modify, or distribute this software without explicit permission.
