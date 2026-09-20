from __future__ import annotations

"""ChatGPT through chatgpt.com itself, in a browser the person signed into.

Modelled on Chat On Steroids (github.com/totec448-spec/chat-on-steroids): no
API key and no OAuth client. The person signs in to chatgpt.com in a real
browser window exactly as they would to use the site, and every request is a
message typed into that site's composer. What the website offers is what this
provider offers - the plan's own models and the plan's own limits - which is
the whole point of a second OpenAI provider next to the Codex-backed one.

Where Chat On Steroids pairs a companion extension with its app, ChatMock
drives a page over the DevTools protocol. Two surfaces can supply that page:

* **Breadboard's own browser.** The desktop shell exposes its built-in
  Chromium over a loopback CDP port (it already does for browser-agent runs).
  ChatMock queues "open the ChatGPT tab" requests; a dashboard page relays
  them to the shell over its preload bridge and posts back the CDP target
  ChatMock then attaches to (see "The shell bridge" below). The tab lives in
  the ``persist:breadboard-browser`` partition, so the sign-in survives
  restarts and is the same session the person browses chatgpt.com with.
* **A system Chrome/Edge**, launched by ChatMock on its own profile, when no
  shell is around (a plain ``npm run dev`` in a browser).

The page script is a port of the extension's approach: chatgpt-dom.js's
composer insert/send (``execCommand('insertHTML')`` plus the site's own send
button) and usage.js's passive ``fetch`` observer, which reads the conversation
event stream the page itself receives rather than scraping rendered HTML. A
rendered-DOM reader stays behind it for accounts whose stream arrives another
way (ChatGPT has shipped a WebSocket transport to some users).

Every chat completion is one *temporary* chat: the transcript is composed into
a single message, the page opens ``/?temporary-chat=true&model=<slug>``, the
answer streams back, and nothing lands in the person's ChatGPT history.
"""

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
from datetime import datetime, timezone
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional
from urllib import request as urllib_request
from urllib.parse import quote
from uuid import uuid4

from . import transport
from .store import ResolvedCredentials
from .types import ModelCall, ModelTokenUsage, ProviderError
from ..utils import get_home_dir

PROVIDER_ID = "openaiweb"
ORIGIN = "https://chatgpt.com"
LOGIN_URL = f"{ORIGIN}/auth/login"
BOOTSTRAP_PREFIX = "about:blank#breadboard-chatgpt-web="
BINDING = "__breadboardChatgptWebEmit"

STATE_FILENAME = "chatgpt-web.json"
PROFILE_DIRNAME = "chatgpt-web-profile"

def _env_seconds(name: str, default: float) -> float:
    """An operator override for one of the budgets below, in seconds."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(str(raw).strip())
    except ValueError:
        return default
    return value if value > 0 else default


# A thinking model can take minutes; a turn that says nothing for this long
# while the page still shows Stop is treated as lost rather than waited on.
# The site's deepest reasoning models (Pro above all) routinely think for ten
# minutes or more before the first word, so this is a wall a person hits, not
# a safety margin: keep it well past the longest answer anyone waits for and
# let the idle checks in `_collect_turn` end a turn that is genuinely over.
TURN_TIMEOUT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_TURN_TIMEOUT", 45 * 60)
SEND_TIMEOUT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_SEND_TIMEOUT", 45)
PAGE_READY_TIMEOUT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_READY_TIMEOUT", 90)
# A page rendering a long answer can leave one `Runtime.evaluate` unanswered
# past its deadline and then answer the next immediately: that is a busy
# renderer, not a dead one. Reads taken during a turn get this budget and are
# re-asked (see `_Page.evaluate`) instead of failing the turn.
EVAL_TIMEOUT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_EVAL_TIMEOUT", 30)
# Placing the transcript in the composer is the one edit whose cost grows with
# the conversation, and it is never re-issued (see `_submit_turn`), so it gets a
# budget of its own rather than an ordinary evaluation's.
INSERT_TIMEOUT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_INSERT_TIMEOUT", 180)
EVAL_ATTEMPTS = 3
# How long a caller waits when another turn already holds the page. One page
# means one conversation at a time, so a second request either gets its turn
# soon or is told to send again - queueing behind a thinking model for half an
# hour is indistinguishable from a request that has hung.
TURN_QUEUE_WAIT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_QUEUE_WAIT", 60)
# How long an abandoned turn is given to notice it was cancelled and let go of
# the page before the next turn may start.
TURN_CANCEL_JOIN_SECONDS = 10
# A deep reasoning turn can think for many minutes before its first word, and a
# stream that sends nothing at all in that time is a stream something between
# here and the client is free to consider dead. The heartbeat is a real chunk
# with an empty delta, not an SSE comment: Hermes's stale-stream watchdog
# resets on chunks its SDK parsed, and the SDK drops comment lines before the
# watchdog sees them - measured 2026-09-14 as fifteen minutes of `: still
# thinking` counted as silence, the stream killed at Hermes's 900 s local
# ceiling, and GPT 6 Pro's answer discarded two seconds after arriving.
STREAM_HEARTBEAT_SECONDS = 15
# How long a turn whose POST handed the answer off to the site's WebSocket
# waits for that stream before reading the rendered page instead.
HANDOFF_GRACE_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_HANDOFF_GRACE", 20)
# How long the socket may stay silent before the rendered page is read again
# (a long think between deltas, or a socket that dropped).
SOCKET_QUIET_READ_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_SOCKET_QUIET_READ", 120)
# Images travel as pasted files. The site uploads each one before Send lights
# up; a handful of screenshots takes seconds, so this is a ceiling, not a wait.
IMAGE_ATTACH_TIMEOUT_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_ATTACH_TIMEOUT", 90)
MAX_IMAGE_ATTACHMENTS = 10
MAX_IMAGE_BYTES = 20 * 1024 * 1024
# Consecutive turn-time reads that go unanswered before the page is called
# wedged rather than busy. Each read has already been re-asked, so this is
# minutes of a renderer saying nothing at all.
COLLECT_UNRESPONSIVE_LIMIT = 3
# Attaching is the one exchange that must be quick: a renderer that crashed or
# stopped pumping its main thread keeps its DevTools target listed and answers
# nothing at all, and waiting the full call timeout for that only delays the
# one thing that fixes it - asking the shell for a fresh page.
ATTACH_TIMEOUT_SECONDS = 15
# How long a bridge announcement is believed without being renewed. The shell
# re-announces every half minute, so a dead shell falls out quickly.
BRIDGE_TTL_SECONDS = 120
SESSION_CACHE_SECONDS = 45
LOGIN_TIMEOUT_SECONDS = 15 * 60

# The two pages ChatMock keeps on chatgpt.com (see `_Lane`). A streaming
# caller is a person's chat; everything else is batch work.
INTERACTIVE_LANE = "interactive"
BATCH_LANE = "batch"
LANES = (INTERACTIVE_LANE, BATCH_LANE)

# Reasoning depths the site's own picker understands, as chat-on-steroids
# forwards them in the URL. Anything else is dropped rather than guessed.
WEB_REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "pro")

# Legacy slugs the models endpoint still lists for some accounts; nothing a
# person would pick from a menu.
_HIDDEN_SLUG_PREFIXES = ("text-davinci",)


def _is_work_model(slug: str) -> bool:
    """chatgpt.com's Work-mode entries: `gpt-5.6-sol-wm`, `gpt-6-astra-wm`, and
    the `gpt-reserve` pool they fall back to.

    The site's model list returns them beside the chat models, under the same
    titles ("GPT-5.6 Sol"), but a turn on one runs as the Work experience
    (`requested_model_experience: "work"`) on the account's Work/Codex
    allowance - not the web chat this provider stands for. Measured
    2026-09-14 with that allowance spent: the site still answered, from its
    reserve, and ended every long answer after about 8,500 characters with a
    normal `[DONE]`, so a Learn stage parsed half a JSON object as a success.
    The chat model (`gpt-5-6-thinking`) returned the same answer in full.
    """
    return slug.endswith("-wm") or slug == "gpt-reserve"


# --------------------------------------------------------------------------
# Paths and durable state
# --------------------------------------------------------------------------


def _state_dir() -> str:
    """Beside ``providers.json``: the same home in production, and the same
    temporary directory a test isolates the provider store into - so a
    developer's real sign-in never leaks web models into a test's catalog."""
    from . import store

    return os.path.dirname(store.settings_path()) or get_home_dir()


def state_path() -> str:
    return os.path.join(_state_dir(), STATE_FILENAME)


def profile_dir() -> str:
    explicit = (os.getenv("CHATMOCK_CHATGPT_WEB_PROFILE") or "").strip()
    if explicit:
        return os.path.abspath(explicit)
    return os.path.join(_state_dir(), PROFILE_DIRNAME)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


_state_lock = threading.Lock()
_state_cache: tuple[float, Dict[str, Any]] | None = None


def _default_state() -> Dict[str, Any]:
    return {
        "signedIn": False,
        "email": None,
        "name": None,
        "plan": None,
        "checkedAt": None,
        "models": [],
        "modelsAt": None,
        "surface": None,
    }


def cached_state() -> Dict[str, Any]:
    """The last sign-in/model snapshot on disk. Cheap: every ``/v1/models``
    call reads it, so it never touches a browser."""
    global _state_cache
    path = state_path()
    with _state_lock:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            _state_cache = None
            return _default_state()
        if _state_cache and _state_cache[0] == mtime:
            return dict(_state_cache[1])
        try:
            with open(path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
        except (OSError, ValueError):
            return _default_state()
        state = _default_state()
        if isinstance(loaded, dict):
            state.update({k: v for k, v in loaded.items() if k in state})
        if not isinstance(state.get("models"), list):
            state["models"] = []
        _state_cache = (mtime, state)
        return dict(state)


def _write_state(**changes: Any) -> Dict[str, Any]:
    global _state_cache
    state = cached_state()
    state.update(changes)
    path = state_path()
    with _state_lock:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.tmp.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        _state_cache = None
    return state


def is_signed_in() -> bool:
    return bool(cached_state().get("signedIn"))


def cached_models() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in cached_state().get("models") or []:
        # A list cached before Work-mode entries were hidden still holds them.
        if isinstance(row, dict) and isinstance(row.get("slug"), str) and row["slug"].strip() and not _is_work_model(row["slug"]):
            out.append(row)
    return out


def cached_model_ids() -> List[str]:
    return [row["slug"] for row in cached_models()]


#: How long a recorded signed-out verdict keeps refusing turns before the
#: provider re-checks the live page. A sign-in performed in the app (or a page
#: that was simply not probed yet) must not leave the provider refusing
#: forever: on 2026-09-17 a never-probed state file (checkedAt null) blocked
#: every Learn call for hours while chatting through the same page worked.
SIGNED_OUT_CACHE_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_SIGNED_OUT_CACHE", 300)


def _signed_out_verdict_is_fresh(state: Dict[str, Any]) -> bool:
    checked_at = state.get("checkedAt")
    if not isinstance(checked_at, str) or not checked_at:
        # Never probed: nothing was verified, so nothing may be refused.
        return False
    try:
        checked = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - checked).total_seconds()
    return 0 <= age < SIGNED_OUT_CACHE_SECONDS


def unavailable_reason() -> str | None:
    """Why this provider cannot serve right now, or None when it can.

    A signed-out verdict is only trusted while it is fresh. Once it ages out,
    the turn path's own live `_probe_session` decides - and refreshes the
    cache - so a sign-in in the app takes effect without restarting ChatMock.
    """
    state = cached_state()
    if state.get("signedIn"):
        return None
    if _signed_out_verdict_is_fresh(state):
        return "not signed in to chatgpt.com"
    return None


# --------------------------------------------------------------------------
# The shell bridge (Breadboard's own browser)
# --------------------------------------------------------------------------
#
# ChatMock cannot reach the desktop shell directly: the shell has no HTTP
# surface of its own and Runtime V2 keeps every service's control token
# separate. What every Breadboard page does have is the shell's preload
# bridge, which can open tabs. So the exchange runs through one such page:
# a small agent in the dashboard long-polls `pending_tab_requests`, asks the
# shell to open (or find) its ChatGPT tab, and posts the CDP target back with
# `answer_tab_request`. Its polling is also how ChatMock knows a shell is
# there at all; when nobody has polled for a while the system browser takes
# over.

_bridge_lock = threading.Condition()
_tab_requests: Dict[str, Dict[str, Any]] = {}
_tab_answers: Dict[str, Dict[str, Any]] = {}
_agent_seen_at: float = 0.0
_agent_cdp_port: int | None = None
TAB_REQUEST_TIMEOUT_SECONDS = 40
TAB_POLL_MAX_WAIT_SECONDS = 25


def note_agent_seen(cdp_port: Any = None) -> None:
    global _agent_seen_at, _agent_cdp_port
    with _bridge_lock:
        _agent_seen_at = time.time()
        if isinstance(cdp_port, int) and 0 < cdp_port < 65536:
            _agent_cdp_port = cdp_port


def clear_bridge() -> None:
    global _agent_seen_at, _agent_cdp_port
    with _bridge_lock:
        _agent_seen_at = 0.0
        _agent_cdp_port = None
        _tab_requests.clear()
        _tab_answers.clear()
        _bridge_lock.notify_all()


def _live_bridge() -> Dict[str, Any] | None:
    with _bridge_lock:
        if not _agent_seen_at or time.time() - _agent_seen_at > BRIDGE_TTL_SECONDS:
            return None
        return {"cdpPort": _agent_cdp_port, "seenAt": _agent_seen_at}


def bridge_state() -> Dict[str, Any]:
    live = _live_bridge()
    return {"connected": live is not None, "cdpPort": live.get("cdpPort") if live else None}


def pending_tab_requests(*, wait: float = 0.0) -> List[Dict[str, Any]]:
    """Tab requests waiting for the shell, holding up to ``wait`` seconds for
    one to appear. Every poll is also the agent's heartbeat."""
    note_agent_seen()
    deadline = time.time() + max(0.0, min(wait, TAB_POLL_MAX_WAIT_SECONDS))
    with _bridge_lock:
        while not _tab_requests:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            _bridge_lock.wait(remaining)
        return [dict(entry) for entry in _tab_requests.values()]


