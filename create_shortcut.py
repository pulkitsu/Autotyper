import winshell
import win32com.client
import os

def create_shortcut():
    desktop = winshell.desktop()
    shortcut_path = os.path.join(desktop, "AutoTyper.lnk")
    
    # Use absolute path to exe
    exe_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist", "main.exe")
    icon_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "autotyper.ico")

    print(f"Looking for exe at: {exe_path}")
    print(f"Looking for icon at: {icon_path}")

    if not os.path.exists(exe_path):
        print("ERROR: main.exe not found. Run pyinstaller first.")
        return

    if not os.path.exists(icon_path):
        print("ERROR: autotyper.ico not found.")
        return

    shell = win32com.client.Dispatch("WScript.Shell")
    shortcut = shell.CreateShortcut(shortcut_path)
    shortcut.TargetPath = exe_path
    shortcut.WorkingDirectory = os.path.dirname(exe_path)
    shortcut.IconLocation = icon_path
    shortcut.Description = "AutoTyper"
    shortcut.save()

    print(f"Shortcut created at: {shortcut_path}")

if __name__ == "__main__":
    create_shortcut()