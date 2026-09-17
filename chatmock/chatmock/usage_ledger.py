from __future__ import annotations

"""Who spent what, where: one ledger row per finished upstream call.

``model_routing.jsonl`` proves which provider/model served an attempt, but it
was written to answer "did failover happen", so it is silent about the two
things a spent plan window makes you ask: *which account* paid for the call
and *how many tokens* it cost. When a Plus account ran out of its 5-hour Codex
window during a night in which the routing log showed nothing at all, there
was no way to tell whether Breadboard had spent it — voice, council seats and
account handoffs all consumed quota without a row that named the account.

This ledger is that missing row. Every path that talks to a metered upstream
appends one entry when the call finishes: the ChatGPT Responses HTTP path
(chat.completions / completions / responses), the ChatGPT websocket path the
council uses, every external provider served through ``dispatch``, and the
Codex realtime voice sessions. A row carries the account (email + plan for a
ChatGPT account, the provider id for an API-key provider), the tokens the
upstream reported, the outcome, and an *origin* describing what asked for the
call (a chat turn, a Learn task, a background job, voice…).

It never stores prompts, answers, tokens or URLs. Persistence is best effort:
a ledger failure must never turn a valid model answer into an error.
"""

import json
import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Iterator, List, Optional

from .utils import eprint, get_home_dir

USAGE_LEDGER_FILENAME = "usage_ledger.jsonl"
#: Above this the current file is rotated to ``usage_ledger.1.jsonl`` and the
#: previous rotation dropped. The reader walks both, newest first.
_ROTATE_BYTES = 48 * 1024 * 1024
_MAX_READ_ROWS = 20_000
_SSE_BUFFER_LIMIT = 8 * 1024 * 1024

_lock = threading.Lock()

#: Task types the Learn pipeline sends. Anything else with a task type is a
#: council task from another feature and is labelled by the task itself.
_LEARN_TASK_TYPES = frozenset(
    {
        "subsection_generation",
        "section_generation",
        "topic_map",
        "learning_spine",
        "source_synthesis",
        "source_map",
        "scope_contract",
        "exam_question_generation",
        "full_page_revision",
        "visualization_generation",
        "small_revision",
        "critique",
        "note_generation",
    }
)
_TASK_SOURCES = {
    "page_assistant_answer": "page-assistant",
    "ocr": "ocr",
    "tagging": "extraction",
    "classification": "extraction",
    "metadata_generation": "extraction",
    "knowledge_extraction": "extraction",
    "prompt_improvement": "evolution",
    "template_improvement": "evolution",
    "policy_improvement": "evolution",
    "artifact_evolution": "evolution",
}


def ledger_path() -> str:
    override = (os.getenv("CHATMOCK_USAGE_LEDGER_FILE") or "").strip()
    if override:
        return os.path.abspath(override)
    return os.path.abspath(os.path.join(get_home_dir(), USAGE_LEDGER_FILENAME))


def _rotated_path(path: str) -> str:
    root, ext = os.path.splitext(path)
    return f"{root}.1{ext}"


def _clean(value: Any, limit: int = 200) -> Optional[str]:
    if not isinstance(value, str):
        return None
    try:
        cleaned = value.strip()
        return cleaned[:limit] if cleaned else None
    except Exception:
        return None


def _int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float) and math.isfinite(value):
        return max(0, int(value))
    if isinstance(value, str):
        try:
            return max(0, int(float(value)))
        except ValueError:
            return 0
    return 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------- identities


def account_summary(account: Any) -> Optional[Dict[str, Any]]:
    """A ChatGPT account as the ledger names it. Never the credential."""
    if account is None:
        return None
    key = _clean(getattr(account, "key", None), 160)
    email = _clean(getattr(account, "email", None), 200)
    plan = _clean(getattr(account, "plan", None), 40)
    if not key and not email:
        return None
    return {
        "provider": "chatgpt",
        "key": key or email,
        "label": email or key,
        "email": email,
        "plan": plan,
    }


def provider_account(provider_id: Any, label: Any = None) -> Optional[Dict[str, Any]]:
    """An API-key / subscription provider as the ledger names it."""
    provider = _clean(provider_id, 80)
    if not provider:
        return None
    return {
        "provider": provider,
        "key": provider,
        "label": _clean(label, 120) or provider,
        "email": None,
        "plan": None,
    }


