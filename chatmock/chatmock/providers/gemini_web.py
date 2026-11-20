from __future__ import annotations

"""Gemini through gemini.google.com itself, in Breadboard's own browser.

The Google twin of ``chatgpt_web`` ("OpenAI (web)"): no API key, no OAuth
client. A hidden page in Breadboard's browser partition holds the person's
Google session, every chat completion is typed into the site's composer, and
the answer is read back off the rendered page. The shell bridge, the prompt
framing and the text tool-call protocol are ``chatgpt_web``'s own; only the
page driving differs.

The page is the shell's ChatGPT-page machinery under its own lanes
(``gemini``, ``gemini-2``, ... for chats, ``gemini-batch`` for Learn and the
council), so the desktop side needed nothing new: lanes are free-form there.

Site facts, measured 2026-11-20 against gemini.google.com (signed out):
composer ``rich-textarea .ql-editor`` (Quill; a synthetic text/plain paste is
accepted), send ``button[aria-label="Send message"]`` which becomes
``Stop response`` while generating, answers in ``model-response
message-content .markdown``, and ``message-actions`` appears in a response
once it is finished. The mode picker (``[data-test-id=bard-mode-menu-button]``)
only opens on a real (CDP) mouse click; its options are
``gem-mode-menu [role=menuitemradio] .label``. Signed out it offers "Auto"
only. Not measured: the signed-in picker, image upload previews, and the
temporary-chat control - those paths are best effort.
"""

import json
import queue
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List
from uuid import uuid4

from . import chatgpt_web as web
from . import transport
from .store import ResolvedCredentials
from .types import ModelCall, ModelTokenUsage, ProviderError

PROVIDER_ID = "googleweb"
LABEL = "Google (web)"
ORIGIN = "https://gemini.google.com"
APP_URL = f"{ORIGIN}/app"
STATE_FILENAME = "gemini-web.json"

CHAT_LANE = "gemini"
BATCH_LANE = "gemini-batch"
CHAT_PAGES = max(1, int(web._env_seconds("CHATMOCK_GEMINI_WEB_CHAT_PAGES", 3)))
TURN_TIMEOUT_SECONDS = web._env_seconds("CHATMOCK_GEMINI_WEB_TURN_TIMEOUT", 45 * 60)
TURN_QUEUE_WAIT_SECONDS = web._env_seconds("CHATMOCK_GEMINI_WEB_QUEUE_WAIT", 60)
READY_TIMEOUT_SECONDS = 60
SEND_TIMEOUT_SECONDS = 45
START_TIMEOUT_SECONDS = 90
POLL_SECONDS = 0.4
LOGIN_TIMEOUT_SECONDS = 15 * 60
IMAGE_ATTACH_TIMEOUT_SECONDS = 60
SIGNED_OUT_MODELS = [{"slug": "auto", "title": "Auto", "description": "Adapts to your needs", "tags": []}]


# --------------------------------------------------------------------------
# Durable state (sign-in + models), beside providers.json
# --------------------------------------------------------------------------

_state_lock = threading.Lock()


def _state_path() -> str:
    import os

    return os.path.join(web._state_dir(), STATE_FILENAME)