def answer_tab_request(nonce: Any, payload: Any) -> bool:
    """The agent's reply for one request: the tab's CDP address, or why not."""
    if not isinstance(nonce, str) or not isinstance(payload, dict):
        return False
    with _bridge_lock:
        if nonce not in _tab_requests:
            return False
        answer: Dict[str, Any] = {}
        port = payload.get("cdpPort")
        target = payload.get("targetId")
        if isinstance(port, int) and 0 < port < 65536 and isinstance(target, str) and target.strip():
            answer = {"cdpPort": port, "targetId": target.strip()}
            lane = payload.get("lane")
            if isinstance(lane, str) and lane.strip():
                answer["lane"] = lane.strip()
            note_agent_seen(port)
        else:
            error = payload.get("error")
            answer = {"error": error if isinstance(error, str) and error.strip() else "the shell could not open the tab"}
        _tab_answers[nonce] = answer
        _tab_requests.pop(nonce, None)
        _bridge_lock.notify_all()
        return True


def _bridge_open_tab(
    bridge: Dict[str, Any],
    *,
    foreground: bool,
    reset: bool = False,
    lane: str = INTERACTIVE_LANE,
) -> tuple[int, str]:
    """Ask the shell for its ChatGPT tab: ``(cdp port, CDP target id)``.

    The shell reuses the tab it already has (activating it when asked to
    bring it forward) and only creates one when none is open, so the target
    id is stable for as long as the person leaves the tab alone. ``reset``
    is the one way to break that: the shell throws its page away and builds a
    new one, which is what a page that has stopped answering CDP needs.

    ``lane`` names which of the shell's pages is wanted (see ``_Lane``). A
    shell that keeps a page per lane echoes the lane in its answer; one that
    does not (an older shell, or an older dashboard relaying between the
    two) answers with its only page, and that silence is recorded so every
    lane shares that page as before - two lanes on one composer would be
    two turns typed over each other.
    """
    del bridge
    global _lanes_supported
    nonce = uuid4().hex
    with _bridge_lock:
        _tab_requests[nonce] = {
            "nonce": nonce,
            "foreground": bool(foreground),
            "reset": bool(reset),
            "lane": lane,
            "requestedAt": _now_iso(),
        }
        _bridge_lock.notify_all()
        deadline = time.time() + TAB_REQUEST_TIMEOUT_SECONDS
        while nonce not in _tab_answers:
            remaining = deadline - time.time()
            if remaining <= 0:
                _tab_requests.pop(nonce, None)
                raise ProviderError(
                    "Breadboard's browser did not answer the request for a ChatGPT tab. "
                    "Keep a Breadboard window open and try again.",
                    status_code=503,
                    phase="prepare",
                    replay_safe=True,
                )
            _bridge_lock.wait(remaining)
        answer = _tab_answers.pop(nonce)
    if "error" in answer:
        raise ProviderError(
            f"Breadboard's browser could not open a ChatGPT tab: {answer['error']}",
            status_code=503,
            phase="prepare",
            replay_safe=True,
        )
    with _lifecycle_lock:
        _lanes_supported = answer.get("lane") == lane
    return int(answer["cdpPort"]), str(answer["targetId"])


# Loopback only, and never through a proxy: a machine-wide HTTP_PROXY must not
# swallow the request for a browser target on 127.0.0.1.
_loopback_opener = urllib_request.build_opener(urllib_request.ProxyHandler({}))


def _http_json(url: str, *, timeout: float = 20) -> Any:
    req = urllib_request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    with _loopback_opener.open(req, timeout=timeout) as response:  # noqa: S310 - loopback only
        raw = response.read()
    return json.loads(raw.decode("utf-8")) if raw else None


# --------------------------------------------------------------------------
# DevTools protocol client
# --------------------------------------------------------------------------


class _PageUnresponsive(ProviderError):
    """The page holds its DevTools socket open and answers nothing.

    A crashed renderer stays listed as a target and accepts commands it will
    never reply to, so this is what "reattach to the same page" looks like
    from here. Only a fresh page fixes it.
    """


class _TurnAbandoned(ProviderError):
    """Nobody is waiting for this answer any more.

    The client closed the stream (a retry, a closed tab), so the collector
    stops the site's generation and lets go of the page instead of polling on
    to its deadline - and reading the *next* turn's page while it does.
    """


class _Cdp:
    """A minimal page-level DevTools client on ``websockets``' sync API.

    One thread pumps incoming frames: responses settle their waiting callers,
    events go to the listener. Everything the page script sends back arrives
    as ``Runtime.bindingCalled``.
    """

    def __init__(self, ws_url: str, on_event: Callable[[str, Dict[str, Any]], None]) -> None:
        from websockets.sync.client import connect as websocket_connect

        self._ws = websocket_connect(ws_url, max_size=None, open_timeout=10, close_timeout=2)
        self._on_event = on_event
        self._next_id = 0
        self._pending: Dict[int, tuple[threading.Event, Dict[str, Any]]] = {}
        self._lock = threading.Lock()
        self.closed = threading.Event()
        self._pump = threading.Thread(target=self._run, name="chatgpt-web-cdp", daemon=True)
        self._pump.start()

    def _run(self) -> None:
        try:
            for raw in self._ws:
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(message, dict):
                    continue
                if "id" in message:
                    with self._lock:
                        waiter = self._pending.pop(message["id"], None)
                    if waiter:
                        waiter[1].update(message)
                        waiter[0].set()
                    continue
                method = message.get("method")
                if isinstance(method, str):
                    try:
                        self._on_event(method, message.get("params") or {})
                    except Exception:  # noqa: BLE001 - a listener bug must not kill the pump
                        pass
        except Exception:  # noqa: BLE001 - the socket closing is the normal exit
            pass
        finally:
            self.closed.set()
            with self._lock:
                pending = list(self._pending.values())
                self._pending.clear()
            for event, slot in pending:
                slot["error"] = {"message": "the browser connection closed"}
                event.set()

    def call(self, method: str, params: Dict[str, Any] | None = None, *, timeout: float = 30) -> Dict[str, Any]:
        if self.closed.is_set():
            raise ProviderError("the browser connection closed", phase="send")
        with self._lock:
            self._next_id += 1
            call_id = self._next_id
            done = threading.Event()
            slot: Dict[str, Any] = {}
            self._pending[call_id] = (done, slot)
        try:
            self._ws.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._pending.pop(call_id, None)
            raise ProviderError(f"the browser connection failed ({method})", phase="send") from exc
        if not done.wait(timeout):
            with self._lock:
                self._pending.pop(call_id, None)
            raise _PageUnresponsive(f"the browser did not answer {method} in time", phase="receive")
        error = slot.get("error")
        if error:
            raise ProviderError(f"{method}: {error.get('message', 'failed')}", phase="protocol")
        result = slot.get("result")
        return result if isinstance(result, dict) else {}

    def close(self) -> None:
        try:
            self._ws.close()
        except Exception:  # noqa: BLE001
            pass


def _page_websocket(cdp_port: int, *, target_id: str | None = None, timeout: float = 15) -> str:
    """The page target's websocket URL, waiting for it to be listed.

    With a target id (the shell's tab) the match is exact. Without one (the
    system browser, which ChatMock owns outright) the chatgpt.com page wins,
    else whatever page the browser opened with.
    """
    deadline = time.time() + timeout
    last_error = "no page target was listed"
    while time.time() < deadline:
        try:
            targets = _http_json(f"http://127.0.0.1:{cdp_port}/json/list", timeout=3)
        except Exception as exc:  # noqa: BLE001
            targets = None
            last_error = str(exc)
        if isinstance(targets, list):
            pages = [t for t in targets if isinstance(t, dict) and t.get("type") == "page"]
            if target_id is not None:
                chosen = next((t for t in pages if t.get("id") == target_id), None)
            else:
                chosen = next((t for t in pages if str(t.get("url", "")).startswith(ORIGIN)), None) or (
                    pages[0] if pages else None
                )
            ws = chosen.get("webSocketDebuggerUrl") if chosen else None
            if isinstance(ws, str) and ws.startswith("ws://"):
                return ws
        time.sleep(0.2)
    raise ProviderError(f"the ChatGPT tab could not be reached ({last_error})", status_code=503, phase="prepare", replay_safe=True)


# --------------------------------------------------------------------------
# The page script (runs inside chatgpt.com)
# --------------------------------------------------------------------------