# -------------------------------------------------------------------- tokens


def tokens_from_usage(usage: Any) -> Optional[Dict[str, int]]:
    """Normalise a Responses-API or chat-completions ``usage`` object."""
    if usage is None:
        return None
    if hasattr(usage, "input_tokens") and not isinstance(usage, dict):
        # providers.types.ModelTokenUsage
        return {
            "input": _int(getattr(usage, "input_tokens", 0)),
            "output": _int(getattr(usage, "output_tokens", 0)),
            "reasoning": _int(getattr(usage, "reasoning_tokens", 0)),
            "cached": _int(getattr(usage, "cached_input_tokens", 0)),
            "total": _int(getattr(usage, "total_tokens", 0)),
        }
    if not isinstance(usage, dict):
        return None
    input_tokens = _int(usage.get("input_tokens", usage.get("prompt_tokens")))
    output_tokens = _int(usage.get("output_tokens", usage.get("completion_tokens")))
    total = _int(usage.get("total_tokens")) or (input_tokens + output_tokens)
    input_details = usage.get("input_tokens_details") or usage.get("prompt_tokens_details")
    output_details = usage.get("output_tokens_details") or usage.get("completion_tokens_details")
    cached = _int(input_details.get("cached_tokens")) if isinstance(input_details, dict) else 0
    reasoning = (
        _int(output_details.get("reasoning_tokens")) if isinstance(output_details, dict) else 0
    )
    if not (input_tokens or output_tokens or total):
        return None
    return {
        "input": input_tokens,
        "output": output_tokens,
        "reasoning": reasoning,
        "cached": cached,
        "total": total,
    }


def _empty_tokens() -> Dict[str, int]:
    return {"input": 0, "output": 0, "reasoning": 0, "cached": 0, "total": 0}


def _add_tokens(into: Dict[str, int], tokens: Any) -> None:
    if not isinstance(tokens, dict):
        return
    for field in ("input", "output", "reasoning", "cached", "total"):
        into[field] = into.get(field, 0) + _int(tokens.get(field))


# -------------------------------------------------------------------- origin


def _request_headers() -> Dict[str, str]:
    try:
        from flask import has_request_context, request

        if not has_request_context():
            return {}
        return {
            "origin": request.headers.get("X-Breadboard-Origin") or "",
            "purpose": request.headers.get("X-Breadboard-Purpose") or "",
            "user_agent": request.headers.get("User-Agent") or "",
            "session": request.headers.get("X-Session-Id") or "",
        }
    except Exception:
        return {}


def _payload_flag(payload: Any, *names: str) -> Any:
    if not isinstance(payload, dict):
        return None
    for name in names:
        if name in payload:
            return payload.get(name)
    return None


def request_origin(payload: Any = None, *, kind: Optional[str] = None) -> Dict[str, Any]:
    """Describe what asked for this call, from headers and secret-free flags.

    Callers that know who they are say so with ``X-Breadboard-Origin`` (a short
    slug such as ``chat``, ``learn``, ``thought-topology``) and optionally
    ``X-Breadboard-Purpose`` (free text, one line). Everything else is inferred
    from the request shape: a council task type names its feature, a
    tool-carrying request is an agent turn, and the ``chat`` / ``default``
    sentinels separate the composer pick from background work.
    """
    headers = _request_headers()
    task_type = _clean(_payload_flag(payload, "taskType", "task_type"), 80)
    model = _payload_flag(payload, "model")
    sentinel = model if isinstance(model, str) and model in ("chat", "default") else None
    tools = _payload_flag(payload, "tools")
    has_tools = isinstance(tools, list) and len(tools) > 0
    source = _clean(headers.get("origin"), 80)
    if not source:
        if task_type:
            source = (
                "learn"
                if task_type in _LEARN_TASK_TYPES
                else _TASK_SOURCES.get(task_type, "council-task")
            )
        elif kind == "voice":
            source = "voice"
        elif has_tools:
            source = "agent-turn"
        elif sentinel == "chat":
            source = "chat"
        elif sentinel == "default":
            source = "background"
        else:
            source = "direct"
    return {
        "source": source,
        "purpose": _clean(headers.get("purpose"), 200),
        "taskType": task_type,
        "sentinel": sentinel,
        "tools": has_tools,
        "gardenId": _clean(_payload_flag(payload, "gardenId", "garden_id"), 120),
        "pageId": _clean(_payload_flag(payload, "pageId", "page_id"), 120),
        "client": _clean(headers.get("user_agent"), 120),
    }


