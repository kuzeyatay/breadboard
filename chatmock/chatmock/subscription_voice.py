"""Bounded, subscription-only Codex voice sessions. No generic RPC proxy.

Audio goes over browser WebRTC; this local bridge owns authentication and the
native control channel. Each session has an isolated, temporary Codex home.
"""
from __future__ import annotations

import atexit
import hmac
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import subprocess
import tempfile
import threading
import time

from flask import Blueprint, jsonify, request
from .utils import get_effective_chatgpt_auth

voice_bp = Blueprint("subscription_voice", __name__)
VOICES = {"juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"}
_sessions: dict[str, "VoiceSession"] = {}
_lock = threading.RLock()


class VoiceError(Exception):
    def __init__(self, message: str, status: int = 503):
        super().__init__(message)
        self.status = status


def secret_path() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "breadboard-voice.secret"


def binary() -> str | None:
    configured = os.environ.get("BREADBOARD_CODEX_BINARY")
    if configured:
        return shutil.which(configured)
    found = shutil.which("codex")
    if found and (os.name != "nt" or found.lower().endswith(".exe")):
        return found
    # Explorer-launched Breadboard does not inherit the Codex app's private
    # PATH entry. Resolve its installed native binary, never shell a .cmd file.
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        installed = Path(os.environ["LOCALAPPDATA"]) / "OpenAI" / "Codex" / "bin"
        candidates = list(installed.glob("*/codex.exe"))
        if candidates:
            return str(max(candidates, key=lambda candidate: candidate.stat().st_mtime))
    return None


@voice_bp.before_request
def authorize():
    # Browser origins may not call the loopback gateway, even with CORS enabled
    # elsewhere in ChatMock. Only the authenticated dashboard forwards here.
    if request.headers.get("Origin"):
        raise VoiceError("Voice bridge accepts dashboard requests only.", 403)
    try:
        expected = secret_path().read_text(encoding="utf-8").strip()
    except OSError:
        expected = ""
    supplied = request.headers.get("X-Breadboard-Voice-Secret", "")
    if len(expected) < 32 or not hmac.compare_digest(supplied, expected):
        raise VoiceError("Voice bridge authentication failed.", 403)
    if not request.headers.get("X-Breadboard-Voice-Owner", "").isdigit():
        raise VoiceError("Voice session owner is required.", 403)


@voice_bp.errorhandler(VoiceError)
def voice_error(error):
    return jsonify(error=str(error)), error.status