# Ported from chat-on-steroids' extension: the selectors in chatgpt-dom.js and
# the response observer in usage.js. Nothing here reads cookies or the
# access token beyond calling the site's own same-origin endpoints; what
# crosses to ChatMock is the answer text, the model slug the page sent, and
# the signed-in account's email.
PAGE_SCRIPT = r"""
(() => {
  if (window.__breadboardChatgptWeb) return;
  const EMIT = '__breadboardChatgptWebEmit';
  const emit = (payload) => {
    try { if (typeof window[EMIT] === 'function') window[EMIT](JSON.stringify(payload)); } catch (_) {}
  };
  const STOP = 'button[data-testid="stop-button"], button[data-testid="composer-stop-button"], ' +
    'button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop answering"]';
  const SEND = 'button[data-testid="send-button"], form button[aria-label^="Send" i], button[aria-label^="Send" i]';
  const TURN = 'section[data-testid^="conversation-turn"], article[data-testid^="conversation-turn"]';
  // Where the site puts the sentence explaining a refusal: a spent cap for the
  // chosen model, an upgrade prompt, a rate limit. Read only when Send never
  // becomes clickable, and never as the answer itself.
  const NOTICE = '[role="alert"], [data-testid*="limit" i], [data-testid*="rate" i], ' +
    'form [class*="text-token-text-error" i], main [class*="text-token-text-error" i]';
  // `f/` is the signed-in stream, `anon/` the logged-out one; the answer shape is the same.
  const CONVERSATION_ROUTE = /^\/backend-api\/(?:(?:f|anon)\/)?conversation$/;
  const MODELS_ROUTE = /^\/backend-api\/models(?:\?|$)/;

  // `expect` is what this turn's own message looks like on the wire: the
  // message ids its POST sent and, once known, its conversation id.
  const state = { turn: null, latestModels: null, seen: [], expect: null };

  // ---- composer (chatgpt-dom.js port) --------------------------------------
  // Signed in, the composer is the ProseMirror editor chatgpt-dom.js anchors on
  // (#prompt-textarea). Signed out - which is what the sign-in tab shows first -
  // the site mounts a plain textarea named "prompt" instead; both are accepted so
  // readiness can be judged either way, and insert() handles each in its own idiom.
  const composer = () => document.querySelector('#prompt-textarea') || document.querySelector('textarea[name="prompt"]');
  const isTextarea = (box) => !!box && box.tagName === 'TEXTAREA';
  const stopButton = () => document.querySelector(STOP);
  const sendButton = () => {
    const buttons = [...document.querySelectorAll(SEND)].filter(b => b.getClientRects().length > 0);
    return buttons.length ? buttons[buttons.length - 1] : null;
  };
  const enabled = (button) => !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  function ready() {
    const box = composer();
    if (!box || !box.isConnected || stopButton()) return false;
    if (isTextarea(box)) return !box.disabled && !box.readOnly;
    if (box.getAttribute('aria-disabled') === 'true' || box.getAttribute('contenteditable') === 'false') return false;
    return true;
  }
  function insertIntoTextarea(box, value) {
    // React owns the field: write through the prototype setter it did not
    // wrap, then tell it something was typed.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!setter || typeof setter.set !== 'function') return 'native_edit_rejected';
    box.focus();
    setter.set.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return box.value === value ? 'ok' : 'text_mismatch';
  }
  const sameText = (box, value) => {
    const compact = (text) => String(text || '').replace(/\s+/g, '');
    return compact(box.textContent) === compact(value);
  };
  // Every turn carries the whole transcript as one message, so this text grows
  // with the conversation. Handing that to execCommand('insertHTML') makes the
  // editor parse a document-sized HTML string: on a long chat it takes minutes
  // and has taken the renderer down with it. A paste of plain text is the path
  // the editor is built for and keeps the line breaks. The HTML edit stays
  // behind it, for an editor that ignores a synthetic paste.
  // A paste the editor accepts is accepted however it chose to hold it. A long
  // one it turns into a "Pasted text" attachment rather than composer content,
  // which is what a person pasting a transcript gets - and measured
  // 2026-09-14, demanding the text back out of the box instead (556,928
  // characters of it) is exactly what leaves Send greyed out forever. What
  // settles it is whether the site then lets the message be sent, which is
  // what send() already waits for.
  function pasteInto(box, value) {
    try {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      box.dispatchEvent(event);
      return event.defaultPrevented;
    } catch (error) {
      return false;
    }
  }
  function insert(value) {
    const box = composer();
    if (!box) return 'composer_missing';
    try {
      if (isTextarea(box)) return insertIntoTextarea(box, value);
      box.focus();
      const selection = document.getSelection();
      if (!selection) return 'selection_missing';
      selection.selectAllChildren(box);
      if (document.activeElement !== box) return 'composer_not_focused';
      if (pasteInto(box, value)) return 'ok';
      selection.selectAllChildren(box);
      const paragraph = document.createElement('p');
      value.split('\n').forEach((line, index) => {
        if (index) paragraph.append(document.createElement('br'));
        paragraph.append(document.createTextNode(line));
      });
      if (!document.execCommand('insertHTML', false, paragraph.innerHTML)) return 'native_edit_rejected';
      if (!sameText(box, value)) return 'text_mismatch';
      return 'ok';
    } catch (error) {
      return 'insertion_exception';
    }
  }
  // ---- attachments ---------------------------------------------------------
  // An image part arrives as a data: URL. The site takes a pasted File the
  // same way it takes one from the clipboard: it uploads it, shows it in the
  // composer, and keeps Send disabled until the upload is done - which is
  // what send() already waits for. Verified 2026-09-14 on the live site.
  function dataUrlToFile(url, name) {
    const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url);
    if (!match) return null;
    const type = match[1] || 'application/octet-stream';
    let bytes;
    if (match[2]) {
      const binary = atob(match[3]);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
    }
    return new File([bytes], name, { type });
  }
  function attach(urls) {
    const box = composer();
    if (!box) return 'composer_missing';
    if (isTextarea(box)) return 'unsupported';
    let attached = 0;
    try {
      box.focus();
      urls.forEach((url, index) => {
        const ext = (/^data:image\/(png|jpe?g|gif|webp)/i.exec(url) || [])[1] || 'png';
        const file = dataUrlToFile(url, 'image-' + (index + 1) + '.' + ext);
        if (!file) return;
        // One paste per file: that is what a person does, and what the site
        // has been seen to handle.
        const data = new DataTransfer();
        data.items.add(file);
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        box.dispatchEvent(event);
        if (event.defaultPrevented) attached += 1;
      });
    } catch (error) {
      return 'attach_exception';
    }
    return attached === urls.length ? 'ok' : 'paste_ignored:' + attached;
  }
  // Uploaded images the composer is holding for the next message.
  function attachments() {
    return document.querySelectorAll('form img[src*="/backend-api/"], form img[src^="blob:"]').length;
  }
  function send(timeoutMs) {
    return new Promise((resolve) => {
      const box = composer();
      if (!box || stopButton()) return resolve('not_ready');
      let clicked = false, done = false;
      const finish = (value) => { if (done) return; done = true; observer.disconnect(); clearTimeout(timer); resolve(value); };
      const drafted = () => {
        const current = composer();
        if (!current) return '';
        return (isTextarea(current) ? current.value : current.textContent || '').trim();
      };
      const check = () => {
        if (done) return;
        if (clicked) {
          if (stopButton() || drafted() === '') finish('ok');
          return;
        }
        const button = sendButton();
        if (!enabled(button)) return;
        clicked = true;
        try { button.click(); } catch (_) { return finish('click_failed'); }
        check();
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      const timer = setTimeout(
        () => finish(clicked ? 'not_accepted' : 'send_disabled' + notice()),
        timeoutMs || 30000,
      );
      check();
    });
  }
  // A Send button that never lights up is usually the site refusing, and the
  // site says why on screen: a spent cap for this model, an upgrade prompt, a
  // refusal. Carrying that sentence back is the difference between an error a
  // person can act on and one that only names a button.
  function notice() {
    try {
      const found = [...document.querySelectorAll(NOTICE)]
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((text) => text.length > 8 && text.length < 300);
      return found.length ? ': ' + found[found.length - 1].slice(0, 200) : '';
    } catch (error) {
      return '';
    }
  }
  function stop() {
    const button = stopButton();
    if (!button) return false;
    try { button.click(); } catch (_) { return false; }
    return true;
  }

  // ---- rendered answer (fallback reader) -----------------------------------
  function toMarkdown(root) {
    const out = [];
    const children = (node) => { for (const child of node.childNodes) walk(child); };
    const walk = (node) => {
      if (node.nodeType === 3) { out.push(node.nodeValue); return; }
      if (node.nodeType !== 1) return;
      if (node.matches('button, .sr-only, [aria-hidden="true"]')) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'pre') {
        const code = node.querySelector('code');
        const lang = (((code && code.className) || '').match(/language-([\w+-]+)/) || [])[1] || '';
        const body = (code ? code.textContent : node.textContent) || '';
        out.push('\n```' + lang + '\n' + body.replace(/\n$/, '') + '\n```\n');
        return;
      }
      if (tag === 'code') { out.push('`' + node.textContent + '`'); return; }
      if (tag === 'br') { out.push('\n'); return; }
      if (/^h[1-6]$/.test(tag)) { out.push('\n' + '#'.repeat(Number(tag[1])) + ' '); children(node); out.push('\n\n'); return; }
      if (tag === 'p') { children(node); out.push('\n\n'); return; }
      if (tag === 'strong' || tag === 'b') { out.push('**'); children(node); out.push('**'); return; }
      if (tag === 'em' || tag === 'i') { out.push('*'); children(node); out.push('*'); return; }
      if (tag === 'a') { out.push('['); children(node); out.push('](' + (node.getAttribute('href') || '') + ')'); return; }
      if (tag === 'hr') { out.push('\n---\n'); return; }
      if (tag === 'blockquote') { const inner = toMarkdown(node); out.push(inner.split('\n').map(l => '> ' + l).join('\n') + '\n\n'); return; }
      if (tag === 'ul' || tag === 'ol') {
        let index = 0;
        for (const item of node.children) {
          if (item.tagName !== 'LI') continue;
          index += 1;
          out.push(tag === 'ol' ? index + '. ' : '- ');
          out.push(toMarkdown(item).replace(/\n{2,}/g, '\n').replace(/\n/g, '\n  '));
          out.push('\n');
        }
        out.push('\n');
        return;
      }
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')];
        rows.forEach((row, rowIndex) => {
          const cells = [...row.children].map(cell => cell.textContent.trim().replace(/\|/g, '\\|'));
          out.push('| ' + cells.join(' | ') + ' |\n');
          if (rowIndex === 0) out.push('|' + cells.map(() => ' --- ').join('|') + '|\n');
        });
        out.push('\n');
        return;
      }
      children(node);
    };
    walk(root);
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Two renderers are known. The signed-in app marks messages with
  // data-message-author-role and renders prose under .markdown (chatgpt-dom.js's
  // anchors). The logged-out app - what the sign-in tab shows first - uses
  // data-message-role, [data-assistant-markdown], and data-message-complete
  // once an answer has finished.
  const ASSISTANT = '[data-message-author-role="assistant"], [data-message-role="assistant"]';
  function snapshot() {
    const turns = [...document.querySelectorAll(TURN)];
    let node = null;
    for (let at = turns.length - 1; at >= 0 && !node; at--) {
      const assistant = turns[at].querySelector(ASSISTANT);
      if (assistant) node = assistant;
    }
    if (!node) {
      const holders = document.querySelectorAll(ASSISTANT);
      node = holders.length ? holders[holders.length - 1] : null;
    }
    const markdown = node ? (node.querySelector('.markdown') || node.querySelector('[data-assistant-markdown]') || node) : null;
    const streamingAttrs = !!node && node.hasAttribute('data-assistant-content-started') && !node.hasAttribute('data-message-complete');
    return {
      generating: !!stopButton() || streamingAttrs,
      hasAssistant: !!node,
      text: markdown ? toMarkdown(markdown) : '',
      href: location.href,
    };
  }

  // ---- event-stream reducer (the site's delta protocol) --------------------
  function createReducer() {
    const messages = new Map();
    const order = [];
    let current = null, lastPath = null, conversationId = null, done = false, handedOff = false;
    const adopt = (message) => {
      if (!message || typeof message !== 'object' || typeof message.id !== 'string') return;
      if (!messages.has(message.id)) order.push(message.id);
      messages.set(message.id, message);
      current = message;
      lastPath = null;
    };
    const apply = (op) => {
      if (!current) return;
      const path = typeof op.p === 'string' ? op.p : lastPath;
      if (typeof op.p === 'string') lastPath = op.p;
      if (!path) return;
      const kind = op.o || 'append';
      const segments = path.split('/').slice(1);
      if (segments[0] !== 'message') return;
      let target = current;
      for (let at = 1; at < segments.length - 1; at++) {
        if (target === null || typeof target !== 'object') return;
        target = target[segments[at]];
      }
      if (target === null || typeof target !== 'object') return;
      const key = segments[segments.length - 1];
      const value = op.v;
      const existing = target[key];
      if (kind === 'append') {
        if (typeof existing === 'string' && typeof value === 'string') target[key] = existing + value;
        else if (Array.isArray(existing) && Array.isArray(value)) existing.push(...value);
        else if (Array.isArray(existing)) existing.push(value);
        else if (existing && typeof existing === 'object' && value && typeof value === 'object') Object.assign(existing, value);
        else if (existing === undefined) target[key] = value;
      } else if (kind === 'replace' || kind === 'add') target[key] = value;
      else if (kind === 'remove') delete target[key];
    };
    const event = (data) => {
      if (data === '[DONE]') { done = true; return; }
      let evt;
      try { evt = JSON.parse(data); } catch (_) { return; }
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'message_stream_complete') { done = true; return; }
      // The answer itself follows on the site's WebSocket (see observeSocket).
      if (evt.type === 'stream_handoff') {
        handedOff = true;
        // The conversation the socket stream will belong to.
        if (typeof evt.conversation_id === 'string') conversationId = evt.conversation_id;
        return;
      }
      if (typeof evt.conversation_id === 'string') conversationId = evt.conversation_id;
      if (evt.message && typeof evt.message === 'object') { adopt(evt.message); return; }
      // A batch of operations. The delta encoding may leave `o` out when the
      // previous event was also a patch - seen 2026-09-14 on the WebSocket as
      // `{"v":[{"p":"/message/content/parts/0","o":"append",...}, ...]}` right
      // after a citation, carrying the text that closes the citation marker.
      const isOperationList = Array.isArray(evt.v) && evt.v.length > 0 &&
        evt.v.every(op => op && typeof op === 'object' && typeof op.p === 'string');
      if (Array.isArray(evt.v) && (evt.o === 'patch' || (evt.o === undefined && evt.p === undefined && isOperationList))) {
        for (const op of evt.v) if (op && typeof op === 'object') apply(op);
        return;
      }
      if ((evt.o === undefined || evt.o === 'add') && evt.p === undefined && evt.v && typeof evt.v === 'object' && !Array.isArray(evt.v)) {
        if (evt.v.message) { adopt(evt.v.message); if (typeof evt.v.conversation_id === 'string') conversationId = evt.v.conversation_id; }
        return;
      }
      if ('v' in evt) apply(evt);
    };
    const text = () => {
      const parts = [];
      for (const id of order) {
        const message = messages.get(id);
        if (!message || !message.author || message.author.role !== 'assistant') continue;
        const content = message.content;
        if (!content || content.content_type !== 'text' || !Array.isArray(content.parts)) continue;
        const joined = content.parts.filter(part => typeof part === 'string').join('');
        if (joined) parts.push(joined);
      }
      return parts.join('\n\n');
    };
    const reasoning = () => {
      const parts = [];
      for (const id of order) {
        const message = messages.get(id);
        const content = message && message.content;
        if (!content || content.content_type !== 'thoughts' || !Array.isArray(content.thoughts)) continue;
        for (const thought of content.thoughts) {
          if (thought && typeof thought.content === 'string') parts.push(thought.content);
        }
      }
      return parts.join('\n\n');
    };
    // The answer's own message id: what the site's Read aloud is asked to read.
    const assistantId = () => {
      for (let at = order.length - 1; at >= 0; at--) {
        const message = messages.get(order[at]);
        const content = message && message.content;
        if (message && message.author && message.author.role === 'assistant' && content && content.content_type === 'text') return order[at];
      }
      return null;
    };
    const userIds = () => order.filter(id => {
      const message = messages.get(id);
      return !!(message && message.author && message.author.role === 'user');
    });
    return { event, text, reasoning, isDone: () => done, handedOff: () => handedOff, conversationId: () => conversationId, assistantId, userIds };
  }

  // ---- fetch observer (usage.js port) --------------------------------------
  async function observeConversation(response, turn, requestModel) {
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      let body = '';
      try { body = (await response.clone().text()).slice(0, 4000); } catch (_) {}
      // The site may have read the body already; the network log on the
      // other side of the protocol is the fallback for what it said.
      emit({ type: 'error', turn, status: response.status, body });
      return;
    }
    if (!contentType.includes('text/event-stream')) {
      // A WebSocket-delivered answer, or a shape this reader does not know.
      // Say so, and let the DOM reader carry the turn.
      emit({ type: 'stream', turn, mode: 'dom', model: requestModel });
      return;
    }
    emit({ type: 'stream', turn, mode: 'sse', model: requestModel });
    const reducer = createReducer();
    const reader = response.clone().body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', sent = '', lastEmit = 0, timer = null;
    const flush = (force) => {
      const text = reducer.text();
      if (text === sent && !force) return;
      const now = Date.now();
      if (!force && now - lastEmit < 60) {
        if (!timer) timer = setTimeout(() => { timer = null; flush(false); }, 60);
        return;
      }
      lastEmit = now;
      if (text.startsWith(sent)) emit({ type: 'text', turn, append: text.slice(sent.length) });
      else emit({ type: 'text', turn, replace: text });
      sent = text;
    };
    const frame = (chunk) => {
      const data = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) {
        reducer.event(data);
        noteConversation(turn, reducer.conversationId());
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const lf = buffer.indexOf('\n\n'), crlf = buffer.indexOf('\r\n\r\n');
          const split = lf < 0 ? crlf : crlf < 0 ? lf : Math.min(lf, crlf);
          if (split < 0) break;
          const width = buffer.startsWith('\r\n\r\n', split) ? 4 : 2;
          frame(buffer.slice(0, split));
          buffer = buffer.slice(split + width);
        }
        flush(false);
        if (reducer.isDone()) break;
      }
      buffer += decoder.decode();
      if (buffer.trim()) frame(buffer);
    } catch (error) {
      emit({ type: 'stream_error', turn, message: String(error && error.message || error) });
    } finally {
      if (timer) clearTimeout(timer);
      flush(true);
      try { reader.cancel(); } catch (_) {}
      if (reducer.handedOff() && !reducer.text()) emit({ type: 'handoff', turn });
      else emit({ type: 'done', turn, text: reducer.text(), reasoning: reducer.reasoning(), conversationId: reducer.conversationId(), messageId: reducer.assistantId(), model: requestModel });
    }
  }

  // ---- WebSocket observer --------------------------------------------------
  // Seen 2026-09-14: the conversation POST now answers with only a
  // `stream_handoff`, and the answer streams over the site's user WebSocket
  // as `conversation-turn-<id>` topic messages whose `encoded_item`s are the
  // same delta events the POST used to carry. Reading them here keeps the
  // answer's raw text. The rendered page is not a substitute: its markdown
  // eats backslash escapes, so a JSON answer's `\"` came back as a bare `"`
  // and a Learn stage could not parse it.
  //
  // The one user socket carries every conversation's stream, so a topic is
  // adopted only once it proves it belongs to the message this turn sent: one
  // of the POST body's message ids, or the conversation the POST handed off
  // to. Until then its frames are kept, not shown. Seen 2026-09-15: without
  // this, a leftover read-aloud chat's stream arrived during a GPT-6 Pro turn
  // and was returned as that turn's answer.
  const socketTopics = new Map();
  let socketStreamTurn = null;
  function belongsToTurn(entry) {
    const expect = state.expect;
    if (!expect || expect.turn !== entry.turn) return null;
    const conversation = entry.reducer.conversationId();
    if (conversation && expect.conversationId) return conversation === expect.conversationId;
    const users = entry.reducer.userIds();
    if (users.length && expect.userIds.length) return users.some(id => expect.userIds.includes(id));
    return null;
  }
  function settleTopic(entry) {
    if (entry.bound === null) {
      const verdict = belongsToTurn(entry);
      if (verdict === null) return;
      entry.bound = verdict;
      if (!verdict) return;
      if (socketStreamTurn !== entry.turn) {
        socketStreamTurn = entry.turn;
        emit({ type: 'stream', turn: entry.turn, mode: 'ws' });
      }
    }
    if (!entry.bound || entry.finished) return;
    const text = entry.reducer.text();
    if (text !== entry.sent) {
      if (text.startsWith(entry.sent)) emit({ type: 'text', turn: entry.turn, append: text.slice(entry.sent.length) });
      else emit({ type: 'text', turn: entry.turn, replace: text });
      entry.sent = text;
    }
    if (entry.ended || entry.reducer.isDone()) {
      entry.finished = true;
      emit({ type: 'done', turn: entry.turn, text: entry.reducer.text(), reasoning: entry.reducer.reasoning(), conversationId: entry.reducer.conversationId(), messageId: entry.reducer.assistantId() });
    }
  }
  function settleTopics() {
    for (const entry of socketTopics.values()) settleTopic(entry);
  }
  function noteConversation(turn, conversationId) {
    const expect = state.expect;
    if (!expect || expect.turn !== turn || typeof conversationId !== 'string' || expect.conversationId) return;
    expect.conversationId = conversationId;
    settleTopics();
  }
  function expectFromRequest(turn, args) {
    try {
      if (!state.expect || state.expect.turn !== turn) state.expect = { turn, userIds: [], conversationId: null };
      const init = args[1];
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (body && Array.isArray(body.messages)) {
        for (const message of body.messages) {
          if (message && typeof message.id === 'string' && !state.expect.userIds.includes(message.id)) state.expect.userIds.push(message.id);
        }
      }
      if (body && typeof body.conversation_id === 'string') noteConversation(turn, body.conversation_id);
      settleTopics();
    } catch (_) {}
  }
  function observeSocketMessage(data) {
    if (typeof data !== 'string' || !state.turn || data.indexOf('conversation-turn') < 0) return;
    let frames;
    try { frames = JSON.parse(data); } catch (_) { return; }
    for (const frame of Array.isArray(frames) ? frames : [frames]) {
      const inner = frame && frame.payload && frame.payload.payload;
      if (!inner || typeof frame.topic_id !== 'string' || !frame.topic_id.startsWith('conversation-turn-')) continue;
      let entry = socketTopics.get(frame.topic_id);
      if (!entry || entry.turn !== state.turn) {
        entry = { turn: state.turn, reducer: createReducer(), sent: '', bound: null, ended: false, finished: false };
        socketTopics.set(frame.topic_id, entry);
      }
      if (entry.bound === false || entry.finished) continue;
      if (inner.type === 'stream-item' && typeof inner.encoded_item === 'string') {
        for (const chunk of inner.encoded_item.split(/\r?\n\r?\n/)) {
          const payload = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (payload) entry.reducer.event(payload);
        }
      }
      if (inner.type === 'done') entry.ended = true;
      settleTopic(entry);
    }
  }
  const installSocket = () => {
    const Native = window.WebSocket;
    if (typeof Native !== 'function' || Native.__breadboardObserved) return;
    class ObservedWebSocket extends Native {
      constructor(...args) {
        super(...args);
        try { this.addEventListener('message', (event) => { try { observeSocketMessage(event.data); } catch (_) {} }); } catch (_) {}
      }
    }
    ObservedWebSocket.__breadboardObserved = true;
    window.WebSocket = ObservedWebSocket;
  };
  installSocket();
  function requestModel(args) {
    try {
      const init = args[1];
      const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      return body && typeof body.model === 'string' ? body.model : null;
    } catch (_) { return null; }
  }
  let observed = null;
  const install = () => {
    if (window.fetch === observed || typeof window.fetch !== 'function') return;
    const downstream = window.fetch;
    observed = function (...args) {
      const result = downstream.apply(this, args);
      let url = null, method = 'GET';
      try {
        url = new URL(typeof args[0] === 'string' ? args[0] : args[0] && args[0].url, location.href);
        const explicit = args[1] && typeof args[1].method === 'string' ? args[1].method : null;
        const inherited = args[0] && typeof args[0] === 'object' && typeof args[0].method === 'string' ? args[0].method : null;
        method = String(explicit || inherited || 'GET').toUpperCase();
      } catch (_) { return result; }
      if (url.origin !== location.origin) return result;
      if (state.seen.length < 200) state.seen.push(method + ' ' + url.pathname);
      if (method === 'POST' && CONVERSATION_ROUTE.test(url.pathname) && state.turn) {
        const turn = state.turn, model = requestModel(args);
        expectFromRequest(turn, args);
        result.then(response => { void observeConversation(response, turn, model); }).catch(() => {});
      } else if (method === 'GET' && MODELS_ROUTE.test(url.pathname)) {
        result.then(async response => {
          if (!response.ok) return;
          try {
            const body = await response.clone().json();
            if (body && Array.isArray(body.models)) state.latestModels = body.models;
          } catch (_) {}
        }).catch(() => {});
      }
      return result;
    };
    window.fetch = observed;
  };
  install();
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true });

  // ---- account ------------------------------------------------------------
  async function session() {
    const response = await fetch('/api/auth/session', { credentials: 'include', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { signedIn: false, status: response.status };
    let body = null;
    try { body = await response.json(); } catch (_) { return { signedIn: false }; }
    const user = body && body.user;
    if (!user || typeof body.accessToken !== 'string') return { signedIn: false };
    let plan = null;
    try {
      const check = await fetch('/backend-api/accounts/check/v4-2023-04-27', {
        credentials: 'include', headers: { accept: 'application/json', authorization: 'Bearer ' + body.accessToken }, signal: AbortSignal.timeout(15000),
      });
      if (check.ok) {
        const accounts = await check.json();
        const entry = accounts && accounts.accounts && (accounts.accounts.default || Object.values(accounts.accounts)[0]);
        const found = entry && entry.account && entry.account.plan_type;
        if (typeof found === 'string') plan = found;
      }
    } catch (_) {}
    return { signedIn: true, email: typeof user.email === 'string' ? user.email : null, name: typeof user.name === 'string' ? user.name : null, plan };
  }
  async function models() {
    const response = await fetch('/api/auth/session', { credentials: 'include', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const body = response.ok ? await response.json().catch(() => null) : null;
    const token = body && typeof body.accessToken === 'string' ? body.accessToken : null;
    let rows = null;
    try {
      // The session cookie is enough for this listing; the bearer is added when
      // the site handed one out, matching what the page itself sends.
      const headers = { accept: 'application/json' };
      if (token) headers.authorization = 'Bearer ' + token;
      const listed = await fetch('/backend-api/models?history_and_training_disabled=false', {
        credentials: 'include', headers, signal: AbortSignal.timeout(15000),
      });
      if (listed.ok) { const payload = await listed.json(); if (payload && Array.isArray(payload.models)) rows = payload.models; }
    } catch (_) {}
    if (!rows) rows = state.latestModels;
    if (!Array.isArray(rows)) return null;
    return rows.filter(row => row && typeof row.slug === 'string').map(row => ({
      slug: row.slug,
      title: typeof row.title === 'string' ? row.title : row.slug,
      description: typeof row.description === 'string' ? row.description.slice(0, 200) : '',
      tags: Array.isArray(row.tags) ? row.tags.filter(tag => typeof tag === 'string').slice(0, 12) : [],
    }));
  }

  window.__breadboardChatgptWeb = {
    ready, insert, attach, attachments, send, stop, snapshot, session, models,
    setTurn: (turn) => {
      state.turn = typeof turn === 'string' ? turn : null;
      state.expect = state.turn ? { turn: state.turn, userIds: [], conversationId: null } : null;
      socketTopics.clear();
      socketStreamTurn = null;
    },
    // Exposed for ChatMock's tests, which run this file under Node with a stub DOM.
    debug: {
      createReducer, toMarkdown, seen: () => state.seen.slice(), turn: () => state.turn,
      // What a conversation POST would record: its message ids, and the
      // conversation id its hand-off names.
      expect: (userIds, conversationId) => {
        if (!state.turn) return;
        expectFromRequest(state.turn, [null, { body: JSON.stringify({ messages: (userIds || []).map(id => ({ id })) }) }]);
        if (conversationId) noteConversation(state.turn, conversationId);
      },
    },
  };
})();
"""