# ------------------------------------------------------------------- writing


def _append(entry: Dict[str, Any]) -> None:
    path = ledger_path()
    line = json.dumps(entry, ensure_ascii=True, separators=(",", ":")) + "\n"
    with _lock:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        try:
            if os.path.getsize(path) > _ROTATE_BYTES:
                rotated = _rotated_path(path)
                try:
                    os.remove(rotated)
                except FileNotFoundError:
                    pass
                os.replace(path, rotated)
        except FileNotFoundError:
            pass
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line)


def record_usage(
    *,
    kind: str,
    endpoint: str,
    provider: str,
    model: Any,
    outcome: str,
    request_id: Any = None,
    requested_model: Any = None,
    account: Any = None,
    origin: Any = None,
    tokens: Any = None,
    status_code: Any = None,
    error: Any = None,
    started_at: Any = None,
    elapsed_seconds: Any = None,
    fallback: bool = False,
    extra: Any = None,
) -> Dict[str, Any]:
    """Append one finished-call row. Returns the row; never raises."""
    now = time.time()
    if isinstance(started_at, (int, float)) and not isinstance(started_at, bool):
        started_iso = (
            datetime.fromtimestamp(started_at, timezone.utc).isoformat().replace("+00:00", "Z")
        )
        if elapsed_seconds is None:
            elapsed_seconds = max(0.0, now - float(started_at))
    else:
        started_iso = None
    if isinstance(account, dict):
        account_row = account
    else:
        account_row = account_summary(account)
    normalized_tokens = (
        tokens
        if isinstance(tokens, dict) and "total" in tokens
        else tokens_from_usage(tokens)
    )
    entry: Dict[str, Any] = {
        "schemaVersion": 1,
        "at": _now_iso(),
        "startedAt": started_iso,
        "requestId": _clean(request_id, 160),
        "kind": _clean(kind, 40) or "unknown",
        "endpoint": _clean(endpoint, 80) or "unknown",
        "provider": _clean(provider, 80) or "unknown",
        "model": _clean(model, 160),
        "requestedModel": _clean(requested_model, 160),
        "account": account_row,
        "origin": origin if isinstance(origin, dict) else request_origin(kind=kind),
        "tokens": normalized_tokens,
        "outcome": _clean(outcome, 40) or "unknown",
        "statusCode": status_code if isinstance(status_code, int) and not isinstance(status_code, bool) else None,
        "error": _clean(error, 300),
        "elapsedSeconds": (
            round(float(elapsed_seconds), 3)
            if isinstance(elapsed_seconds, (int, float))
            and not isinstance(elapsed_seconds, bool)
            and math.isfinite(elapsed_seconds)
            else None
        ),
        "fallback": bool(fallback),
    }
    if isinstance(extra, dict) and extra:
        entry["extra"] = {
            str(key)[:40]: (value if isinstance(value, (int, float, bool)) else _clean(value, 200))
            for key, value in list(extra.items())[:12]
        }
    try:
        _append(entry)
    except Exception as exc:
        eprint(f"[usage-ledger] could not append row: {exc}")
    return entry


# ------------------------------------------------------- ChatGPT HTTP tapping