class VoiceSession:
    def __init__(self, owner: str, executable: str):
        self.owner = owner
        self.id = secrets.token_urlsafe(24)
        self.home = tempfile.mkdtemp(prefix="breadboard-voice-")
        self.pending: dict[int, queue.Queue] = {}
        self.events: list[dict] = []
        self.event_base = 0
        self.condition = threading.Condition()
        self.write_lock = threading.Lock()
        self.closed = False
        self.counter = 0
        self.last_seen = time.monotonic()
        self.thread_id = None
        self.timer = threading.Timer(10, self.expire)
        self.timer.daemon = True
        try:
            self.proc = subprocess.Popen(
                [executable, "app-server", "--enable", "realtime_conversation"],
                cwd=self.home, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                env={**os.environ, "CODEX_HOME": self.home, "OPENAI_API_KEY": "", "CODEX_API_KEY": ""},
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except OSError:
            shutil.rmtree(self.home)
            raise VoiceError("Codex voice could not start. Install or update the native Codex CLI.") from None
        threading.Thread(target=self.read, daemon=True).start()
        self.timer.start()

    def send(self, message):
        with self.write_lock:
            if self.closed:
                raise VoiceError("This voice session has ended.", 410)
            try:
                self.proc.stdin.write(json.dumps(message) + "\n")
                self.proc.stdin.flush()
            except (OSError, ValueError):
                raise VoiceError("Codex voice disconnected.") from None

    def expire(self):
        if self.closed:
            return
        if time.monotonic() - self.last_seen > 45:
            self.close()
        else:
            self.timer = threading.Timer(10, self.expire)
            self.timer.daemon = True
            self.timer.start()

    def rpc(self, method, params):
        with self.condition:
            self.counter += 1
            rid = self.counter
            reply = queue.Queue(maxsize=1)
            self.pending[rid] = reply
        try:
            self.send({"id": rid, "method": method, "params": params})
            result = reply.get(timeout=35)
            if "error" in result:
                # Native error payloads can contain request data; do not reflect them.
                raise VoiceError("Codex rejected the subscription voice request. Update Codex and check your ChatGPT sign-in.")
            return result.get("result", {})
        except queue.Empty:
            raise VoiceError("The subscription voice connection timed out.", 504) from None
        finally:
            with self.condition:
                self.pending.pop(rid, None)

    def publish(self, event):
        with self.condition:
            if len(self.events) >= 1000:
                self.events.pop(0)
                self.event_base += 1
            self.events.append(event)
            self.condition.notify_all()

    def read(self):
        try:
            for line in self.proc.stdout:
                if len(line) > 1024 * 1024:
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                with self.condition:
                    pending = self.pending.get(msg.get("id"))
                if pending is not None and ("result" in msg or "error" in msg):
                    pending.put_nowait(msg)
                    continue
                # No approvals, tools, filesystem or arbitrary server requests.
                if "id" in msg and "method" in msg:
                    self.send({"id": msg["id"], "error": {"code": -32601, "message": "Speech-only client"}})
                    continue
                method, data = msg.get("method", ""), msg.get("params", {})
                if method == "thread/realtime/sdp":
                    self.publish({"type": "sdp", "sdp": data.get("sdp")})
                elif method == "thread/realtime/transcript/done":
                    self.publish({"type": "transcript", "role": data.get("role"), "text": str(data.get("text", ""))[:20000]})
                elif method == "thread/realtime/transcript/delta" and data.get("role") == "user":
                    self.publish({"type": "transcriptDelta", "role": "user", "text": str(data.get("delta", ""))[:20000]})
                elif method == "thread/realtime/error":
                    self.publish({"type": "error", "message": "ChatGPT voice is unavailable. Check your subscription access or try again later."})
                elif method == "thread/realtime/closed":
                    self.publish({"type": "closed"})
        except (OSError, ValueError, VoiceError):
            pass
        finally:
            with self.condition:
                for pending in self.pending.values():
                    if pending.empty():
                        pending.put_nowait({"error": {}})
            self.publish({"type": "closed"})

    def start(self, token, account_id, sdp, voice, mode, language):
        self.rpc("initialize", {"clientInfo": {"name": "breadboard_voice", "version": "0.1.0"}, "capabilities": {"experimentalApi": True}})
        self.send({"method": "initialized"})
        self.rpc("account/login/start", {"type": "chatgptAuthTokens", "accessToken": token, "chatgptAccountId": account_id})
        account = self.rpc("account/read", {"refreshToken": False}).get("account") or {}
        if account.get("type") != "chatgpt":
            raise VoiceError("ChatGPT sign-in is required. API keys are never used.", 401)
        result = self.rpc("thread/start", {"ephemeral": True, "cwd": self.home, "sandbox": "read-only", "approvalPolicy": "never", "baseInstructions": "Speech adapter only. Never use tools or access files.", "developerInstructions": "Never run tools or delegate tasks."})
        self.thread_id = result["thread"]["id"]
        prompt = ("Read aloud only client-supplied text. Do not use tools or delegate any tasks."
                  if mode == "speak" else "You are Breadboard's speech adapter. Listen to incoming speech; never answer its questions yourself. Only read aloud client-supplied agent text. Do not use tools or delegate tasks.")
        if language:
            prompt += f" The spoken language is {language}."
        self.rpc("thread/realtime/start", {"threadId": self.thread_id, "outputModality": "audio", "version": "v3", "voice": voice, "clientManagedHandoffs": True, "includeStartupContext": False, "prompt": prompt, "transport": {"type": "webrtc", "sdp": sdp}})

    def close(self):
        with self.condition:
            if self.closed:
                return
            self.closed = True
            self.condition.notify_all()
        self.timer.cancel()
        # The process is ours, with no tools/descendants. Closing stdio lets Codex
        # tear down the upstream call; terminate is a bounded fallback.
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=3)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self.proc.kill()
            self.proc.wait(timeout=3)
        with _lock:
            _sessions.pop(self.id, None)
        shutil.rmtree(self.home, ignore_errors=True)


