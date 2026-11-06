"""ChatGPT voice: the site's own voice conversation, run in the driven page.

Read aloud (``chatgpt_web_voice``) has to make every reading a ChatGPT turn
first, so it can never be as quick as the site. This is the other way round:
the person talks to ChatGPT's own voice in the page Breadboard already drives,
at the site's own speed, and Breadboard copies the conversation into its chat
as it happens. The answers are ChatGPT's, not Breadboard's assistant's; the
chat so far is posted first as a message, so ChatGPT knows the context.

One conversation at a time, holding the interactive page for as long as it
lasts. The shell lets that page use the microphone only between ``start`` and
``stop``. A session nobody polls any more (the Breadboard window went away) is
ended by a watchdog, so the microphone and the page are never left behind.
"""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Dict, Iterator, List
from uuid import uuid4

from . import chatgpt_web as web
from . import chatgpt_web_voice as speech
from .chatgpt_web_voice import WebSpeechError, _log
from .types import ProviderError

# The chat so far, as posted to ChatGPT before the voice starts.
MAX_CONTEXT_CHARACTERS = 12_000
# Only closing Breadboard's voice screen ends a call. A screen that has not
# asked for news this long was closed without saying so (its window died), and
# the microphone and the page are taken back.
IDLE_SECONDS = web._env_seconds("CHATMOCK_CHATGPT_WEB_LIVE_IDLE", 300)
# How often a voice that switched itself off is started again.
RESUME_SECONDS = web._env_seconds("CHATMOCK_CHATGPT_WEB_LIVE_RESUME", 10)
# The screen holds a presence request open for the whole call, so a closed tab
# is noticed even when its page never got to say goodbye (measured 2026-10-07:
# a closed tab sent no DELETE and the call ran until the idle backstop). A
# hidden, throttled tab keeps its connection, so switching tabs ends nothing.
PRESENCE_SECONDS = web._env_seconds("CHATMOCK_CHATGPT_WEB_LIVE_PRESENCE", 240)
PRESENCE_TICK_SECONDS = 2
# How long without any presence before the screen counts as closed: room for
# the screen to open the next presence request, or a dev server to reload.
PRESENCE_GRACE_SECONDS = web._env_seconds("CHATMOCK_CHATGPT_WEB_LIVE_PRESENCE_GRACE", 20)
VOICE_START_SECONDS = web._env_seconds("CHATMOCK_CHATGPT_WEB_LIVE_START", 20)
CONTEXT_TURN_SECONDS = web._env_seconds("CHATMOCK_CHATGPT_WEB_LIVE_CONTEXT_TIMEOUT", 120)
# Polls in a row that could not read the page before the session is given up
# for the screen to start a fresh one.
POLL_FAILURES = 4

FINISHED = ("finished_successfully", "finished_partial_completion")
# The voice runs inside the chat's composer (measured 2026-10-07): "Start
# Voice" opens it, "Loading voice" / "Cancel loading" show while it connects,
# and its controls replace the composer's while it runs.
_START_LABEL = re.compile(r"^start voice$", re.IGNORECASE)
_LOADING_LABEL = re.compile(r"^(loading voice|cancel loading)$", re.IGNORECASE)
_END_LABEL = re.compile(
    r"^(end|end voice|end call|end conversation|stop voice|leave voice|exit voice( mode)?|hang up|cancel loading)$",
    re.IGNORECASE,
)
# The site's own mute, beside End Voice (measured 2026-10-08).
_MIC_OFF_LABEL = re.compile(r"^turn off microphone$", re.IGNORECASE)
_MIC_ON_LABEL = re.compile(r"^turn on microphone$", re.IGNORECASE)
# Mean level of ChatGPT's incoming audio over one poll above which it counts
# as speaking (WebRTC's 0..1 audio level; silence reads ~0.001).
SPEAKING_LEVEL = 0.01
_VOICE_CONTROL = re.compile(r"microphone|\bmute\b|^end\b|hang up|cancel loading", re.IGNORECASE)
_CONVERSATION_PATH = re.compile(r"^/c/([0-9a-f][0-9a-f-]{7,})$", re.IGNORECASE)