class _ResponsesUsageTap:
    """Watches the bytes a ``requests.Response`` yields and records the row once.

    Every consumer of the ChatGPT Responses HTTP path reads the body through
    ``iter_content`` (``iter_lines`` and ``.content`` both go through it), so
    replacing that one bound method on the instance sees the whole stream. The
    terminal SSE event (``response.completed`` / ``response.incomplete`` /
    ``response.failed``) carries ``response.usage``; a non-streaming body is a
    single JSON object with ``usage`` at the top.
    """

    def __init__(self, upstream: Any, fields: Dict[str, Any]) -> None:
        self.upstream = upstream
        self.fields = fields
        self.recorded = False
        self.usage: Optional[Dict[str, int]] = None
        self.terminal: Optional[str] = None
        self.error: Optional[str] = None
        self._line_buffer = b""
        self._body = bytearray()
        self._saw_sse = False
        self._original_iter_content = upstream.iter_content
        self._original_close = upstream.close

    # -- byte stream ------------------------------------------------------

    def iter_content(self, *args: Any, **kwargs: Any) -> Iterator[Any]:
        try:
            for chunk in self._original_iter_content(*args, **kwargs):
                try:
                    self._observe(chunk)
                except Exception:
                    pass
                yield chunk
        finally:
            self._finish()

    def close(self) -> None:
        try:
            self._original_close()
        finally:
            self._finish()

    def _observe(self, chunk: Any) -> None:
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8", errors="ignore")
        if not isinstance(chunk, (bytes, bytearray)):
            return
        # The whole body is kept only until the stream proves to be SSE; a
        # non-streaming JSON body is parsed once at the end for its `usage`.
        if not self._saw_sse and len(self._body) < _SSE_BUFFER_LIMIT:
            self._body.extend(chunk)
        self._line_buffer += bytes(chunk)
        if len(self._line_buffer) > _SSE_BUFFER_LIMIT:
            self._line_buffer = self._line_buffer[-_SSE_BUFFER_LIMIT:]
        while True:
            newline = self._line_buffer.find(b"\n")
            if newline < 0:
                break
            line = self._line_buffer[:newline].rstrip(b"\r")
            self._line_buffer = self._line_buffer[newline + 1 :]
            self._observe_line(line)

    def _observe_line(self, line: bytes) -> None:
        if not line.startswith(b"data:"):
            return
        if not self._saw_sse:
            self._saw_sse = True
            self._body = bytearray()
        data = line[5:].strip()
        if not data or data == b"[DONE]":
            return
        # Only the terminal events carry usage; the hundreds of delta events
        # a long answer streams are not worth a second JSON parse each.
        if b'"usage"' not in data and b"response.completed" not in data and b"response.incomplete" not in data and b"response.failed" not in data and b'"error"' not in data:
            return
        try:
            event = json.loads(data)
        except Exception:
            return
        if not isinstance(event, dict):
            return
        kind = event.get("type")
        response = event.get("response") if isinstance(event.get("response"), dict) else None
        if response is not None:
            usage = tokens_from_usage(response.get("usage"))
            if usage is not None:
                self.usage = usage
        if kind in ("response.completed", "response.incomplete", "response.failed"):
            self.terminal = str(kind)
            if kind == "response.failed" and response is not None:
                error = response.get("error")
                if isinstance(error, dict):
                    self.error = _clean(error.get("message"), 300)
        elif kind == "error":
            self.terminal = "error"
            self.error = _clean(event.get("message"), 300)

    def _finish(self) -> None:
        if self.recorded:
            return
        self.recorded = True
        try:
            if self.usage is None and not self._saw_sse and self._body:
                body = json.loads(bytes(self._body).decode("utf-8", errors="ignore"))
                if isinstance(body, dict):
                    self.usage = tokens_from_usage(body.get("usage"))
                    if self.terminal is None:
                        self.terminal = "json"
        except Exception:
            pass
        status = getattr(self.upstream, "status_code", None)
        if isinstance(status, int) and status >= 400:
            outcome = "quota_exhausted" if status == 429 else "failed"
        elif self.terminal in ("response.failed", "error"):
            outcome = "failed"
        elif self.terminal is None:
            outcome = "aborted"
        else:
            outcome = "succeeded"
        account = getattr(self.upstream, "chatmock_account", None)
        record_usage(
            account=account_summary(account) if account is not None and not isinstance(account, dict) else account,
            tokens=self.usage,
            outcome=outcome,
            status_code=status if isinstance(status, int) else None,
            error=self.error,
            **self.fields,
        )


def tap_chatgpt_response(
    upstream: Any,
    *,
    request_id: Any,
    endpoint: str,
    model: Any,
    requested_model: Any = None,
    origin: Any = None,
    started_at: Any = None,
    kind: str = "chat",
) -> Any:
    """Arrange for one ledger row when this ChatGPT HTTP response is consumed."""
    if upstream is None:
        return upstream
    try:
        tap = _ResponsesUsageTap(
            upstream,
            {
                "kind": kind,
                "endpoint": endpoint,
                "provider": "chatgpt",
                "model": model,
                "requested_model": requested_model,
                "request_id": request_id,
                "origin": origin if isinstance(origin, dict) else request_origin(kind=kind),
                "started_at": started_at,
            },
        )
        upstream.iter_content = tap.iter_content
        upstream.close = tap.close
        upstream.chatmock_usage_tap = tap
    except Exception as exc:
        eprint(f"[usage-ledger] could not tap response: {exc}")
    return upstream