# --------------------------------------------------------------------------
# A driven page
# --------------------------------------------------------------------------


class _Page:
    def __init__(self, ws_url: str, surface: str) -> None:
        self.surface = surface
        # Which lane this page serves; set by `_ensure_page` once attached.
        self.lane: str = INTERACTIVE_LANE
        self.events: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._loaded = threading.Event()
        # Request ids of the site's own refusals of a message, newest last.
        # The site reads a refusal's body before the page script can (seen
        # 2026-09-14: the script reported `status: 400, body: ""` for a
        # response whose body said what was wrong), and shows only "Something
        # went wrong" on screen. The network layer still has the sentence.
        self.failed_responses: List[tuple[str, int]] = []
        self.cdp = _Cdp(ws_url, self._on_event)

    def _on_event(self, method: str, params: Dict[str, Any]) -> None:
        if method == "Runtime.bindingCalled" and params.get("name") == BINDING:
            try:
                payload = json.loads(params.get("payload") or "")
            except ValueError:
                return
            if isinstance(payload, dict):
                self.events.put(payload)
        elif method == "Page.loadEventFired":
            self._loaded.set()
        elif method == "Network.responseReceived":
            response = params.get("response") or {}
            status = int(response.get("status") or 0)
            url = str(response.get("url") or "")
            if status >= 400 and "/backend-api/" in url and url.rstrip("/").endswith("conversation"):
                self.failed_responses.append((str(params.get("requestId")), status))
                del self.failed_responses[:-5]

    def install(self) -> None:
        # Bounded: see ATTACH_TIMEOUT_SECONDS. A page that cannot answer these
        # four in a quarter of a minute is not going to answer them at all.
        self.cdp.call("Page.enable", timeout=ATTACH_TIMEOUT_SECONDS)
        self.cdp.call("Runtime.enable", timeout=ATTACH_TIMEOUT_SECONDS)
        self.cdp.call("Runtime.addBinding", {"name": BINDING}, timeout=ATTACH_TIMEOUT_SECONDS)
        self.cdp.call(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": PAGE_SCRIPT},
            timeout=ATTACH_TIMEOUT_SECONDS,
        )
        # Only for `failed_responses`; the answer itself still comes through
        # the page script, not the network log.
        self.cdp.call("Network.enable", timeout=ATTACH_TIMEOUT_SECONDS)

    def refusal_body(self, status: int, *, timeout: float = 3.0) -> str:
        """The body of the site's latest refusal with this status, from the
        network log; empty when there is none or it is not readable yet."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            matches = [rid for rid, code in self.failed_responses if code == status]
            if matches:
                try:
                    result = self.cdp.call("Network.getResponseBody", {"requestId": matches[-1]}, timeout=5)
                except ProviderError:
                    result = {}
                body = result.get("body")
                if isinstance(body, str) and body:
                    if result.get("base64Encoded"):
                        import base64

                        try:
                            body = base64.b64decode(body).decode("utf-8", errors="replace")
                        except Exception:  # noqa: BLE001
                            body = ""
                    return body[:4000]
            time.sleep(0.2)
        return ""

    def alive(self) -> bool:
        if self.cdp.closed.is_set():
            return False
        try:
            # Re-asked once: a page that is merely slow to answer is a page to
            # keep, and calling it dead here costs the person a whole new tab.
            return self.evaluate("1", timeout=10, attempts=2) == 1
        except ProviderError:
            return False

    def evaluate(
        self,
        expression: str,
        *,
        await_promise: bool = False,
        timeout: float = EVAL_TIMEOUT_SECONDS,
        attempts: int = 1,
    ) -> Any:
        """Run ``expression`` in the page and return its value.

        ``attempts`` above one re-issues an evaluation the page did not answer
        in time. Only callers whose expression is safe to run twice may ask
        for that - reads and idempotent writes, never ``send()``.
        """
        result = self._evaluate(expression, await_promise, timeout, attempts)
        details = result.get("exceptionDetails")
        if details:
            text = details.get("text") or "evaluation failed"
            exception = details.get("exception") or {}
            described = exception.get("description") or exception.get("value")
            raise ProviderError(f"page script error: {described or text}", phase="protocol")
        inner = result.get("result") or {}
        return inner.get("value")

    def _evaluate(
        self, expression: str, await_promise: bool, timeout: float, attempts: int
    ) -> Dict[str, Any]:
        unresponsive: _PageUnresponsive | None = None
        for attempt in range(max(1, int(attempts))):
            if attempt and self.cdp.closed.is_set():
                break
            try:
                return self.cdp.call(
                    "Runtime.evaluate",
                    {"expression": expression, "awaitPromise": await_promise, "returnByValue": True},
                    timeout=timeout,
                )
            except _PageUnresponsive as exc:
                unresponsive = exc
        raise unresponsive if unresponsive is not None else _PageUnresponsive(
            "the browser did not answer Runtime.evaluate in time", phase="receive"
        )

    def ensure_script(self) -> None:
        if not self.evaluate("!!window.__breadboardChatgptWeb", attempts=EVAL_ATTEMPTS):
            self.evaluate(PAGE_SCRIPT, attempts=EVAL_ATTEMPTS)

    def navigate(self, url: str, *, timeout: float = PAGE_READY_TIMEOUT_SECONDS) -> None:
        self._loaded.clear()
        self.cdp.call("Page.navigate", {"url": url})
        self._loaded.wait(timeout)
        self.ensure_script()

    def current_url(self) -> str:
        try:
            return str(self.evaluate("location.href", attempts=EVAL_ATTEMPTS) or "")
        except ProviderError:
            return ""

    def wait_ready(self, timeout: float = PAGE_READY_TIMEOUT_SECONDS) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.evaluate("window.__breadboardChatgptWeb && window.__breadboardChatgptWeb.ready()", timeout=10):
                    return True
            except ProviderError:
                pass
            time.sleep(0.25)
        return False

    def bring_to_front(self) -> None:
        try:
            self.cdp.call("Page.bringToFront", timeout=5)
        except ProviderError:
            pass

    def set_window_state(self, state: str) -> None:
        """Best effort: only the system browser honours this."""
        try:
            window = self.cdp.call("Browser.getWindowForTarget", timeout=5)
            window_id = window.get("windowId")
            if window_id is not None:
                self.cdp.call(
                    "Browser.setWindowBounds",
                    {"windowId": window_id, "bounds": {"windowState": state}},
                    timeout=5,
                )
        except ProviderError:
            pass

    def drain(self) -> None:
        while True:
            try:
                self.events.get_nowait()
            except queue.Empty:
                return

    def close(self) -> None:
        self.cdp.close()


# --------------------------------------------------------------------------
# System browser fallback
# --------------------------------------------------------------------------


def browser_executable() -> str | None:
    """Chrome, else Edge - the same search the agent browser makes."""
    for env_name in ("CHATMOCK_CHATGPT_WEB_BROWSER", "AGENT_BROWSER_EXECUTABLE_PATH"):
        explicit = (os.getenv(env_name) or "").strip()
        if explicit and os.path.exists(explicit):
            return explicit
    if sys.platform.startswith("win"):
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.join(os.getenv("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ]
    elif sys.platform == "darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
    else:
        candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
        ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


class _SystemBrowser:
    """A Chrome/Edge ChatMock launched itself, on its own profile."""

    def __init__(self) -> None:
        self.port: int | None = None
        self.process: subprocess.Popen[bytes] | None = None

    def _port_file(self) -> str:
        return os.path.join(profile_dir(), "DevToolsActivePort")

    def _read_port(self) -> int | None:
        try:
            with open(self._port_file(), "r", encoding="utf-8") as handle:
                first = handle.readline().strip()
            port = int(first)
            return port if 0 < port < 65536 else None
        except (OSError, ValueError):
            return None

    @staticmethod
    def _answers(port: int) -> bool:
        try:
            version = _http_json(f"http://127.0.0.1:{port}/json/version", timeout=2)
            return isinstance(version, dict)
        except Exception:  # noqa: BLE001
            return False

    def ensure(self) -> int:
        if self.port and self._answers(self.port):
            return self.port
        # A browser from an earlier ChatMock process may still hold the profile.
        existing = self._read_port()
        if existing and self._answers(existing):
            self.port = existing
            return existing
        executable = browser_executable()
        if not executable:
            raise ProviderError(
                "No Chrome or Edge was found to sign in to chatgpt.com with. Install one, "
                "or set CHATMOCK_CHATGPT_WEB_BROWSER to a browser executable.",
                status_code=503,
                phase="prepare",
                replay_safe=True,
            )
        directory = profile_dir()
        os.makedirs(directory, exist_ok=True)
        try:
            os.remove(self._port_file())
        except OSError:
            pass
        args = [
            executable,
            f"--user-data-dir={directory}",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "--disable-features=Translate",
            "--window-size=1100,860",
            "about:blank",
        ]
        creation = 0
        if sys.platform.startswith("win"):
            creation = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        self.process = subprocess.Popen(  # noqa: S603 - fixed executable, fixed args
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation,
            close_fds=True,
        )
        deadline = time.time() + 25
        while time.time() < deadline:
            port = self._read_port()
            if port and self._answers(port):
                self.port = port
                return port
            if self.process.poll() is not None:
                break
            time.sleep(0.25)
        raise ProviderError(
            "The browser for chatgpt.com did not start.",
            status_code=503,
            phase="prepare",
            replay_safe=True,
        )

    def close(self) -> None:
        # A browser adopted from an earlier ChatMock process is not ours to
        # kill; only one this process launched is terminated.
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
            except OSError:
                pass
        self.process = None
        self.port = None


# --------------------------------------------------------------------------
# Page lifecycle
# --------------------------------------------------------------------------


def system_browser_allowed() -> bool:
    """Whether ChatMock may launch a Chrome/Edge of its own for chatgpt.com.

    Off by default: the provider is meant to live in Breadboard's own browser,
    where the person's chatgpt.com session already is. The system browser is
    an escape hatch for a ChatMock that runs without the desktop shell (a
    plain ``npm run dev`` in an ordinary browser), switched on explicitly.
    """
    value = (os.getenv("CHATMOCK_CHATGPT_WEB_SYSTEM_BROWSER") or "").strip().lower()
    return value in ("1", "true", "yes", "on")


_lifecycle_lock = threading.RLock()
_system: _SystemBrowser | None = None
_session_cache: tuple[float, Dict[str, Any]] | None = None


@dataclass
class _Lane:
    """One chatgpt.com page and the turn lock that serialises it.

    A page is a single composer, so it holds one conversation at a time. Two
    lanes mean two pages: ``interactive`` for a person's chat (and signing in,
    which needs a page in front of them), ``batch`` for Learn, the council and
    Thought Topology. Before lanes, a Learn stage that thought for fifteen
    minutes held the only page, and the person's chat was refused three times
    in a row and gave up (2026-09-18).

    ``holder`` says who has the lock and since when, so a refusal can name
    them instead of "an earlier message".
    """

    name: str
    lock: threading.Lock = field(default_factory=threading.Lock)
    page: _Page | None = None
    holder: Dict[str, Any] | None = None


_lanes: Dict[str, _Lane] = {name: _Lane(name) for name in LANES}
# Whether the shell hands out a page per lane; learned from its first answer
# (see ``_bridge_open_tab``). Unknown until then.
_lanes_supported: bool | None = None


def _lane(name: str = INTERACTIVE_LANE) -> _Lane:
    return _lanes[name]


def _drop_page(lane: str = INTERACTIVE_LANE) -> None:
    with _lifecycle_lock:
        slot = _lane(lane)
        if slot.page is not None:
            slot.page.close()
        slot.page = None


def _page_lane(page: _Page) -> str:
    return getattr(page, "lane", None) or INTERACTIVE_LANE


def _focus(page: _Page) -> None:
    """Put the page in front of the person, whichever surface holds it."""
    if page.surface == "desktop":
        bridge = _live_bridge()
        if bridge is not None:
            try:
                _bridge_open_tab(bridge, foreground=True, lane=_page_lane(page))
            except ProviderError:
                pass
        return
    page.bring_to_front()
    page.set_window_state("normal")


def _unresponsive_error(surface: str) -> ProviderError:
    if surface == "desktop":
        message = (
            "Breadboard's ChatGPT page stopped responding, and the fresh one it was given "
            "did not answer either. Restart Breadboard and try again."
        )
    else:
        message = (
            "The ChatGPT browser window stopped responding. Close it and try again."
        )
    return ProviderError(message, status_code=503, phase="prepare", replay_safe=True)


def _attach(page: _Page, *, foreground: bool) -> None:
    """Install the page script and put the page on chatgpt.com."""
    page.install()
    if not page.current_url().startswith(ORIGIN):
        page.navigate(f"{ORIGIN}/")
    else:
        page.ensure_script()
    if foreground and page.surface == "browser":
        page.bring_to_front()
        page.set_window_state("normal")


def _ensure_page(*, foreground: bool = False, lane: str = INTERACTIVE_LANE) -> _Page:
    """The driven ChatGPT page for ``lane``, opening a surface for it when none is live.

    A lane the surface cannot give its own page to - the system browser has
    one window, an older shell one page - is served the interactive page,
    and ``_lanes_supported`` records that so callers stop asking (and, more
    to the point, stop taking a lock of their own for a page they share).
    """
    global _system, _lanes_supported
    with _lifecycle_lock:
        slot = _lane(lane)
        # A page that was ours and has stopped being usable is not one to
        # reattach to, whichever way it went: a wedged renderer answers the
        # same nothing through a second socket, and a socket that closed under
        # us means the target went away (a crashed renderer - observed
        # 2026-09-14). Either way the shell is asked for a fresh page straight
        # away, which is two minutes of doomed attaching saved. Having no page
        # at all is different: ChatMock has just started, and the page the
        # shell is holding is exactly the one to attach to.
        wedged = False
        if slot.page is not None:
            if slot.page.alive():
                if foreground:
                    _focus(slot.page)
                return slot.page
            wedged = True
            _drop_page(lane)

        bridge = _live_bridge()
        if bridge is None and not system_browser_allowed():
            raise ProviderError(
                "OpenAI (web) runs inside Breadboard's own browser, and no Breadboard window is "
                "relaying for it right now. Open the Breadboard app (keep a Breadboard page open) "
                "and try again.",
                status_code=503,
                phase="prepare",
                replay_safe=True,
            )
        if bridge is None and lane != INTERACTIVE_LANE:
            _lanes_supported = False
            return _ensure_page(foreground=foreground, lane=INTERACTIVE_LANE)

        # The shell can hand out a replacement page; the system browser cannot,
        # so there the one attempt is all there is.
        resets = ((True,) if wedged else (False, True)) if bridge is not None else (False,)
        for reset in resets:
            if bridge is not None:
                cdp_port, target_id = _bridge_open_tab(bridge, foreground=foreground, reset=reset, lane=lane)
                if lane != INTERACTIVE_LANE and not _lanes_supported:
                    # The shell answered with its only page - the interactive
                    # lane's. Attaching to it a second time under another
                    # lock would type two turns into one composer.
                    return _ensure_page(foreground=foreground, lane=INTERACTIVE_LANE)
                ws_url = _page_websocket(cdp_port, target_id=target_id)
                page = _Page(ws_url, surface="desktop")
            else:
                if _system is None:
                    _system = _SystemBrowser()
                port = _system.ensure()
                ws_url = _page_websocket(port)
                page = _Page(ws_url, surface="browser")
            page.lane = lane
            try:
                _attach(page, foreground=foreground)
            except _PageUnresponsive:
                page.close()
                if reset or bridge is None:
                    raise _unresponsive_error(page.surface) from None
                continue
            except ProviderError:
                page.close()
                raise
            slot.page = page
            return page
        raise _unresponsive_error("desktop")


def _probe_session(page: _Page) -> Dict[str, Any]:
    global _session_cache
    result = page.evaluate("window.__breadboardChatgptWeb.session()", await_promise=True, timeout=30)
    if not isinstance(result, dict):
        result = {"signedIn": False}
    _session_cache = (time.time(), result)
    return result


def _session(page: _Page, *, max_age: float = SESSION_CACHE_SECONDS) -> Dict[str, Any]:
    if _session_cache and time.time() - _session_cache[0] < max_age:
        return _session_cache[1]
    return _probe_session(page)


def _record_session(session: Dict[str, Any], surface: str) -> None:
    signed_in = bool(session.get("signedIn"))
    _write_state(
        signedIn=signed_in,
        email=session.get("email") if signed_in else None,
        name=session.get("name") if signed_in else None,
        plan=session.get("plan") if signed_in else None,
        checkedAt=_now_iso(),
        surface=surface,
    )


def _shape_models(rows: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        slug = row.get("slug")
        if not isinstance(slug, str) or not slug.strip() or slug in seen:
            continue
        if slug.startswith(_HIDDEN_SLUG_PREFIXES) or _is_work_model(slug):
            continue
        seen.add(slug)
        out.append(
            {
                "slug": slug,
                "title": row.get("title") if isinstance(row.get("title"), str) else slug,
                "description": row.get("description") if isinstance(row.get("description"), str) else "",
                "tags": [t for t in row.get("tags", []) if isinstance(t, str)] if isinstance(row.get("tags"), list) else [],
            }
        )
    return out


def _refresh_models(page: _Page) -> List[Dict[str, Any]]:
    rows = page.evaluate("window.__breadboardChatgptWeb.models()", await_promise=True, timeout=30)
    models = _shape_models(rows)
    if models:
        _write_state(models=models, modelsAt=_now_iso())
    return models


# --------------------------------------------------------------------------
# Public management API (routes)
# --------------------------------------------------------------------------


_login_lock = threading.Lock()
_login: Dict[str, Any] | None = None


def session_state(*, refresh: bool = False) -> Dict[str, Any]:
    """What the settings screen shows. ``refresh`` asks the live page."""
    error: str | None = None
    if refresh:
        try:
            page = _ensure_page()
            session = _probe_session(page)
            _record_session(session, page.surface)
            if session.get("signedIn"):
                _refresh_models(page)
        except ProviderError as exc:
            error = str(exc)
    state = cached_state()
    with _login_lock:
        login = dict(_login) if _login else None
    current = _lane().page
    live = current is not None and not current.cdp.closed.is_set()
    return {
        "signedIn": bool(state.get("signedIn")),
        "email": state.get("email"),
        "name": state.get("name"),
        "plan": state.get("plan"),
        "checkedAt": state.get("checkedAt"),
        "models": cached_models(),
        "modelsAt": state.get("modelsAt"),
        "surface": state.get("surface"),
        "pageConnected": live,
        "bridge": bridge_state(),
        "browser": {
            "available": _live_bridge() is not None or (system_browser_allowed() and browser_executable() is not None),
            "executable": browser_executable() if system_browser_allowed() and _live_bridge() is None else None,
        },
        "login": login,
        "error": error,
    }


def start_login() -> Dict[str, Any]:
    """Open chatgpt.com in front of the person and watch for the sign-in."""
    global _login
    with _login_lock:
        if _login and _login.get("status") == "awaiting":
            return session_state()
        _login = {"status": "awaiting", "startedAt": _now_iso(), "error": None}

    def finish(status: str, error: str | None = None) -> None:
        global _login
        with _login_lock:
            _login = {"status": status, "startedAt": _login["startedAt"] if _login else _now_iso(), "error": error}

    def run() -> None:
        try:
            page = _ensure_page(foreground=True)
            session = _probe_session(page)
            if not session.get("signedIn"):
                page.navigate(LOGIN_URL)
                page.bring_to_front()
            deadline = time.time() + LOGIN_TIMEOUT_SECONDS
            while time.time() < deadline:
                with _login_lock:
                    if not _login or _login.get("status") != "awaiting":
                        return
                try:
                    session = _probe_session(page)
                except ProviderError:
                    # The page navigates through the identity provider; a
                    # transient evaluation failure is part of signing in.
                    session = {"signedIn": False}
                if session.get("signedIn"):
                    _record_session(session, page.surface)
                    try:
                        _refresh_models(page)
                    except ProviderError:
                        pass
                    page.navigate(f"{ORIGIN}/")
                    finish("done")
                    return
                time.sleep(3)
            finish("failed", "Signing in took too long. Try again.")
        except ProviderError as exc:
            finish("failed", str(exc))
        except Exception as exc:  # noqa: BLE001 - the poll thread must report, not vanish
            finish("failed", f"Sign-in failed: {exc}")

    threading.Thread(target=run, name="chatgpt-web-login", daemon=True).start()
    return session_state()


def cancel_login() -> Dict[str, Any]:
    global _login
    with _login_lock:
        if _login and _login.get("status") == "awaiting":
            _login = {"status": "cancelled", "startedAt": _login["startedAt"], "error": None}
    return session_state()


def logout() -> Dict[str, Any]:
    """Forget the sign-in. The system browser profile is removed outright;
    Breadboard's browser keeps the person's own session, so there the page is
    signed out through the site."""
    global _system, _session_cache
    with _lifecycle_lock:
        current = _lane().page
        page = current if current is not None and current.alive() else None
        if page is not None and page.surface == "desktop":
            try:
                page.navigate(f"{ORIGIN}/auth/logout", timeout=20)
            except ProviderError:
                pass
        # The session is a cookie shared by every lane's page: one logout
        # signs them all out, and none is worth keeping attached.
        for name in LANES:
            _drop_page(name)
        if _system is not None:
            _system.close()
            _system = None
        _session_cache = None
    directory = profile_dir()
    for _ in range(5):
        try:
            if os.path.isdir(directory):
                shutil.rmtree(directory)
            break
        except OSError:
            time.sleep(0.5)
    _write_state(signedIn=False, email=None, name=None, plan=None, checkedAt=_now_iso(), models=[], modelsAt=None)
    cancel_login()
    return session_state()


def sync_models() -> Dict[str, Any]:
    return session_state(refresh=True)


# --------------------------------------------------------------------------
# Prompt composition
# --------------------------------------------------------------------------


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                kind = part.get("type")
                if kind in ("text", "input_text", "output_text") and isinstance(part.get("text"), str):
                    parts.append(part["text"])
                elif kind in ("image_url", "input_image", "image"):
                    # The image itself is pasted into the composer as a file
                    # (see `_image_data_urls`); the text only points at it.
                    parts.append("[see the attached image]")
                elif kind in ("input_file", "file"):
                    parts.append("[file attached - not available through OpenAI (web)]")
        return "\n".join(p for p in parts if p)
    if content is None:
        return ""
    return str(content)


def _image_data_urls(messages: List[Dict[str, Any]]) -> List[str]:
    """Every image part in the transcript, as a data: URL the page can paste.

    A remote URL is fetched here rather than in the page: the page's origin
    could not read it, and a size cap belongs on this side anyway. More than
    ``MAX_IMAGE_ATTACHMENTS`` is refused rather than trimmed - a critic that
    sees only some of its screenshots is worse than one that sees none.
    """
    urls: List[str] = []
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") not in ("image_url", "input_image", "image"):
                continue
            raw = part.get("image_url")
            url = raw.get("url") if isinstance(raw, dict) else raw
            if not isinstance(url, str):
                url = part.get("url") if isinstance(part.get("url"), str) else None
            if not url:
                continue
            urls.append(url)
    if len(urls) > MAX_IMAGE_ATTACHMENTS:
        raise ProviderError(
            f"OpenAI (web) can attach at most {MAX_IMAGE_ATTACHMENTS} images to one message; this request has {len(urls)}.",
            status_code=400,
            phase="prepare",
            replay_safe=True,
        )
    out: List[str] = []
    for url in urls:
        if url.startswith("data:"):
            if len(url) > MAX_IMAGE_BYTES * 4 // 3 + 64:
                raise ProviderError("An attached image is too large for OpenAI (web).", status_code=400, phase="prepare", replay_safe=True)
            out.append(url)
            continue
        if not url.startswith(("http://", "https://")):
            raise ProviderError("An attached image is not a data: or http(s) URL.", status_code=400, phase="prepare", replay_safe=True)
        try:
            req = urllib_request.Request(url, method="GET")
            with urllib_request.urlopen(req, timeout=20) as response:  # noqa: S310 - caller-supplied image URL
                body = response.read(MAX_IMAGE_BYTES + 1)
                content_type = response.headers.get_content_type() or "image/png"
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"An attached image could not be fetched ({exc}).", status_code=400, phase="prepare", replay_safe=True) from exc
        if len(body) > MAX_IMAGE_BYTES:
            raise ProviderError("An attached image is too large for OpenAI (web).", status_code=400, phase="prepare", replay_safe=True)
        import base64

        out.append(f"data:{content_type};base64,{base64.b64encode(body).decode('ascii')}")
    return out


def compose_prompt(messages: List[Dict[str, Any]]) -> str:
    """One message for the site's composer from an OpenAI-shaped transcript.

    A lone user message goes through verbatim. Anything richer - a system
    prompt, earlier turns, tool results - is framed the way chat-on-steroids
    frames context for ChatGPT: instructions first, the conversation so far,
    then the request to answer as the assistant. Function calling is not a
    thing the website does, so tool declarations are not forwarded; the model
    answers in prose.
    """
    system: List[str] = []
    turns: List[tuple[str, str]] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "user").lower()
        text = _content_text(message.get("content"))
        if role in ("system", "developer"):
            if text.strip():
                system.append(text.strip())
            continue
        if role == "assistant":
            calls = message.get("tool_calls")
            if isinstance(calls, list) and calls:
                described = []
                for call in calls:
                    function = call.get("function") if isinstance(call, dict) else None
                    if isinstance(function, dict):
                        described.append(
                            f"[called tool {function.get('name')} with {function.get('arguments') or '{}'}]"
                        )
                text = "\n".join([text] + described).strip() if text else "\n".join(described)
            turns.append(("Assistant", text))
            continue
        if role == "tool":
            name = message.get("name") or message.get("tool_call_id") or "tool"
            turns.append((f"Tool result ({name})", text))
            continue
        turns.append(("User", text))

    if not system and len(turns) == 1 and turns[0][0] == "User":
        return turns[0][1]

    blocks: List[str] = []
    if system:
        blocks.append("<instructions>\n" + "\n\n".join(system) + "\n</instructions>")
    if turns:
        lines = [f"{speaker}: {text}".rstrip() for speaker, text in turns]
        blocks.append("<conversation>\n" + "\n\n".join(lines) + "\n</conversation>")
    blocks.append(
        "Continue this conversation as the assistant, following the instructions above. "
        "Reply with only your next message - no speaker label, no commentary about this framing."
    )
    return "\n\n".join(blocks)


def _estimate_tokens(text: str) -> int:
    return max(0, (len(text) + 3) // 4)


# --------------------------------------------------------------------------
# One turn
# --------------------------------------------------------------------------


@dataclass
class TurnResult:
    text: str = ""
    reasoning: str = ""
    model: str | None = None
    conversation_id: str | None = None
    # The answer's message id, when the event stream named it.
    message_id: str | None = None
    mode: str = "sse"


class _TurnFailed(ProviderError):
    """A refusal from the site itself, carrying its HTTP status."""


def _chat_url(model: str, effort: str | None, *, temporary: bool = True) -> str:
    # Chat turns are always temporary. Only read-aloud may ask for an ordinary
    # chat, when the site cannot read a temporary chat's message back.
    url = f"{ORIGIN}/?temporary-chat=true&model={quote(model, safe='')}" if temporary else f"{ORIGIN}/?model={quote(model, safe='')}"
    if effort in WEB_REASONING_EFFORTS:
        url += f"&reasoning_effort={effort}"
    return url


def _site_error(status: int, body: str) -> _TurnFailed:
    message = ""
    try:
        parsed = json.loads(body) if body else None
        detail = parsed.get("detail") if isinstance(parsed, dict) else None
        if isinstance(detail, dict):
            message = str(detail.get("message") or detail.get("code") or "")
        elif isinstance(detail, str):
            message = detail
        elif isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
            message = str(parsed["error"].get("message") or "")
    except ValueError:
        pass
    if status == 429:
        text = "ChatGPT says this model's usage limit is reached for now."
    elif status in (401, 403):
        text = "ChatGPT refused the request; sign in to chatgpt.com again in Settings."
    else:
        text = f"ChatGPT returned HTTP {status}."
    if message and len(message) <= 300:
        text = f"{text} {message}".strip()
    return _TurnFailed(text, status_code=status, phase="upstream", replay_safe=status in (401, 403, 429))


def _begin_turn(
    model: str,
    prompt: str,
    effort: str | None,
    images: List[str] | None = None,
    *,
    temporary: bool = True,
    lane: str = INTERACTIVE_LANE,
) -> tuple[_Page, str]:
    """Open a fresh temporary chat for ``model`` and submit ``prompt``.

    Runs under the lane's turn lock: a page answers one message at a time.
    Everything here happens before the site accepts the message, so a
    failure is safe to report as a plain refusal.
    """
    page = _ensure_page(lane=lane)
    try:
        return page, _submit_turn(page, model, prompt, effort, images or [], temporary=temporary)
    except _PageUnresponsive:
        # The page stopped answering commands after it was attached to. There
        # is nothing to read back from it, and reusing it would wedge the next
        # request too, so it is dropped here and the person is told what to do
        # rather than shown a DevTools method name.
        _drop_page(_page_lane(page))
        raise _unresponsive_error(page.surface) from None


def _attach_images(page: _Page, images: List[str]) -> None:
    """Paste each image into the composer and wait for the site to hold it.

    Every image must land: a message that silently lost one is exactly the
    blind visual critic this exists to prevent, so a shortfall is an error
    the caller can see, never a message sent regardless.
    """
    if not images:
        return
    outcome = page.evaluate(
        f"window.__breadboardChatgptWeb.attach({json.dumps(images)})",
        timeout=max(60.0, EVAL_TIMEOUT_SECONDS),
    )
    if outcome != "ok":
        raise ProviderError(
            f"The image could not be placed in ChatGPT's composer ({outcome}).",
            status_code=502,
            phase="prepare",
            replay_safe=True,
        )
    deadline = time.time() + IMAGE_ATTACH_TIMEOUT_SECONDS
    held = 0
    while time.time() < deadline:
        try:
            held = int(page.evaluate("window.__breadboardChatgptWeb.attachments()", attempts=EVAL_ATTEMPTS) or 0)
        except ProviderError:
            held = 0
        if held >= len(images):
            return
        time.sleep(0.5)
    raise ProviderError(
        f"ChatGPT is still uploading the attached images ({held} of {len(images)} ready).",
        status_code=502,
        phase="prepare",
        replay_safe=True,
    )


def _submit_turn(
    page: _Page,
    model: str,
    prompt: str,
    effort: str | None,
    images: List[str],
    *,
    temporary: bool = True,
) -> str:
    session = _session(page)
    if not session.get("signedIn"):
        session = _probe_session(page)
        if not session.get("signedIn"):
            _record_session(session, page.surface)
            raise ProviderError(
                "OpenAI (web) is signed out. Sign in to chatgpt.com from Settings.",
                status_code=401,
                phase="prepare",
                replay_safe=True,
            )
    page.drain()
    page.navigate(_chat_url(model, effort, temporary=temporary))
    if not page.wait_ready():
        raise ProviderError(
            "chatgpt.com did not show a composer. Open the ChatGPT tab and check the page, then try again.",
            status_code=503,
            phase="prepare",
            replay_safe=True,
        )
    turn_id = uuid4().hex
    page.evaluate(
        f"window.__breadboardChatgptWeb.setTurn({json.dumps(turn_id)})",
        attempts=EVAL_ATTEMPTS,
    )
    # Images first: their upload runs while the text is placed, and Send stays
    # disabled until the site holds them, which is the ordering a person gets.
    _attach_images(page, images)
    # One attempt, however long it takes. Re-issuing this while the first is
    # still working means two document-sized edits at once in a page that is
    # already struggling - measured 2026-09-14 as three renderer crashes in a
    # row (`render-process-gone`, exit -36861) where a single attempt had only
    # been slow.
    outcome = page.evaluate(
        f"window.__breadboardChatgptWeb.insert({json.dumps(prompt)})",
        timeout=INSERT_TIMEOUT_SECONDS,
    )
    if outcome != "ok":
        raise ProviderError(
            f"The message could not be placed in ChatGPT's composer ({outcome}).",
            status_code=502,
            phase="prepare",
            replay_safe=True,
        )
    accepted = page.evaluate(
        f"window.__breadboardChatgptWeb.send({int(SEND_TIMEOUT_SECONDS * 1000)})",
        await_promise=True,
        timeout=SEND_TIMEOUT_SECONDS + 15,
    )
    if accepted != "ok":
        # `send_disabled` carries whatever the site said about the refusal
        # (see `notice()` in the page script), so it is not matched exactly.
        refused = isinstance(accepted, str) and accepted.startswith("send_disabled")
        detail = str(accepted)
        message = (
            f"ChatGPT would not send the message on this model - {detail.split(': ', 1)[1]}"
            if refused and ": " in detail
            else f"ChatGPT did not accept the message ({detail})."
        )
        raise ProviderError(
            message,
            status_code=502,
            phase="send",
            replay_safe=refused,
        )
    return turn_id


# chatgpt.com marks citations of uploaded files with private-use characters
# (U+E200 ... U+E201 around a `filecite` reference, U+E202 as its separator;
# seen as soon as a message carried an attached image). They are markup for
# the site's own renderer, not text, and a client would show them as boxes.
_MARK_OPEN, _MARK_CLOSE = chr(0xE200), chr(0xE201)
_SITE_MARK = re.compile(
    f"{_MARK_OPEN}[^{_MARK_CLOSE}]*{_MARK_CLOSE}|[{chr(0xE202)}-{chr(0xE206)}]"
)


def _clean_text(text: str, *, final: bool = False) -> str:
    """The answer without the site's citation markup.

    While streaming, a marker still open at the tail (its U+E201 not yet
    streamed) is held back whole, so the cleaned text only ever grows by
    appending and the streaming delta stays a true delta. A ``final`` answer
    has nothing more coming: a marker that never closed loses only its own
    private-use characters. Holding it back there cut a Learn critic's JSON
    at its first citation (2026-09-14) - everything after the marker vanished.
    """
    if _MARK_OPEN not in text and not _SITE_MARK.search(text):
        return text
    tail = text.rfind(_MARK_OPEN)
    if tail >= 0 and _MARK_CLOSE not in text[tail:]:
        if final:
            return _SITE_MARK.sub("", text[:tail]) + _SITE_MARK.sub("", text[tail:].replace(_MARK_OPEN, ""))
        text = text[:tail]
    return _SITE_MARK.sub("", text)


_WRITING_OPEN = re.compile(r"^:::writing\{[^\n]*\}[ \t]*$", re.MULTILINE)
_WRITING_CLOSE = re.compile(r"^:::[ \t]*$", re.MULTILINE)
_ASSISTANT_COMMENTARY = re.compile(r"^(?:I['’](?:ll|m|ve)|I (?:will|am|have)|Here(?:['’]s| is| are))\b")


def _unwrap_writing_block(text: str) -> str:
    """Take the deliverable out of chatgpt.com's writing block.

    The web chat models answer a long "write this document" request as a
    sentence of commentary followed by `:::writing{variant="document" ...}`,
    the document, and a closing `:::` - the site's markup for its document
    card, like the citation markers. Seen 2026-09-15 in four Learn lesson
    pages, frontmatter intact above it. The wrapper lines go; so does the one
    paragraph right before the block when it is first-person commentary
    ("I'll treat the pasted content as ..."). Everything else stays.
    """
    opened = _WRITING_OPEN.search(text)
    if not opened:
        return text
    closed = None
    for candidate in _WRITING_CLOSE.finditer(text, opened.end()):
        closed = candidate
    if closed is None:
        return text
    before = text[: opened.start()]
    inside = text[opened.end() : closed.start()].strip("\n")
    after = text[closed.end() :]
    paragraphs = before.rstrip().rsplit("\n\n", 1)
    if len(paragraphs) == 2 and _ASSISTANT_COMMENTARY.match(paragraphs[1].strip()):
        before = paragraphs[0] + "\n\n"
    elif len(paragraphs) == 1 and _ASSISTANT_COMMENTARY.match(paragraphs[0].strip()):
        before = ""
    else:
        before = before.rstrip() + "\n\n" if before.strip() else ""
    return (before + inside + after).rstrip() + ("\n" if text.endswith("\n") else "")


def _finished_text(text: str) -> str:
    """A complete answer as the client receives it."""
    return _unwrap_writing_block(_clean_text(text, final=True))


def _stop_generation(page: _Page) -> None:
    """Press the site's Stop, best effort. A page that cannot hear it is
    already beyond helping, and the caller is on its way out either way."""
    try:
        page.evaluate("window.__breadboardChatgptWeb.stop()", timeout=5)
    except ProviderError:
        pass


def _collect_turn(
    page: _Page,
    turn_id: str,
    *,
    on_text: Callable[[str], None] | None,
    deadline: float,
    cancel: threading.Event | None = None,
) -> TurnResult:
    """Follow the answer to its end, from the event stream when the page
    hears one and from the rendered turn otherwise."""
    result = TurnResult()
    # `raw` is the answer as the site has sent it so far; `streamed` is what
    # the client has been given, which is `raw` with the site's markup taken
    # out. The two must stay apart: cleaning holds back an unfinished marker,
    # and appending the next delta to the cleaned text would lose its start.
    raw = ""
    streamed = ""
    # The last text pushed, before cleaning: what a finished answer is made
    # from, so a marker held back while streaming is not lost at the end.
    latest = ""
    stream_seen = False
    # The answer's own event stream arrived over the site's WebSocket. From
    # then on the rendered page never overrides it.
    socket_seen = False
    last_dom_text = ""
    idle_since: float | None = None
    last_poll = 0.0
    # The fetch observer normally reports within a second of the click. Until
    # it has had that chance, rendered text is not read: pushing it first and
    # then receiving the stream's own deltas would double the opening words.
    dom_grace_until = time.time() + 3.0
    # Consecutive reads the page did not answer. A thinking model leaves the
    # renderer idle and these still answer; only a wedged one misses them all.
    unanswered = 0
    # When the answer last arrived over the site's socket. While it keeps
    # arriving the page is alive and the rendered-page reader is not needed.
    last_socket_event_at = 0.0

    def push(new_text: str) -> None:
        nonlocal streamed, latest
        latest = new_text
        new_text = _clean_text(new_text)
        if new_text == streamed:
            return
        if on_text is not None:
            if new_text.startswith(streamed):
                delta = new_text[len(streamed):]
                if delta:
                    on_text(delta)
            else:
                # The site rewrote earlier text; a client cannot unsend, so
                # the rest of the answer follows as one piece.
                on_text("\n" + new_text)
        streamed = new_text

    while True:
        now = time.time()
        if cancel is not None and cancel.is_set():
            _stop_generation(page)
            raise _TurnAbandoned(
                "The request was abandoned before ChatGPT finished answering.",
                status_code=499,
                phase="receive",
                partial_output=bool(streamed),
            )
        if now > deadline:
            _stop_generation(page)
            raise ProviderError("ChatGPT took too long to finish answering.", status_code=504, phase="receive", partial_output=bool(streamed))
        try:
            event = page.events.get(timeout=0.5)
        except queue.Empty:
            event = None
        if event is not None and event.get("turn") == turn_id:
            kind = event.get("type")
            # A page that is still sending this turn's events is not wedged,
            # however slowly it answers a read.
            unanswered = 0
            if socket_seen or (kind == "stream" and event.get("mode") == "ws"):
                last_socket_event_at = time.time()
            if kind == "handoff":
                # The POST only pointed at the WebSocket. Give that stream a
                # moment to start before falling back to the rendered page.
                if not socket_seen:
                    stream_seen = False
                    dom_grace_until = time.time() + HANDOFF_GRACE_SECONDS
            elif kind == "stream":
                stream_seen = True
                if event.get("mode") == "ws":
                    socket_seen = True
                result.mode = str(event.get("mode") or "sse")
                if isinstance(event.get("model"), str):
                    result.model = event["model"]
            elif kind == "text":
                if isinstance(event.get("append"), str):
                    raw += event["append"]
                    push(raw)
                elif isinstance(event.get("replace"), str):
                    raw = event["replace"]
                    push(raw)
            elif kind == "error":
                status = int(event.get("status") or 502)
                body = str(event.get("body") or "")
                if not body.strip() and hasattr(page, "refusal_body"):
                    body = page.refusal_body(status)
                raise _site_error(status, body)
            elif kind == "done":
                full = event.get("text") if isinstance(event.get("text"), str) else ""
                text = _finished_text(full)
                if text:
                    push(full)
                    result.text = text
                    result.reasoning = str(event.get("reasoning") or "")
                    result.conversation_id = event.get("conversationId") if isinstance(event.get("conversationId"), str) else None
                    result.message_id = event.get("messageId") if isinstance(event.get("messageId"), str) else None
                    if isinstance(event.get("model"), str):
                        result.model = event["model"]
                    return result
                # An empty stream: the page may have rendered the answer some
                # other way. Fall through to the DOM reader below.
                result.mode = "dom"
                stream_seen = False
            continue

        # No stream event to act on: consult the rendered page at a low rate.
        if now - last_poll < 0.6:
            continue
        # While the socket is delivering the answer, the page is not read at
        # all. snapshot() serialises the whole rendered answer; polling it
        # every 0.6 s against a ~190k-character learning-unit contract left
        # the renderer unable to answer, and the turn was dropped as
        # "stopped responding" after 15 minutes (2026-09-15). The socket's own
        # `done` ends the turn; a socket that goes quiet falls back to reads.
        if socket_seen and now - last_socket_event_at < SOCKET_QUIET_READ_SECONDS:
            continue
        last_poll = now
        try:
            snapshot = page.evaluate("window.__breadboardChatgptWeb.snapshot()", attempts=2)
        except _PageUnresponsive:
            unanswered += 1
            if unanswered >= COLLECT_UNRESPONSIVE_LIMIT:
                # Minutes of a page that answers nothing: the renderer is gone,
                # not busy. Drop it so the next request gets a fresh one.
                _drop_page()
                raise _unresponsive_error(page.surface) from None
            continue
        except ProviderError:
            continue
        unanswered = 0
        if not isinstance(snapshot, dict):
            continue
        generating = bool(snapshot.get("generating"))
        dom_text = str(snapshot.get("text") or "")
        reads_dom = result.mode == "dom" or (not stream_seen and now >= dom_grace_until)
        if reads_dom and dom_text and dom_text != last_dom_text:
            last_dom_text = dom_text
            push(dom_text)
        if generating:
            idle_since = None
            continue
        if idle_since is None:
            idle_since = now
            continue
        settled = now - idle_since
        if streamed and settled >= 1.5:
            result.text = _finished_text(latest) or streamed
            if not stream_seen:
                result.mode = "dom"
            return result
        if not streamed and settled >= 20:
            raise ProviderError(
                "ChatGPT finished without an answer. Open the ChatGPT tab to see what it showed.",
                status_code=502,
                phase="receive",
            )


# --------------------------------------------------------------------------
# Dispatch client interface
# --------------------------------------------------------------------------


class _WebResponse:
    """Duck-typed stand-in for ``requests.Response`` as dispatch reads it."""

    def __init__(
        self,
        status_code: int,
        body: Dict[str, Any] | None = None,
        *,
        stream: Callable[[], Iterator[bytes]] | None = None,
        on_close: Callable[[], None] | None = None,
    ) -> None:
        self.status_code = status_code
        self._body = body
        self._stream = stream
        self._on_close = on_close
        self.headers: Dict[str, str] = {}

    def json(self) -> Any:
        if self._body is None:
            raise ValueError("no body")
        return self._body

    def iter_stream(self) -> Iterator[bytes]:
        if self._stream is None:
            return iter(())
        return self._stream()

    def close(self) -> None:
        callback, self._on_close = self._on_close, None
        if callback is not None:
            callback()


def _effort_from_payload(payload: Dict[str, Any]) -> str | None:
    effort = payload.get("reasoning_effort")
    if isinstance(effort, str) and effort.strip().lower() in WEB_REASONING_EFFORTS:
        return effort.strip().lower()
    return None


CLIENT_WATCH_INTERVAL_SECONDS = _env_seconds("CHATMOCK_CHATGPT_WEB_CLIENT_WATCH", 1)


def _watch_client(
    client_gone: Callable[[], bool] | None,
    cancel: threading.Event,
    stop: threading.Event,
) -> threading.Thread | None:
    """Cancel the turn as soon as a non-streaming caller has hung up.

    The handler is blocked in the collector and would only notice the dead
    socket when it finally writes the answer. Polling the socket from the
    side lets the collector press Stop and hand the page to the next caller
    within a second instead of after the whole answer or the turn timeout.
    """
    if client_gone is None:
        return None

    def run() -> None:
        while not stop.wait(CLIENT_WATCH_INTERVAL_SECONDS):
            try:
                gone = client_gone()
            except Exception:  # noqa: BLE001 - a probe failure never cancels a turn
                continue
            if gone:
                cancel.set()
                return

    thread = threading.Thread(target=run, name="chatgpt-web-client-watch", daemon=True)
    thread.start()
    return thread


def _describe_caller(payload: Dict[str, Any], upstream_model: str, *, stream: bool) -> str:
    """Who is asking, in the words a refusal will use about them."""
    try:
        from .. import usage_ledger

        origin = usage_ledger.request_origin(payload)
    except Exception:  # noqa: BLE001 - a label, never a reason to fail
        origin = {}
    source = str(origin.get("source") or "")
    task = origin.get("taskType")
    garden = origin.get("gardenId")
    where = f" on {garden}" if garden else ""
    what = f" ({task})" if task else ""
    if source == "learn":
        label = f"a Learn job{where}{what}"
    elif source == "council-task":
        label = f"a council task{where}{what}"
    elif source == "voice":
        label = "a read-aloud request"
    elif source in ("agent-turn", "chat") or stream:
        label = "another chat message"
    elif source and source not in ("direct", "background"):
        label = f"a {source} request"
    else:
        label = "an earlier message"
    return f"{label} on {upstream_model}"


def _elapsed_words(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s"
    minutes, rest = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {rest:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes:02d}m"


def busy_message(lane: str) -> str:
    """Why the lane's page cannot take a message right now, naming its holder."""
    holder = _lane(lane).holder
    page = "chat page" if lane == INTERACTIVE_LANE else "background page"
    if holder:
        return (
            f"OpenAI (web)'s {page} is still answering {holder['label']} "
            f"(sent {_elapsed_words(time.time() - holder['since'])} ago). "
            "Let that answer finish, or stop it, and send again."
        )
    return (
        f"OpenAI (web)'s {page} is still answering an earlier message. The browser page holds "
        "one conversation at a time - let that answer finish, or stop it, and send again."
    )