def owned(session_id):
    with _lock:
        session = _sessions.get(session_id)
    if not session or session.owner != request.headers["X-Breadboard-Voice-Owner"]:
        raise VoiceError("Voice session not found.", 404)
    session.last_seen = time.monotonic()
    return session


@voice_bp.get("/breadboard/voice/status")
def status():
    token, account_id = get_effective_chatgpt_auth()
    ready = bool(token and account_id and binary())
    return jsonify(configured=ready, source="subscription", error=None if ready else "Sign in to ChatGPT in Accounts and install the native Codex CLI. No API key is used.")


@voice_bp.post("/breadboard/voice/sessions")
def create():
    if request.content_length is None or request.content_length > 100000:
        raise VoiceError("Voice request is too large.", 413)
    data = request.get_json(silent=True) or {}
    sdp, voice, mode = data.get("sdp"), data.get("voice"), data.get("mode")
    language = data.get("language")
    if not isinstance(sdp, str) or not sdp.startswith("v=0") or voice not in VOICES or mode not in ("speak", "transcribe", "conversation"):
        raise VoiceError("Invalid voice connection request.", 400)
    if language is not None and (not isinstance(language, str) or len(language) > 12 or not language.replace("-", "").isalpha()):
        raise VoiceError("Invalid speech language.", 400)
    token, account_id = get_effective_chatgpt_auth()
    executable = binary()
    if not token or not account_id:
        raise VoiceError("Sign in to ChatGPT in Accounts first. API keys are not accepted.", 401)
    if not executable:
        raise VoiceError("Install the native Codex CLI to use subscription voice.")
    owner = request.headers["X-Breadboard-Voice-Owner"]
    with _lock:
        stale = [s for s in _sessions.values() if time.monotonic() - s.last_seen > 30]
    for session in stale:
        session.close()
    with _lock:
        if len(_sessions) >= 4 or sum(s.owner == owner for s in _sessions.values()) >= 2:
            raise VoiceError("Another voice operation is still running. Stop it and try again.", 429)
        session = VoiceSession(owner, executable)
        _sessions[session.id] = session
    try:
        session.start(token, account_id, sdp, voice, mode, language)
        return jsonify(id=session.id)
    except Exception as error:
        session.close()
        if isinstance(error, VoiceError):
            raise
        raise VoiceError("Subscription voice could not start.") from None


@voice_bp.get("/breadboard/voice/sessions/<session_id>")
def events(session_id):
    session = owned(session_id)
    try:
        cursor = max(0, int(request.args.get("cursor", "0")))
    except ValueError:
        raise VoiceError("Invalid event cursor.", 400) from None
    with session.condition:
        if session.event_base + len(session.events) <= cursor and not session.closed:
            session.condition.wait(timeout=15)
        return jsonify(events=session.events[max(0, cursor - session.event_base):], cursor=session.event_base + len(session.events))


@voice_bp.post("/breadboard/voice/sessions/<session_id>")
def speak(session_id):
    session = owned(session_id)
    if request.content_length is None or request.content_length > 20000:
        raise VoiceError("Speech text is too large.", 413)
    text = (request.get_json(silent=True) or {}).get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        raise VoiceError("Subscription read-aloud supports up to 4,000 characters at a time.", 400)
    session.rpc("thread/realtime/appendSpeech", {"threadId": session.thread_id, "text": text})
    return jsonify(ok=True)


@voice_bp.delete("/breadboard/voice/sessions/<session_id>")
def stop(session_id):
    owned(session_id).close()
    return jsonify(ok=True)


@atexit.register
def close_all():
    for session in list(_sessions.values()):
        session.close()