def tap_chat_completion_stream(
    iterator: Iterable[Any],
    *,
    request_id: Any,
    endpoint: str,
    provider: str,
    model: Any,
    requested_model: Any = None,
    account: Any = None,
    origin: Any = None,
    started_at: Any = None,
    fallback: bool = False,
) -> Iterator[Any]:
    """Wrap a relayed chat-completions SSE stream and record its final usage.

    External providers stream OpenAI chunks; the last chunk (or any chunk, for
    Anthropic translations) may carry ``usage``. The row is written when the
    stream ends, however it ends.
    """
    fields = {
        "kind": "chat",
        "endpoint": endpoint,
        "provider": provider,
        "model": model,
        "requested_model": requested_model,
        "request_id": request_id,
        "account": account if isinstance(account, dict) else provider_account(provider),
        "origin": origin if isinstance(origin, dict) else request_origin(),
        "started_at": started_at,
        "fallback": fallback,
    }
    usage: Optional[Dict[str, int]] = None
    error: Optional[str] = None
    finished = False
    buffer = b""

    def observe(chunk: Any) -> None:
        nonlocal usage, error, finished, buffer
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8", errors="ignore")
        if not isinstance(chunk, (bytes, bytearray)):
            return
        buffer += bytes(chunk)
        if len(buffer) > _SSE_BUFFER_LIMIT:
            buffer = buffer[-_SSE_BUFFER_LIMIT:]
        while True:
            newline = buffer.find(b"\n")
            if newline < 0:
                break
            line = buffer[:newline].strip()
            buffer = buffer[newline + 1 :]
            if not line.startswith(b"data:"):
                continue
            data = line[5:].strip()
            if data == b"[DONE]":
                finished = True
                continue
            try:
                event = json.loads(data)
            except Exception:
                continue
            if not isinstance(event, dict):
                continue
            found = tokens_from_usage(event.get("usage"))
            if found is not None:
                usage = found
            if isinstance(event.get("error"), dict):
                error = _clean(event["error"].get("message"), 300)
            choices = event.get("choices")
            if isinstance(choices, list) and any(
                isinstance(choice, dict) and choice.get("finish_reason") for choice in choices
            ):
                finished = True

    def run() -> Iterator[Any]:
        try:
            for chunk in iterator:
                try:
                    observe(chunk)
                except Exception:
                    pass
                yield chunk
        finally:
            record_usage(
                tokens=usage,
                outcome="failed" if error else ("succeeded" if finished else "aborted"),
                error=error,
                **fields,
            )

    return run()


# ------------------------------------------------------------------- reading


def _iter_lines_newest_first(path: str) -> Iterator[str]:
    """Lines of a file, last line first, without loading more than needed."""
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            position = handle.tell()
            remainder = b""
            block = 256 * 1024
            while position > 0:
                step = min(block, position)
                position -= step
                handle.seek(position)
                data = handle.read(step) + remainder
                lines = data.split(b"\n")
                remainder = lines[0]
                for line in reversed(lines[1:]):
                    if line.strip():
                        yield line.decode("utf-8", errors="replace")
            if remainder.strip():
                yield remainder.decode("utf-8", errors="replace")
    except FileNotFoundError:
        return