def context_prompt(context: str) -> str:
    excerpt = context.strip()
    if len(excerpt) > MAX_CONTEXT_CHARACTERS:
        # The most recent part of the chat matters most.
        excerpt = "..." + excerpt[-MAX_CONTEXT_CHARACTERS:]
    return (
        "I'm about to talk with you by voice. For context, here is the conversation I have been having "
        "in another app (Breadboard). Don't answer it now: reply only with \"Ready.\", then carry on "
        "naturally from it once I start talking.\n\n" + excerpt
    )


def message_text(content: Any) -> str:
    """The words of a stored message: text parts and voice transcriptions."""
    if not isinstance(content, dict):
        return ""
    pieces: List[str] = []
    for part in content.get("parts") or []:
        if isinstance(part, str):
            pieces.append(part)
        elif isinstance(part, dict) and isinstance(part.get("text"), str):
            # A voice turn stores its words as an `audio_transcription` part
            # beside the audio itself.
            pieces.append(part["text"])
    if not pieces and isinstance(content.get("text"), str):
        pieces.append(content["text"])
    return "\n".join(piece.strip() for piece in pieces if piece and piece.strip())


# --------------------------------------------------------------------------
# Page scripts
# --------------------------------------------------------------------------

# Keeps the page's WebRTC connections so a poll can read how loud ChatGPT's
# incoming voice is: the site shows nothing while it speaks. Installed before
# each Start Voice; the connection itself is the site's own, untouched.
_TRACK_CALLS = """(() => {
  if (window.__bbVoiceCalls) return true;
  const Native = window.RTCPeerConnection;
  if (!Native) return false;
  const calls = window.__bbVoiceCalls = [];
  const Tracked = function (...args) {
    const call = new Native(...args);
    calls.push(call);
    if (calls.length > 4) calls.shift();
    return call;
  };
  Tracked.prototype = Native.prototype;
  Object.setPrototypeOf(Tracked, Native);
  window.RTCPeerConnection = Tracked;
  return true;
})()"""

# Hanging up takes seconds (the last messages are read first, then the site's
# End control is pressed and awaited); this silences the call at once: no
# more of ChatGPT is heard and nothing more of the person is sent.
_SILENCE = """(() => {
  for (const call of window.__bbVoiceCalls || []) {
    for (const part of [...call.getReceivers(), ...call.getSenders()]) if (part.track) part.track.enabled = false;
  }
  return true;
})()"""

_VOICE_STATE = """(async () => {
  const shown = [...document.querySelectorAll('button, [role="button"]')].filter(b => b.getClientRects().length > 0);
  const labelled = shown.map(b => {
    const r = b.getBoundingClientRect();
    return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 60), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }).filter(b => b.label);
  // ChatGPT's voice level since the last read: energy over time from the
  // stats, so the gaps between words do not read as silence.
  let level = null;
  const call = (window.__bbVoiceCalls || []).filter(c => c.connectionState === 'connected').at(-1);
  if (call) {
    const stats = await Promise.race([call.getStats(), new Promise(r => setTimeout(() => r(null), 500))]).catch(() => null);
    let energy = 0, seconds = 0;
    stats && stats.forEach(s => {
      if (s.type === 'inbound-rtp' && s.kind === 'audio') { energy += s.totalAudioEnergy || 0; seconds += s.totalSamplesDuration || 0; }
    });
    const last = window.__bbVoiceEnergy;
    if (last && seconds > last.seconds) level = Math.sqrt(Math.max(0, energy - last.energy) / (seconds - last.seconds));
    window.__bbVoiceEnergy = { energy, seconds };
  }
  return {
    level,
    path: location.pathname,
    buttons: labelled.filter(b => /voice|call|end|mute|mic|cancel|hang/i.test(b.label)).slice(0, 20),
    // The site's own notice when the browser refused it the microphone.
    micBlocked: shown.some(b => /microphone access/i.test(b.textContent || '')),
  };
})()"""


