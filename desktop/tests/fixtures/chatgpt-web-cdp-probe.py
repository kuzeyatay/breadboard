"""Attach ChatMock's page driver to a tab the desktop fixture opened.

Arguments: <cdp port> <target id> <url to navigate to>. Prints one JSON line:
whether the target was reachable, what the driven page reports about the
injected script, and the events the page's binding sent back.
"""
import json
import os
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "chatmock"))
os.environ.setdefault("CHATMOCK_MODEL_DISCOVERY", "0")
os.environ.setdefault("CHATMOCK_PROVIDERS_FILE", os.path.join(os.environ.get("TEMP", "."), "chatgpt-web-probe", "providers.json"))

from chatmock.providers import chatgpt_web as web  # noqa: E402

port = int(sys.argv[1])
target_id = sys.argv[2]
url = sys.argv[3]
report = {"connected": False, "python": sys.executable}
import urllib.request as _u
report["proxies"] = _u.getproxies()
try:
    ws = web._page_websocket(port, target_id=target_id, timeout=10)
    page = web._Page(ws, surface="desktop")
    report["connected"] = True
    page.install()
    page.navigate(url, timeout=20)
    report["href"] = page.current_url()
    report["script"] = bool(page.evaluate("!!window.__breadboardChatgptWeb", timeout=10))
    report["ready"] = bool(page.evaluate("window.__breadboardChatgptWeb.ready()", timeout=10))
    # The binding is how answers travel back; prove it carries a payload.
    page.evaluate("window.__breadboardChatgptWebEmit(JSON.stringify({type: 'probe', turn: 'x', hello: 1}))", timeout=10)
    deadline = time.time() + 5
    events = []
    while time.time() < deadline and not events:
        try:
            events.append(page.events.get(timeout=0.5))
        except Exception:  # noqa: BLE001
            pass
    report["events"] = events
    report["snapshot"] = page.evaluate("window.__breadboardChatgptWeb.snapshot()", timeout=10)
    page.close()
except Exception as exc:  # noqa: BLE001
    report["error"] = f"{type(exc).__name__}: {exc}"
print(json.dumps(report))