def read_rows(
    *,
    since: Optional[datetime] = None,
    limit: int = 500,
    account: Optional[str] = None,
    source: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Newest rows first, bounded by ``since`` and ``limit``."""
    path = ledger_path()
    wanted_account = (account or "").strip().lower()
    wanted_source = (source or "").strip().lower()
    since_iso = since.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if since else None
    rows: List[Dict[str, Any]] = []
    scanned = 0
    for candidate in (path, _rotated_path(path)):
        for line in _iter_lines_newest_first(candidate):
            scanned += 1
            if scanned > _MAX_READ_ROWS:
                return rows
            try:
                row = json.loads(line)
            except Exception:
                continue
            if not isinstance(row, dict):
                continue
            at = row.get("at")
            if since_iso and isinstance(at, str) and at < since_iso:
                return rows
            if wanted_account:
                acct = row.get("account") if isinstance(row.get("account"), dict) else {}
                names = {
                    str(acct.get("key") or "").lower(),
                    str(acct.get("email") or "").lower(),
                    str(acct.get("label") or "").lower(),
                }
                if wanted_account not in names:
                    continue
            if wanted_source:
                origin = row.get("origin") if isinstance(row.get("origin"), dict) else {}
                if str(origin.get("source") or "").lower() != wanted_source:
                    continue
            rows.append(row)
            if len(rows) >= limit:
                return rows
    return rows


def _bucket(rows: Iterable[Dict[str, Any]], key_of) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key, label, meta = key_of(row)
        if key is None:
            continue
        bucket = buckets.get(key)
        if bucket is None:
            bucket = {
                "key": key,
                "label": label,
                "requests": 0,
                "succeeded": 0,
                "failed": 0,
                "tokens": _empty_tokens(),
                "lastAt": None,
                "firstAt": None,
                **meta,
            }
            buckets[key] = bucket
        bucket["requests"] += 1
        if row.get("outcome") == "succeeded":
            bucket["succeeded"] += 1
        else:
            bucket["failed"] += 1
        _add_tokens(bucket["tokens"], row.get("tokens"))
        at = row.get("at")
        if isinstance(at, str):
            if bucket["lastAt"] is None or at > bucket["lastAt"]:
                bucket["lastAt"] = at
            if bucket["firstAt"] is None or at < bucket["firstAt"]:
                bucket["firstAt"] = at
    return sorted(buckets.values(), key=lambda b: (-b["tokens"]["total"], -b["requests"]))


def _account_key(row: Dict[str, Any]):
    account = row.get("account") if isinstance(row.get("account"), dict) else None
    provider = row.get("provider") or "unknown"
    if account is None:
        return f"{provider}", str(provider), {"provider": provider, "plan": None, "email": None}
    key = f"{account.get('provider') or provider}:{account.get('key') or account.get('label')}"
    return key, str(account.get("label") or key), {
        "provider": account.get("provider") or provider,
        "plan": account.get("plan"),
        "email": account.get("email"),
    }


def _origin_key(row: Dict[str, Any]):
    origin = row.get("origin") if isinstance(row.get("origin"), dict) else {}
    source = origin.get("source") or "unknown"
    task = origin.get("taskType")
    key = f"{source}:{task}" if task else str(source)
    return key, str(task or source), {"source": source, "taskType": task, "kind": row.get("kind")}


def _model_key(row: Dict[str, Any]):
    model = row.get("model") or row.get("requestedModel") or "unknown"
    provider = row.get("provider") or "unknown"
    return f"{provider}:{model}", str(model), {"provider": provider}


def summarize(rows: List[Dict[str, Any]], *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Aggregate rows by account, origin and model, plus the two Codex windows."""
    now = now or datetime.now(timezone.utc)
    five_hours = (now - timedelta(hours=5)).isoformat().replace("+00:00", "Z")
    seven_days = (now - timedelta(days=7)).isoformat().replace("+00:00", "Z")
    total = _empty_tokens()
    for row in rows:
        _add_tokens(total, row.get("tokens"))

    by_account = _bucket(rows, _account_key)
    recent_5h = {b["key"]: b for b in _bucket([r for r in rows if str(r.get("at") or "") >= five_hours], _account_key)}
    recent_7d = {b["key"]: b for b in _bucket([r for r in rows if str(r.get("at") or "") >= seven_days], _account_key)}
    for bucket in by_account:
        window_5h = recent_5h.get(bucket["key"])
        window_7d = recent_7d.get(bucket["key"])
        bucket["windows"] = {
            "fiveHours": {
                "requests": window_5h["requests"] if window_5h else 0,
                "tokens": window_5h["tokens"] if window_5h else _empty_tokens(),
            },
            "sevenDays": {
                "requests": window_7d["requests"] if window_7d else 0,
                "tokens": window_7d["tokens"] if window_7d else _empty_tokens(),
            },
        }
        bucket["origins"] = _bucket(
            [r for r in rows if _account_key(r)[0] == bucket["key"]], _origin_key
        )[:8]

    return {
        "requests": len(rows),
        "tokens": total,
        "byAccount": by_account,
        "byOrigin": _bucket(rows, _origin_key),
        "byModel": _bucket(rows, _model_key),
    }
