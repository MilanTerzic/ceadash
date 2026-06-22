from __future__ import annotations

import importlib
import os
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config" / "offline_embedded_config.yaml"
REQUIREMENTS_PATH = ROOT / "requirements_dashboard.txt"


def _ensure_pip() -> None:
    try:
        import pip  # noqa: F401
    except Exception:
        subprocess.check_call([sys.executable, "-m", "ensurepip", "--upgrade"])


def _ensure_dependencies() -> None:
    required_modules = {
        "flask": "Flask",
        "pandas": "pandas",
        "plotly": "plotly",
        "openpyxl": "openpyxl",
        "yaml": "PyYAML",
        "numpy": "numpy",
        "requests": "requests",
        "sklearn": "scikit-learn",
        "statsmodels": "statsmodels",
        "pyarrow": "pyarrow",
    }
    missing = []
    for module_name, package_name in required_modules.items():
        try:
            importlib.import_module(module_name)
        except Exception:
            missing.append(package_name)

    if not missing:
        return

    print("Installing missing Python packages...")
    _ensure_pip()
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_PATH)])


def _find_free_port(start: int = 8050, end: int = 8099) -> int:
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No free port found between 8050 and 8099.")


def _find_chrome() -> str | None:
    candidates = [
        Path.home() / "AppData/Local/Google/Chrome/Application/chrome.exe",
        Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
        Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _open_browser(url: str) -> None:
    chrome = _find_chrome()
    if chrome:
        subprocess.Popen([chrome, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        webbrowser.open(url)


def main() -> None:
    os.chdir(ROOT)
    _ensure_dependencies()
    from src.web.flask_dashboard import create_app

    port = _find_free_port()
    url = f"http://127.0.0.1:{port}"
    app = create_app(CONFIG_PATH)

    print("Starting plain Python dashboard...")
    print(f"Config: {CONFIG_PATH}")
    print(f"URL: {url}")

    threading.Timer(1.0, lambda: _open_browser(url)).start()
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