def _messages_expression(conversation_id: str) -> str:
    return "(async () => {" + speech._SESSION_TOKEN + """
  if (!token) return { status: 401 };
  const response = await fetch('/backend-api/conversation/' + encodeURIComponent(%s), {
    credentials: 'include', headers: { authorization: 'Bearer ' + token },
  }).catch(() => null);
  if (!response || !response.ok) return { status: response ? response.status : 0 };
  const body = await response.json().catch(() => null);
  const messages = Object.values((body && body.mapping) || {}).map(node => node && node.message).filter(message =>
    message && message.author && (message.author.role === 'user' || message.author.role === 'assistant')
    && !(message.metadata && message.metadata.is_visually_hidden_from_conversation));
  messages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
  return { status: 200, messages: messages.map(message => ({
    id: message.id, role: message.author.role, status: message.status || '', content: message.content,
  })) };
})()""" % json.dumps(conversation_id)


# --------------------------------------------------------------------------
# A session
# --------------------------------------------------------------------------


class _Session:
    def __init__(self, owner: str) -> None:
        self.id = uuid4().hex
        self.owner = owner
        self.page: "web._Page | None" = None
        self.conversation_id: str | None = None
        # Every chat this session used, all hidden when it ends.
        self.conversations: set[str] = set()
        self.seen: set[str] = set()
        self.started_at = time.time()
        self.polled_at = time.time()
        self.ended = False
        self.failures = 0
        self.resumed_at = 0.0
        # Open presence requests, and when the last one closed (None: the
        # screen never opened one, so only the idle backstop applies).
        self.present = 0
        self.absent_since: float | None = None
        # One page request at a time: polls, the watchdog and stop share it.
        self.lock = threading.Lock()


_current: _Session | None = None
_current_lock = threading.Lock()


def reset_for_tests() -> None:
    global _current
    with _current_lock:
        _current = None


def _state(page: "web._Page") -> Dict[str, Any]:
    state = speech._evaluate(page, _VOICE_STATE, timeout=10)
    return state if isinstance(state, dict) else {"path": "", "buttons": []}


def _button(state: Dict[str, Any], pattern: "re.Pattern[str]") -> Dict[str, Any] | None:
    for button in state.get("buttons") or []:
        if isinstance(button, dict) and pattern.search(str(button.get("label") or "")):
            return button
    return None


def _voice_phase(state: Dict[str, Any]) -> str:
    """"off", "connecting" or "on"."""
    if _button(state, _START_LABEL) is not None:
        return "off"
    if _button(state, _LOADING_LABEL) is not None:
        return "connecting"
    return "on" if _button(state, _VOICE_CONTROL) is not None else "off"


def _voice_active(state: Dict[str, Any]) -> bool:
    return _voice_phase(state) != "off"


def _labels(state: Dict[str, Any]) -> List[str]:
    return [str(button.get("label")) for button in state.get("buttons") or [] if isinstance(button, dict)]