def cached_state() -> Dict[str, Any]:
    state = {"signedIn": False, "email": None, "name": None, "checkedAt": None, "models": [], "modelsAt": None}
    try:
        with open(_state_path(), "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if isinstance(loaded, dict):
            state.update({k: v for k, v in loaded.items() if k in state})
    except (OSError, ValueError):
        pass
    return state


def _write_state(**changes: Any) -> Dict[str, Any]:
    import os

    with _state_lock:
        state = cached_state()
        state.update(changes)
        path = _state_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    return state


def cached_models() -> List[Dict[str, Any]]:
    rows = [r for r in cached_state().get("models") or [] if isinstance(r, dict) and isinstance(r.get("slug"), str)]
    return rows or list(SIGNED_OUT_MODELS)


def cached_model_ids() -> List[str]:
    return [row["slug"] for row in cached_models()]


def unavailable_reason() -> str | None:
    # Gemini answers signed out too (on "Auto"), so a page is all it needs.
    return None


# --------------------------------------------------------------------------
# Page scripts (evaluated per call; nothing is installed in the page)
# --------------------------------------------------------------------------

# DOM -> Markdown for one answer. Gemini renders math with `data-math` (LaTeX
# source) and code inside `code-block` with a language header.
_TO_MARKDOWN = r"""
const md = (root) => {
  const inline = (n) => [...n.childNodes].map(walk).join('');
  const walk = (n) => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase();
    if (n.matches('[data-math]')) {
      const tex = n.getAttribute('data-math');
      return n.matches('.math-block, div') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    }
    if (t === 'code-block' || t === 'pre') {
      const code = n.querySelector('code') || n;
      const lang = (n.querySelector('.code-block-decoration > span') || {}).innerText || '';
      // The header is a display name ("Python", "code snippet"), not the fence tag.
      const tag = /^[a-z0-9+#._-]+$/i.test(lang.trim()) ? lang.trim().toLowerCase() : '';
      return `\n\n\`\`\`${tag}\n${code.innerText.replace(/\n$/, '')}\n\`\`\`\n\n`;
    }
    if (n.matches('button, mat-icon, gem-icon-button, .code-block-decoration, sources-carousel-inline, source-footnote, sup.superscript')) return '';
    if (/^h[1-6]$/.test(t)) return `\n\n${'#'.repeat(+t[1])} ${inline(n).trim()}\n\n`;
    if (t === 'p') return `\n\n${inline(n).trim()}\n\n`;
    if (t === 'br') return '\n';
    if (t === 'hr') return '\n\n---\n\n';
    if (t === 'strong' || t === 'b') return `**${inline(n)}**`;
    if (t === 'em' || t === 'i') return `*${inline(n)}*`;
    if (t === 'code') return '`' + n.innerText + '`';
    if (t === 'a') return `[${inline(n)}](${n.getAttribute('href') || ''})`;
    if (t === 'blockquote') return '\n\n' + inline(n).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    if (t === 'ul' || t === 'ol') {
      const items = [...n.children].filter(c => c.tagName.toLowerCase() === 'li');
      const start = +(n.getAttribute('start') || 1);
      return '\n\n' + items.map((li, i) => {
        const body = inline(li).replace(/\n{3,}/g, '\n\n').trim().replace(/\n/g, '\n   ');
        return (t === 'ol' ? `${start + i}. ` : '- ') + body;
      }).join('\n') + '\n\n';
    }
    if (t === 'table') {
      const rows = [...n.querySelectorAll('tr')].map(r => [...r.children].map(c => inline(c).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()));
      if (!rows.length) return '';
      const head = `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |`;
      return '\n\n' + [head, ...rows.slice(1).map(r => `| ${r.join(' | ')} |`)].join('\n') + '\n\n';
    }
    return inline(n);
  };
  return walk(root).replace(/\n{3,}/g, '\n\n').trim();
};
"""

_SNAPSHOT = (
    "(() => {"
    + _TO_MARKDOWN
    + r"""
  const responses = [...document.querySelectorAll('model-response')];
  const last = responses[responses.length - 1];
  const body = last && (last.querySelector('message-content .markdown') || last.querySelector('message-content'));
  const labels = [...document.querySelectorAll('input-area-v2 button, input-container button')].map(b => b.getAttribute('aria-label') || '');
  const alert = [...document.querySelectorAll('[role=alert], snack-bar-container, .mat-mdc-snack-bar-label')].map(e => e.innerText.trim()).filter(Boolean).join(' ');
  return {
    count: responses.length,
    text: body ? md(body) : '',
    generating: labels.some(l => /^stop/i.test(l)),
    finished: !!(last && last.querySelector('message-actions')),
    alert: alert.slice(0, 400),
  };
})()"""
)

_SESSION = r"""(() => {
  const account = document.querySelector('a[aria-label*="Google Account"], a[href*="SignOutOptions"]');
  const label = account ? (account.getAttribute('aria-label') || '') : '';
  const email = (label.match(/\(([^()\s]+@[^()\s]+)\)/) || [])[1] || null;
  const name = (label.match(/Google Account:\s*([^\n(]+)/) || [])[1] || null;
  const signInButton = document.querySelector('[data-test-id=sign-in-button], a[href*="ServiceLogin"]');
  return { signedIn: !!account && !signInButton, email, name: name && name.trim() };
})()"""

_READY = "!!document.querySelector('rich-textarea .ql-editor[contenteditable=true]')"
_DISMISS_CONSENT = "(() => { const b = document.querySelector('[data-test-id=reject-button]'); if (b) b.click(); return !!b; })()"

_PASTE = r"""((text) => {
  const box = document.querySelector('rich-textarea .ql-editor');
  if (!box) return 'no_composer';
  box.focus();
  const data = new DataTransfer();
  data.setData('text/plain', text);
  box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  if (!box.innerText.trim()) document.execCommand('insertText', false, text);
  return box.innerText.trim() ? 'ok' : 'empty';
})"""

_ATTACH = r"""(async (urls) => {
  const box = document.querySelector('rich-textarea .ql-editor');
  if (!box) return 'no_composer';
  box.focus();
  const data = new DataTransfer();
  let i = 0;
  for (const url of urls) {
    const blob = await (await fetch(url)).blob();
    data.items.add(new File([blob], `image-${++i}.${(blob.type.split('/')[1] || 'png')}`, { type: blob.type || 'image/png' }));
  }
  box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  return 'ok';
})"""

_ATTACHED = "document.querySelectorAll('input-area-v2 img, uploader-file-preview, [data-test-id*=file-preview]').length"

_SEND = r"""(() => {
  const button = document.querySelector('button[aria-label="Send message"]');
  if (!button) return 'no_button';
  if (button.getAttribute('aria-disabled') === 'true' || button.disabled) return 'disabled';
  button.click();
  return 'sent';
})()"""

_STOP = "(() => { const b = [...document.querySelectorAll('button')].find(b => /^stop response/i.test(b.getAttribute('aria-label') || '')); if (b) b.click(); return !!b; })()"

_TEMPORARY = r"""(() => {
  const b = [...document.querySelectorAll('button, a')].find(b => /temporary chat/i.test(b.getAttribute('aria-label') || b.getAttribute('mattooltip') || ''));
  if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
  return !!b;
})()"""

_RECT = r"""((selector, label) => {
  const nodes = [...document.querySelectorAll(selector)];
  const el = label == null ? nodes[0] : nodes.find(n => ((n.querySelector('.label') || n).innerText || '').trim().toLowerCase() === label);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
})"""

_MODE_BUTTON = "[data-test-id=bard-mode-menu-button]"
_MODE_ITEMS = "[data-test-id=gem-mode-menu] [role=menuitemradio]"
_MODE_ROWS = r"""[...document.querySelectorAll('[data-test-id=gem-mode-menu] [role=menuitemradio]')].map(n => {
  const label = ((n.querySelector('.label') || n).innerText || '').trim();
  const all = (n.innerText || '').replace(/\s+/g, ' ').trim();
  return { title: label, description: all.slice(label.length).trim(), checked: n.getAttribute('aria-checked') === 'true' };
})"""


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


# --------------------------------------------------------------------------
# A driven page
# --------------------------------------------------------------------------


class _Page:
    def __init__(self, ws_url: str, lane: str) -> None:
        self.lane = lane
        self.cdp = web._Cdp(ws_url, lambda _m, _p: None)
        self.cdp.call("Page.enable", timeout=web.ATTACH_TIMEOUT_SECONDS)
        self.cdp.call("Runtime.enable", timeout=web.ATTACH_TIMEOUT_SECONDS)

    def evaluate(self, expression: str, *, await_promise: bool = False, timeout: float = 30) -> Any:
        result = self.cdp.call(
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
            timeout=timeout,
        )
        if result.get("exceptionDetails"):
            raise ProviderError(f"page script error: {result['exceptionDetails'].get('text')}", phase="protocol")
        return (result.get("result") or {}).get("value")

    def alive(self) -> bool:
        try:
            return not self.cdp.closed.is_set() and self.evaluate("1", timeout=10) == 1
        except ProviderError:
            return False

    def url(self) -> str:
        try:
            return str(self.evaluate("location.href") or "")
        except ProviderError:
            return ""

    def navigate(self, url: str) -> None:
        self.cdp.call("Page.navigate", {"url": url})
        self.wait_ready()

    def wait_ready(self, timeout: float = READY_TIMEOUT_SECONDS) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                # The cookie-consent dialog covers the mode picker; nobody is there to answer it.
                if self.evaluate(_READY, timeout=10) and not self.evaluate(_DISMISS_CONSENT, timeout=10):
                    return
            except ProviderError:
                pass
            time.sleep(0.3)
        raise ProviderError("gemini.google.com did not show its composer.", status_code=503, phase="prepare", replay_safe=True)

    def click(self, selector: str, label: str | None = None) -> bool:
        """A real mouse click: Gemini's menus ignore element.click()."""
        expression = f"({_RECT})({json.dumps(selector)}, {json.dumps(label)})"
        deadline = time.time() + 5  # controls render a moment after the composer
        while not (point := self.evaluate(expression)):
            if time.time() > deadline:
                return False
            time.sleep(0.3)
        for kind in ("mousePressed", "mouseReleased"):
            self.cdp.call(
                "Input.dispatchMouseEvent",
                {"type": kind, "x": point[0], "y": point[1], "button": "left", "clickCount": 1},
                timeout=5,
            )
        return True

    def escape(self) -> None:
        for kind in ("keyDown", "keyUp"):
            self.cdp.call("Input.dispatchKeyEvent", {"type": kind, "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27}, timeout=5)

    def modes(self) -> List[Dict[str, Any]]:
        if not self.click(_MODE_BUTTON):
            return []
        rows: List[Dict[str, Any]] = []
        for _ in range(10):
            time.sleep(0.3)
            rows = self.evaluate(_MODE_ROWS) or []
            if rows:
                break
        self.escape()
        return rows

    def choose_mode(self, slug: str) -> None:
        current = f"document.querySelector('{_MODE_BUTTON}')?.getAttribute('aria-label') || ''"
        for _ in range(2):  # a click while the page is still settling can go unanswered
            if not self.click(_MODE_BUTTON):
                return  # no picker on this page: the site's own default answers
            for _ in range(10):
                time.sleep(0.3)
                rows = self.evaluate(_MODE_ROWS) or []
                match = next((r for r in rows if _slug(r.get("title") or "") == slug), None)
                if match:
                    if match.get("checked"):
                        self.escape()
                    else:
                        self.click(_MODE_ITEMS, (match["title"] or "").lower())
                        time.sleep(0.4)
                    return
                if rows:
                    break
            self.escape()
            if _slug(str(self.evaluate(current)).rsplit("currently", 1)[-1]) == slug:
                return
            time.sleep(0.5)
        raise ProviderError(
            f"Gemini does not offer the {slug!r} mode on this account. Sync models in Settings, Providers, {LABEL}.",
            status_code=400,
            phase="prepare",
        )

    def close(self) -> None:
        self.cdp.close()


@dataclass
class _Lane:
    name: str
    lock: threading.Lock = field(default_factory=threading.Lock)
    page: _Page | None = None
    holder: Dict[str, Any] | None = None


_lanes: Dict[str, _Lane] = {}
_lanes_guard = threading.RLock()


def _lane(name: str) -> _Lane:
    with _lanes_guard:
        return _lanes.setdefault(name, _Lane(name))


def _chat_lanes() -> List[str]:
    return [CHAT_LANE] + [f"{CHAT_LANE}-{n}" for n in range(2, CHAT_PAGES + 1)]


def _ensure_page(lane: str = CHAT_LANE, *, foreground: bool = False) -> _Page:
    with _lanes_guard:
        slot = _lane(lane)
        if slot.page is not None and slot.page.alive():
            if foreground:
                web._bridge_open_tab({}, foreground=True, lane=lane, label="Gemini")
            return slot.page
        wedged = slot.page is not None
        if wedged:
            slot.page.close()
            slot.page = None
        if web._live_bridge() is None:
            raise ProviderError(
                f"{LABEL} runs inside Breadboard's own browser, and no Breadboard window is relaying "
                "for it right now. Open the Breadboard app and try again.",
                status_code=503,
                phase="prepare",
                replay_safe=True,
            )
        # ponytail: no system-browser fallback like OpenAI (web); add it if Gemini is ever needed without the desktop app
        for reset in ((True,) if wedged else (False, True)):
            port, target = web._bridge_open_tab({}, foreground=foreground, reset=reset, lane=lane, label="Gemini")
            try:
                page = _Page(web._page_websocket(port, target_id=target), lane)
                if not page.url().startswith(ORIGIN):
                    page.navigate(APP_URL)
            except web._PageUnresponsive:
                continue
            slot.page = page
            return page
        raise ProviderError("Breadboard's Gemini page stopped responding. Restart Breadboard and try again.", status_code=503, phase="prepare", replay_safe=True)


def _drop_page(lane: str) -> None:
    with _lanes_guard:
        slot = _lane(lane)
        if slot.page is not None:
            slot.page.close()
        slot.page = None


def _record(page: _Page, *, models: bool) -> Dict[str, Any]:
    session = page.evaluate(_SESSION) or {}
    changes: Dict[str, Any] = {
        "signedIn": bool(session.get("signedIn")),
        "email": session.get("email"),
        "name": session.get("name"),
        "checkedAt": web._now_iso(),
    }
    if models:
        rows = page.modes()
        shaped = [
            {"slug": _slug(r["title"]), "title": r["title"], "description": r.get("description") or "", "tags": []}
            for r in rows
            if isinstance(r, dict) and r.get("title")
        ]
        if shaped:
            changes.update(models=shaped, modelsAt=web._now_iso())
    return _write_state(**changes)


# --------------------------------------------------------------------------
# Settings: session, sign-in, sign-out
# --------------------------------------------------------------------------

_login_lock = threading.Lock()
_login: Dict[str, Any] | None = None


def session_state(*, refresh: bool = False) -> Dict[str, Any]:
    error = None
    if refresh:
        try:
            page = _ensure_page()
            if not page.url().startswith(APP_URL):
                page.navigate(APP_URL)
            _record(page, models=True)
        except ProviderError as exc:
            error = str(exc)
    state = cached_state()
    with _login_lock:
        login = dict(_login) if _login else None
    current = _lane(CHAT_LANE).page
    return {
        "signedIn": bool(state.get("signedIn")),
        "email": state.get("email"),
        "name": state.get("name"),
        "plan": None,
        "checkedAt": state.get("checkedAt"),
        "models": cached_models(),
        "modelsAt": state.get("modelsAt"),
        "surface": "desktop",
        "pageConnected": current is not None and not current.cdp.closed.is_set(),
        "bridge": web.bridge_state(),
        "browser": {"available": web._live_bridge() is not None, "executable": None},
        "login": login,
        "error": error,
    }


def start_login() -> Dict[str, Any]:
    """Show the Gemini page and press its Sign in; the shell hands Google's
    sign-in to Edge/Chrome and imports the cookies back (browser-google-signin.ts)."""
    global _login
    with _login_lock:
        if _login and _login.get("status") == "awaiting":
            return session_state()
        _login = {"status": "awaiting", "startedAt": web._now_iso(), "error": None}
    started = _login["startedAt"]

    def finish(status: str, error: str | None = None) -> None:
        global _login
        with _login_lock:
            _login = {"status": status, "startedAt": started, "error": error}

    def run() -> None:
        try:
            page = _ensure_page(foreground=True)
            if not page.url().startswith(APP_URL):
                page.navigate(APP_URL)
            if not (page.evaluate(_SESSION) or {}).get("signedIn"):
                page.click("[data-test-id=sign-in-button], a[href*='ServiceLogin']")
            deadline = time.time() + LOGIN_TIMEOUT_SECONDS
            while time.time() < deadline:
                with _login_lock:
                    if not _login or _login.get("status") != "awaiting":
                        return
                time.sleep(3)
                try:
                    if page.url().startswith(ORIGIN) and (page.evaluate(_SESSION) or {}).get("signedIn"):
                        page.wait_ready()
                        _record(page, models=True)
                        web._bridge_open_tab({}, foreground=False, lane=CHAT_LANE, label="Gemini")
                        finish("done")
                        return
                except ProviderError:
                    pass  # mid-navigation through Google's sign-in
            finish("failed", "Signing in took too long. Try again.")
        except ProviderError as exc:
            finish("failed", str(exc))
        except Exception as exc:  # noqa: BLE001 - the thread must report, not vanish
            finish("failed", f"Sign-in failed: {exc}")

    threading.Thread(target=run, name="gemini-web-login", daemon=True).start()
    return session_state()


def cancel_login() -> Dict[str, Any]:
    global _login
    with _login_lock:
        if _login and _login.get("status") == "awaiting":
            _login = {"status": "cancelled", "startedAt": _login["startedAt"], "error": None}
    return session_state()


def logout() -> Dict[str, Any]:
    """Signs the browser out of Google (every Google site in Breadboard's browser)."""
    try:
        page = _ensure_page()
        page.cdp.call("Page.navigate", {"url": f"https://accounts.google.com/Logout?continue={APP_URL}"})
        time.sleep(3)
    except ProviderError:
        pass
    for name in list(_lanes):
        _drop_page(name)
    _write_state(signedIn=False, email=None, name=None, checkedAt=web._now_iso(), models=[], modelsAt=None)
    cancel_login()
    return session_state()


def sync_models() -> Dict[str, Any]:
    return session_state(refresh=True)


# --------------------------------------------------------------------------
# One turn
# --------------------------------------------------------------------------


def _submit(page: _Page, model: str, prompt: str, images: List[str]) -> int:
    """Open a fresh chat, pick the mode, type, send. Returns the answer count before sending."""
    page.navigate(APP_URL)
    try:
        page.evaluate(_TEMPORARY)  # signed in only; keeps turns out of the person's Gemini history
    except ProviderError:
        pass
    page.choose_mode(model)
    before = int(page.evaluate("document.querySelectorAll('model-response').length") or 0)
    if images:
        page.evaluate(f"({_ATTACH})({json.dumps(images)})", await_promise=True, timeout=60)
        deadline = time.time() + IMAGE_ATTACH_TIMEOUT_SECONDS
        while int(page.evaluate(_ATTACHED) or 0) < len(images):
            if time.time() > deadline:
                raise ProviderError(
                    "Gemini did not accept the attached image. Images need a signed-in Google (web).",
                    status_code=502,
                    phase="send",
                )
            time.sleep(0.5)
    state = page.evaluate(f"({_PASTE})({json.dumps(prompt)})", timeout=180)
    if state != "ok":
        raise ProviderError(f"gemini.google.com would not take the message ({state}).", status_code=503, phase="send", replay_safe=True)
    deadline = time.time() + SEND_TIMEOUT_SECONDS
    while True:
        result = page.evaluate(_SEND)
        if result == "sent":
            return before
        if time.time() > deadline:
            alert = (page.evaluate(_SNAPSHOT) or {}).get("alert")
            raise ProviderError(
                f"Gemini would not send the message{f' - {alert}' if alert else ''}.", status_code=503, phase="send"
            )
        time.sleep(0.4)


def _collect(page: _Page, before: int, on_text: Callable[[str], None] | None, cancel: threading.Event) -> str:
    deadline = time.time() + TURN_TIMEOUT_SECONDS
    start_deadline = time.time() + START_TIMEOUT_SECONDS
    sent = ""
    text = ""
    misses = 0
    while True:
        if cancel.is_set():
            page.evaluate(_STOP)
            raise web._TurnAbandoned("the caller went away", phase="receive")
        if time.time() > deadline:
            page.evaluate(_STOP)
            raise ProviderError("Gemini took too long to answer.", status_code=504, phase="receive")
        try:
            snap = page.evaluate(_SNAPSHOT, timeout=20) or {}
            misses = 0
        except web._PageUnresponsive:
            misses += 1
            if misses >= 3:
                raise
            continue
        if int(snap.get("count") or 0) <= before:
            if time.time() > start_deadline:
                alert = snap.get("alert")
                raise ProviderError(f"Gemini did not start answering{f' - {alert}' if alert else ''}.", status_code=502, phase="receive")
            time.sleep(POLL_SECONDS)
            continue
        text = str(snap.get("text") or "")
        if on_text and text.startswith(sent) and len(text) > len(sent):
            on_text(text[len(sent):])
            sent = text
        if snap.get("finished") and not snap.get("generating"):
            if not text.strip():
                raise ProviderError("Gemini finished without an answer.", status_code=502, phase="receive")
            return text
        time.sleep(POLL_SECONDS)


def _acquire_lane(stream: bool, wait: float) -> str | None:
    lanes = _chat_lanes() if stream else [BATCH_LANE]
    deadline = time.time() + wait
    while True:
        for name in sorted(lanes, key=lambda n: _lane(n).page is None):
            if _lane(name).lock.acquire(blocking=False):
                return name
        if time.time() >= deadline:
            return None
        time.sleep(0.25)  # ponytail: polling, a Condition if many turns ever queue


def request_chat(
    credentials: ResolvedCredentials,
    payload: Dict[str, Any],
    upstream_model: str,
    *,
    stream: bool,
    allow_preconnect_retry: bool = True,
    client_gone: Callable[[], bool] | None = None,
) -> web._WebResponse:
    del credentials, allow_preconnect_retry
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    tools_offered = bool(web._tool_entries(payload.get("tools")))
    prompt = web.compose_prompt(messages, payload.get("tools"))
    if not prompt.strip():
        return web._WebResponse(400, {"error": {"message": "The request had no message to send."}})
    completion_id = f"chatcmpl-{uuid4().hex}"
    created = int(time.time())
    public_model = f"{PROVIDER_ID}/{upstream_model}"

    lane = _acquire_lane(stream, TURN_QUEUE_WAIT_SECONDS if stream else TURN_TIMEOUT_SECONDS)
    if lane is None:
        busy = web._WebResponse(503, {"error": {"message": f"All of {LABEL}'s pages are still answering other messages. Let one finish and send again."}})
        busy.fallback_ok = False
        return busy
    slot = _lane(lane)
    slot.holder = {"label": web._describe_caller(payload, upstream_model, stream=stream), "since": time.time()}
    cancel = threading.Event()
    released = threading.Event()

    def release() -> None:
        if not released.is_set():
            released.set()
            slot.holder = None
            slot.lock.release()

    try:
        page = _ensure_page(lane)
        before = _submit(page, upstream_model, prompt, web._image_data_urls(messages))
    except ProviderError as exc:
        if isinstance(exc, web._PageUnresponsive):
            _drop_page(lane)
        release()
        return web._WebResponse(exc.status_code or 502, {"error": {"message": str(exc)}})
    except Exception as exc:  # noqa: BLE001 - never leave the lock held
        release()
        return web._WebResponse(502, {"error": {"message": f"{LABEL} failed before sending: {exc}"}})

    prompt_tokens = web._estimate_tokens(prompt)

    def usage(text: str) -> Dict[str, int]:
        out = web._estimate_tokens(text)
        return {"prompt_tokens": prompt_tokens, "completion_tokens": out, "total_tokens": prompt_tokens + out}

    if not stream:
        stop = threading.Event()
        watcher = web._watch_client(client_gone, cancel, stop)
        try:
            text = _collect(page, before, None, cancel)
        except ProviderError as exc:
            return web._WebResponse(exc.status_code or 502, {"error": {"message": str(exc)}})
        finally:
            stop.set()
            if watcher is not None:
                watcher.join(2)
            release()
        tool_calls = web._parse_tool_calls(text) if tools_offered else None
        return web._WebResponse(
            200,
            transport.chat_completion(
                completion_id=completion_id,
                created=created,
                model=public_model,
                content="" if tool_calls else text,
                finish_reason="tool_calls" if tool_calls else "stop",
                tool_calls=tool_calls,
                usage=usage(text),
            ),
        )

    include_usage = bool(isinstance(payload.get("stream_options"), dict) and payload["stream_options"].get("include_usage"))

    def chunk(delta: Dict[str, Any] | None = None, **extra: Any) -> bytes:
        return transport.sse_chunk(
            transport.chat_chunk(completion_id=completion_id, created=created, model=public_model, delta=delta or {}, **extra)
        )

    def generate() -> Iterator[bytes]:
        chunks: "queue.Queue[bytes | None]" = queue.Queue()
        failure: List[ProviderError] = []
        # A tool call must never be streamed as prose (see chatgpt_web.request_chat).
        held: List[str] = []
        holding = [tools_offered]

        def emit(delta: str) -> None:
            if holding[0]:
                held.append(delta)
                seen = "".join(held).lstrip()
                # Gemini drops the fence's tool_call tag, so any leading code block may be the call.
                if not seen or seen.startswith(("```", "{")):
                    return
                holding[0] = False
                delta = "".join(held)
                held.clear()
            chunks.put(chunk({"content": delta}))

        def worker() -> None:
            try:
                text = _collect(page, before, emit, cancel)
                tool_calls = web._parse_tool_calls(text) if tools_offered else None
                if tool_calls:
                    chunks.put(chunk({"tool_calls": [{"index": 0, **tool_calls[0]}]}))
                elif held:
                    chunks.put(chunk({"content": "".join(held)}))
                chunks.put(chunk(finish_reason="tool_calls" if tool_calls else "stop", usage=usage(text) if include_usage else None))
                chunks.put(transport.SSE_DONE)
            except web._TurnAbandoned:
                pass
            except ProviderError as exc:
                failure.append(exc)
            except Exception as exc:  # noqa: BLE001
                failure.append(ProviderError(f"{LABEL} stopped mid-answer: {exc}", phase="receive"))
            finally:
                chunks.put(None)
                release()

        started.set()
        thread = threading.Thread(target=worker, name="gemini-web-turn", daemon=True)
        thread.start()
        try:
            yield chunk({"role": "assistant", "content": ""})
            while True:
                try:
                    item = chunks.get(timeout=web.STREAM_HEARTBEAT_SECONDS)
                except queue.Empty:
                    yield chunk()  # a real empty chunk keeps Hermes' stale-stream watchdog fed
                    continue
                if item is None:
                    break
                yield item
            if failure:
                raise failure[0]
        finally:
            cancel.set()  # a client that left mid-answer stops the site; the worker releases the page

    started = threading.Event()

    def close() -> None:
        cancel.set()
        if not started.is_set():
            release()  # the stream was never read, so no worker will let the page go

    return web._WebResponse(200, None, stream=generate, on_close=close)


relay_stream = web.relay_stream


def call_model(call: ModelCall, credentials: ResolvedCredentials, upstream_model: str) -> str:
    messages: List[Dict[str, Any]] = []
    if isinstance(call.system, str) and call.system.strip():
        messages.append({"role": "system", "content": call.system})
    messages.extend(call.messages or [])
    response = request_chat(credentials, {"messages": messages}, upstream_model, stream=False)
    if response.status_code >= 400:
        raise ProviderError(
            transport.error_message(response, credentials.provider_id),  # type: ignore[arg-type]
            status_code=response.status_code,
            phase="upstream",
            replay_safe=response.status_code in (401, 403, 429),
            code="http_error",
        )
    body = response.json()
    usage = body.get("usage") or {}
    call.usage_out = ModelTokenUsage(
        input_tokens=int(usage.get("prompt_tokens", 0)),
        output_tokens=int(usage.get("completion_tokens", 0)),
        total_tokens=int(usage.get("total_tokens", 0)),
    )
    return str(body["choices"][0]["message"].get("content") or "")


def list_models(credentials: ResolvedCredentials) -> List[str]:
    del credentials
    return cached_model_ids()


def verify(credentials: ResolvedCredentials) -> Dict[str, Any]:
    del credentials
    state = session_state(refresh=True)
    if state.get("error"):
        return {"ok": False, "error": state["error"]}
    return {"ok": True, "models": [row["slug"] for row in state["models"]], "email": state.get("email")}