def _hold(lane: str, label: str) -> None:
    _lane(lane).holder = {"label": label, "since": time.time()}


def _resolve_lane(*, stream: bool) -> str:
    """Which page serves this request.

    A streaming caller is a person's chat and always gets the interactive
    page. Batch work gets its own page when the shell can provide one; the
    first batch request finds that out by asking for the page before it
    takes any lock, so that a shell with one page leaves batch callers
    sharing the interactive lock rather than a lock of their own over the
    same composer.
    """
    if stream:
        return INTERACTIVE_LANE
    if _lanes_supported is None:
        try:
            _ensure_page(lane=BATCH_LANE)
        except ProviderError:
            # The turn itself will report why no page could be had.
            pass
    return BATCH_LANE if _lanes_supported else INTERACTIVE_LANE


def request_chat(
    credentials: ResolvedCredentials,
    payload: Dict[str, Any],
    upstream_model: str,
    *,
    stream: bool,
    allow_preconnect_retry: bool = True,
    client_gone: Callable[[], bool] | None = None,
) -> _WebResponse:
    """Serve one chat completion by typing it into chatgpt.com.

    ``client_gone`` reports whether the caller has closed its connection. A
    batch caller that is killed mid-answer (a cancelled Learn job) would
    otherwise keep the page busy until the site finishes or the turn times
    out, and every caller queued behind it waits that long too.

    The lane's turn lock is taken here and, for a streaming answer, released
    only when the client has read (or abandoned) the stream: a page is a
    single composer and cannot hold two conversations at once. A chat and a
    Learn job are different lanes, so they hold different pages.
    """
    del allow_preconnect_retry  # the page is never retried behind the caller's back
    if _is_work_model(upstream_model):
        return _WebResponse(
            400,
            {
                "error": {
                    "message": (
                        f"{upstream_model} is a ChatGPT Work-mode model, and OpenAI (web) only uses the regular "
                        "web chat models. Choose one of those instead, such as GPT-5.6 Sol Thinking "
                        f"({PROVIDER_ID}/gpt-5-6-thinking)."
                    )
                }
            },
        )
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    prompt = compose_prompt(messages)
    if not prompt.strip():
        return _WebResponse(400, {"error": {"message": "The request had no message to send."}})
    effort = _effort_from_payload(payload)
    completion_id = f"chatcmpl-{uuid4().hex}"
    created = int(time.time())
    public_model = f"{PROVIDER_ID}/{upstream_model}"

    # A streaming caller is a person watching a spinner: refuse fast and say
    # why. A non-streaming caller is a batch job - Learn, the council, Thought
    # Topology - that would rather wait its turn than fail a whole stage on
    # "busy": Learn's strict route has no stand-in to fall back to, and its
    # retry would only meet the same lock. So batch callers queue for as long
    # as one turn may take.
    queue_wait = TURN_QUEUE_WAIT_SECONDS if stream else TURN_TIMEOUT_SECONDS
    lane = _resolve_lane(stream=stream)
    turn_lock = _lane(lane).lock
    if not turn_lock.acquire(timeout=queue_wait):
        return _WebResponse(503, {"error": {"message": busy_message(lane)}})
    _hold(lane, _describe_caller(payload, upstream_model, stream=stream))
    released = False
    # A client that walks away mid-answer (a retry, a closed tab) must not
    # leave the collector polling the page behind the next turn's back: it
    # would read the new turn's rendering and, at its own deadline, press Stop
    # on it. So the collector is cancelled first, and the page is handed on by
    # whichever side sees it actually stop.
    cancel = threading.Event()
    collector: List[threading.Thread] = []
    release_lock = threading.Lock()

    def release() -> None:
        nonlocal released
        thread = collector[0] if collector else None
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            # Never hold `release_lock` across this join: the collector takes
            # that same lock on its way out.
            cancel.set()
            thread.join(TURN_CANCEL_JOIN_SECONDS)
            if thread.is_alive():
                return  # the collector releases the page as it exits
        with release_lock:
            if released:
                return
            released = True
        _lane(lane).holder = None
        turn_lock.release()

    try:
        page, turn_id = _begin_turn(upstream_model, prompt, effort, _image_data_urls(messages), lane=lane)
    except _TurnFailed as exc:
        release()
        return _WebResponse(exc.status_code or 502, {"error": {"message": str(exc)}})
    except ProviderError as exc:
        release()
        return _WebResponse(exc.status_code or 502, {"error": {"message": str(exc)}})
    except Exception as exc:  # noqa: BLE001 - never leave the lock held
        release()
        return _WebResponse(502, {"error": {"message": f"OpenAI (web) failed before sending: {exc}"}})

    deadline = time.time() + TURN_TIMEOUT_SECONDS
    prompt_tokens = _estimate_tokens(prompt)

    if not stream:
        watcher_stop = threading.Event()
        watcher = _watch_client(client_gone, cancel, watcher_stop)
        try:
            result = _collect_turn(page, turn_id, on_text=None, deadline=deadline, cancel=cancel)
        except _TurnFailed as exc:
            return _WebResponse(exc.status_code or 502, {"error": {"message": str(exc)}})
        except ProviderError as exc:
            return _WebResponse(exc.status_code or 502, {"error": {"message": str(exc)}})
        finally:
            watcher_stop.set()
            if watcher is not None:
                watcher.join(CLIENT_WATCH_INTERVAL_SECONDS + 1)
            release()
        completion_tokens = _estimate_tokens(result.text)
        body = transport.chat_completion(
            completion_id=completion_id,
            created=created,
            model=public_model,
            content=result.text,
            usage={
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
            reasoning=result.reasoning or None,
        )
        return _WebResponse(200, body)

    def generate() -> Iterator[bytes]:
        chunks: "queue.Queue[bytes | None]" = queue.Queue()
        failure: List[ProviderError] = []
        include_usage = bool(
            isinstance(payload.get("stream_options"), dict)
            and payload["stream_options"].get("include_usage")
        )

        def emit_text(delta: str) -> None:
            chunks.put(
                transport.sse_chunk(
                    transport.chat_chunk(
                        completion_id=completion_id,
                        created=created,
                        model=public_model,
                        delta={"content": delta},
                    )
                )
            )

        def worker() -> None:
            try:
                result = _collect_turn(page, turn_id, on_text=emit_text, deadline=deadline, cancel=cancel)
                if result.reasoning:
                    chunks.put(
                        transport.sse_chunk(
                            transport.chat_chunk(
                                completion_id=completion_id,
                                created=created,
                                model=public_model,
                                delta={"reasoning_content": result.reasoning, "reasoning": result.reasoning},
                            )
                        )
                    )
                completion_tokens = _estimate_tokens(result.text)
                usage = (
                    {
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": prompt_tokens + completion_tokens,
                    }
                    if include_usage
                    else None
                )
                chunks.put(
                    transport.sse_chunk(
                        transport.chat_chunk(
                            completion_id=completion_id,
                            created=created,
                            model=public_model,
                            finish_reason="stop",
                            usage=usage,
                        )
                    )
                )
                chunks.put(transport.SSE_DONE)
            except _TurnAbandoned:
                # Nobody is reading; the page has already been stopped.
                pass
            except ProviderError as exc:
                failure.append(exc)
            except Exception as exc:  # noqa: BLE001
                failure.append(ProviderError(f"OpenAI (web) stopped mid-answer: {exc}", phase="receive"))
            finally:
                chunks.put(None)
                # The page is free the moment this stops reading it, whether
                # or not the client is still there to hear the answer.
                release()

        thread = threading.Thread(target=worker, name="chatgpt-web-turn", daemon=True)
        collector.append(thread)
        thread.start()
        try:
            yield transport.sse_chunk(
                transport.chat_chunk(
                    completion_id=completion_id,
                    created=created,
                    model=public_model,
                    delta={"role": "assistant", "content": ""},
                )
            )
            while True:
                try:
                    item = chunks.get(timeout=STREAM_HEARTBEAT_SECONDS)
                except queue.Empty:
                    yield transport.sse_chunk(
                        transport.chat_chunk(
                            completion_id=completion_id,
                            created=created,
                            model=public_model,
                            delta={},
                        )
                    )
                    continue
                if item is None:
                    break
                yield item
            if failure:
                raise failure[0]
        finally:
            # If the client went away mid-answer this cancels the collector,
            # which stops the site's generation before letting the page go.
            release()

    return _WebResponse(200, None, stream=generate, on_close=release)


def relay_stream(response: _WebResponse) -> Iterator[bytes]:
    try:
        yield from response.iter_stream()
    finally:
        response.close()


def call_model(call: ModelCall, credentials: ResolvedCredentials, upstream_model: str) -> str:
    """Single non-streaming call used by the council."""
    messages: List[Dict[str, Any]] = []
    if isinstance(call.system, str) and call.system.strip():
        messages.append({"role": "system", "content": call.system})
    messages.extend(call.messages or [])
    payload: Dict[str, Any] = {"messages": messages}
    if isinstance(call.reasoning_effort, str) and call.reasoning_effort.strip():
        payload["reasoning_effort"] = call.reasoning_effort.strip()
    response = request_chat(credentials, payload, upstream_model, stream=False)
    if response.status_code >= 400:
        message = transport.error_message(response, credentials.provider_id)  # type: ignore[arg-type]
        raise ProviderError(
            message,
            status_code=response.status_code,
            phase="upstream",
            replay_safe=response.status_code in (401, 403, 429),
            code="http_error",
        )
    body = response.json()
    message = body["choices"][0]["message"]
    reasoning = message.get("reasoning")
    if isinstance(reasoning, str) and reasoning:
        call.reasoning_out = reasoning
    usage = body.get("usage") or {}
    call.usage_out = ModelTokenUsage(
        input_tokens=int(usage.get("prompt_tokens", 0)),
        output_tokens=int(usage.get("completion_tokens", 0)),
        total_tokens=int(usage.get("total_tokens", 0)),
    )
    return str(message.get("content") or "")


def list_models(credentials: ResolvedCredentials) -> List[str]:
    del credentials
    return cached_model_ids()


def verify(credentials: ResolvedCredentials) -> Dict[str, Any]:
    """Settings' "Test connection": ask the live page who is signed in."""
    del credentials
    state = session_state(refresh=True)
    if state.get("error"):
        return {"ok": False, "error": state["error"]}
    if not state.get("signedIn"):
        return {"ok": False, "error": "Not signed in to chatgpt.com."}
    return {"ok": True, "models": [row["slug"] for row in state.get("models") or []][:200], "email": state.get("email")}


def reset_for_tests() -> None:
    global _system, _session_cache, _login, _state_cache, _lanes_supported
    with _lifecycle_lock:
        for slot in _lanes.values():
            if slot.page is not None:
                slot.page.close()
            slot.page = None
            slot.holder = None
            slot.lock = threading.Lock()
        _lanes_supported = None
        _system = None
        _session_cache = None
    with _login_lock:
        _login = None
    with _state_lock:
        _state_cache = None
    clear_bridge()