def _click(page: "web._Page", button: Dict[str, Any]) -> None:
    """A real click: the site starts audio only on a person's gesture, and a
    script's ``click()`` does not count as one."""
    x, y = float(button.get("x") or 0), float(button.get("y") or 0)
    for kind in ("mousePressed", "mouseReleased"):
        page.cdp.call(
            "Input.dispatchMouseEvent",
            {"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1},
            timeout=10,
        )


def _stored(page: "web._Page", conversation_id: str) -> List[Dict[str, Any]]:
    found = speech._evaluate(page, _messages_expression(conversation_id), timeout=15)
    if not isinstance(found, dict) or int(found.get("status") or 0) != 200:
        return []
    return [row for row in found.get("messages") or [] if isinstance(row, dict) and isinstance(row.get("id"), str)]


def _conversation_from_path(state: Dict[str, Any]) -> str | None:
    matched = _CONVERSATION_PATH.match(str(state.get("path") or ""))
    return matched.group(1) if matched else None


def _open_chat(context: str) -> tuple["web._Page", str | None]:
    """A fresh chat in the page, holding the context when there is some."""
    model = speech.reader_model()
    if context.strip():
        started_at = time.time()
        page, turn_id = web._begin_turn(model, context_prompt(context), None, [], temporary=False, soft=True)
        result = web._collect_turn(page, turn_id, on_text=None, deadline=time.time() + CONTEXT_TURN_SECONDS)
        _message_id, conversation_id = speech._answer_ids(page, result, turn_id, started_at)
        return page, conversation_id
    page = web._ensure_page()
    url = web._chat_url(model, None, temporary=False)
    if not page.soft_navigate(url):
        page.navigate(url, full_load=False)
    if not page.wait_ready():
        raise WebSpeechError("chatgpt.com did not open a new chat. Try again.", 503)
    return page, None


def _start_voice(page: "web._Page") -> None:
    state = _state(page)
    start = _button(state, _START_LABEL)
    if start is None:
        _log(f"live: no Start Voice button; saw {_labels(state)}")
        raise WebSpeechError("ChatGPT's page shows no voice button right now. Try again in a moment.", 502)
    # Not worth failing a call over: without it the screen just never says
    # "Answering".
    speech._evaluate(page, _TRACK_CALLS, timeout=10)
    _click(page, start)
    deadline = time.time() + VOICE_START_SECONDS
    while time.time() < deadline:
        state = _state(page)
        if _voice_phase(state) == "on":
            return
        if state.get("micBlocked"):
            _log("live: the page was refused the microphone")
            raise WebSpeechError(
                "ChatGPT's page was not allowed to use the microphone. Restart Breadboard so the "
                "updated app can lend it, then try again.",
                502,
            )
        time.sleep(0.5)
    _log(f"live: voice did not start; saw {_labels(state)}")
    raise WebSpeechError("ChatGPT's voice did not start. Check the microphone and try again.", 502)


def _hang_up(page: "web._Page") -> None:
    """End the voice in the page, by its own control when there is one."""
    state = _state(page)
    if not _voice_active(state):
        return
    button = _button(state, _END_LABEL)
    if button is not None:
        _click(page, button)
        deadline = time.time() + 5
        while time.time() < deadline:
            time.sleep(0.5)
            if not _voice_active(_state(page)):
                return
    # No control that says so, or it did not take: leaving the chat ends the
    # voice with it.
    _log(f"live: hanging up by leaving the chat; saw {_labels(state)}")
    url = web._chat_url(speech.reader_model(), None, temporary=False)
    if not page.soft_navigate(url):
        page.navigate(url, full_load=False)


def _end(session: _Session) -> None:
    """Hang up, take the microphone back, hide the chat and free the page."""
    if session.ended:
        return
    session.ended = True
    page = session.page
    try:
        if page is not None:
            try:
                _hang_up(page)
            except (ProviderError, WebSpeechError) as exc:
                _log(f"live: hanging up failed: {exc}")
            # Copied into Breadboard's chat, so it leaves ChatGPT's history the
            # way a read-aloud chat does.
            for conversation_id in session.conversations:
                speech._hide(page, conversation_id)
    finally:
        try:
            web.set_microphone(False)
        except ProviderError as exc:
            _log(f"live: the microphone could not be taken back: {exc}")
        lane = web._lane(web.INTERACTIVE_LANE)
        lane.holder = None
        lane.lock.release()


_presence_lock = threading.Lock()


def _closed_reason(session: _Session) -> str | None:
    """Why the screen counts as closed, or None while it is still there."""
    with _presence_lock:
        absent = session.absent_since if session.present == 0 else None
    if absent is not None and time.time() - absent >= PRESENCE_GRACE_SECONDS:
        return f"the screen was closed ({time.time() - absent:.0f} s without it)"
    idle = time.time() - session.polled_at
    if idle >= IDLE_SECONDS:
        return f"an unattended session (idle {idle:.0f} s)"
    return None


def _watch(session: _Session) -> None:
    while True:
        time.sleep(5)
        with session.lock:
            if session.ended:
                return
            reason = _closed_reason(session)
            if reason is None:
                continue
            _log(f"live: ending {reason}")
            _end(session)
        _forget(session)
        return


def presence(session_id: str, owner: str) -> Iterator[bytes]:
    """A request the screen keeps open while it shows the call; its
    connection closing is the screen going away."""
    session = _owned(session_id, owner)

    def stream() -> Iterator[bytes]:
        with _presence_lock:
            session.present += 1
        try:
            deadline = time.time() + PRESENCE_SECONDS
            # Written every tick: a write is how a dropped connection shows.
            while not session.ended and time.time() < deadline:
                yield b"\n"
                time.sleep(PRESENCE_TICK_SECONDS)
        finally:
            with _presence_lock:
                session.present -= 1
                if session.present == 0:
                    session.absent_since = time.time()

    return stream()


def _forget(session: _Session) -> None:
    global _current
    with _current_lock:
        if _current is session:
            _current = None


def _owned(session_id: str, owner: str) -> _Session:
    with _current_lock:
        session = _current
    if session is None or session.id != session_id or session.owner != owner:
        raise WebSpeechError("That ChatGPT voice conversation has ended.", 404)
    return session


def start(context: str, owner: str) -> Dict[str, Any]:
    """Open ChatGPT's voice in a fresh chat that knows ``context``."""
    global _current
    with _current_lock:
        previous = _current
    if previous is not None:
        stop(previous.id, previous.owner)
    lane = web._lane(web.INTERACTIVE_LANE)
    if not lane.lock.acquire(timeout=web.TURN_QUEUE_WAIT_SECONDS):
        raise WebSpeechError(f"{web.busy_message(web.INTERACTIVE_LANE)} Then start ChatGPT voice again.", 503)
    web._hold(web.INTERACTIVE_LANE, "a ChatGPT voice conversation")
    session = _Session(owner)
    try:
        web.set_microphone(True)
        page, conversation_id = _open_chat(context)
        session.page = page
        session.conversation_id = conversation_id
        if conversation_id:
            session.conversations.add(conversation_id)
            # The context and ChatGPT's "Ready." are already in Breadboard.
            session.seen.update(row["id"] for row in _stored(page, conversation_id))
        _start_voice(page)
    except ProviderError as exc:
        _end(session)
        raise WebSpeechError(str(exc), exc.status_code or 502) from None
    except BaseException:
        _end(session)
        raise
    with _current_lock:
        _current = session
    threading.Thread(target=_watch, args=(session,), name="chatgpt-web-live-watch", daemon=True).start()
    _log("live: voice started")
    return {"id": session.id, "conversationId": session.conversation_id}


def _collect(session: _Session, state: Dict[str, Any], *, final: bool) -> List[Dict[str, str]]:
    """Messages not yet handed over, oldest first. Caller holds ``session.lock``."""
    page = session.page
    if page is None:
        return []
    # The chat was opened fresh for this session, so any chat the page now
    # shows is this session's: the voice may move to a chat of its own.
    shown = _conversation_from_path(state)
    if shown and shown != session.conversation_id:
        if session.conversation_id:
            _log("live: the voice moved to another chat")
        session.conversation_id = shown
    if not session.conversation_id:
        return []
    session.conversations.add(session.conversation_id)
    fresh: List[Dict[str, str]] = []
    for row in _stored(page, session.conversation_id):
        if row["id"] in session.seen:
            continue
        # An answer still being spoken is copied once it is complete, unless
        # the conversation is ending and this is the last chance.
        if not final and row.get("role") == "assistant" and row.get("status") not in FINISHED:
            continue
        text = message_text(row.get("content"))
        if not text:
            continue
        session.seen.add(row["id"])
        fresh.append({"id": row["id"], "role": str(row["role"]), "text": text})
    return fresh


def _resume(session: _Session) -> None:
    """ChatGPT's voice switched itself off (a dropped connection, the site
    hanging up): start it again in the same chat. Caller holds the lock."""
    if session.page is None or time.time() - session.resumed_at < RESUME_SECONDS:
        return
    session.resumed_at = time.time()
    _log("live: the voice switched off; starting it again")
    try:
        _start_voice(session.page)
    except WebSpeechError as exc:
        _log(f"live: the voice could not be started again: {exc}")


# A poll slower than this is logged: the screen's lag shows up here first.
SLOW_POLL_SECONDS = 5


def poll(session_id: str, owner: str) -> Dict[str, Any]:
    """What was said since the last poll. ``active`` is false only when the
    session was given up and the screen should start a fresh one."""
    session = _owned(session_id, owner)
    began = time.time()
    with session.lock:
        if session.ended or session.page is None:
            return {"active": False, "messages": []}
        try:
            state = _state(session.page)
            messages = _collect(session, state, final=False)
            session.failures = 0
            if not _voice_active(state):
                _resume(session)
            level = state.get("level")
            return {
                "active": True,
                "messages": messages,
                "speaking": isinstance(level, (int, float)) and level > SPEAKING_LEVEL,
                "muted": _button(state, _MIC_ON_LABEL) is not None,
            }
        except WebSpeechError as exc:
            # A slow or busy page is not a hung-up call: anything missed now is
            # read on a later poll, or on stop. A page that keeps failing is.
            session.failures += 1
            _log(f"live: a poll could not read the page ({session.failures}): {exc}")
            return {"active": session.failures < POLL_FAILURES, "messages": []}
        finally:
            # Counted from when the poll ends: the page being slow to answer
            # is not Breadboard having gone away (measured 2026-10-07, one poll
            # took ~45 s and the watchdog hung up mid-call).
            session.polled_at = time.time()
            if session.polled_at - began > SLOW_POLL_SECONDS:
                _log(f"live: a poll took {session.polled_at - began:.1f} s")


def listen(session_id: str, owner: str, on: bool) -> Dict[str, Any]:
    """Voice mode's ring: mute or unmute the call by the site's own button.

    Not behind ``session.lock``: a poll holds it while it reads the whole
    conversation (a second or more, measured 2026-10-11), and the ring must
    answer at once. The page takes concurrent requests."""
    session = _owned(session_id, owner)
    page = session.page
    if session.ended or page is None:
        raise WebSpeechError("That ChatGPT voice conversation has ended.", 404)
    state = _state(page)
    button = _button(state, _MIC_ON_LABEL if on else _MIC_OFF_LABEL)
    if button is not None:
        _click(page, button)
    elif _button(state, _MIC_OFF_LABEL if on else _MIC_ON_LABEL) is None:
        _log(f"live: no microphone button; saw {_labels(state)}")
        raise WebSpeechError("ChatGPT's page shows no microphone button right now.", 502)
    return {"muted": not on}


def stop(session_id: str, owner: str) -> Dict[str, Any]:
    """Hang up; the answer is whatever was said that no poll has collected."""
    session = _owned(session_id, owner)
    messages: List[Dict[str, str]] = []
    # Silent before anything waits: a poll may hold the lock for a while, and
    # ChatGPT must not go on talking after the screen has closed.
    if not session.ended and session.page is not None:
        try:
            speech._evaluate(session.page, _SILENCE, timeout=5)
        except (ProviderError, WebSpeechError) as exc:
            _log(f"live: the call could not be silenced: {exc}")
    with session.lock:
        try:
            if not session.ended and session.page is not None:
                messages = _collect(session, _state(session.page), final=True)
        except (ProviderError, WebSpeechError) as exc:
            _log(f"live: the last messages could not be read: {exc}")
        finally:
            _end(session)
    _forget(session)
    _log("live: voice ended")
    return {"ended": True, "messages": messages}
