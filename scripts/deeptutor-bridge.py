"""Run one DeepTutor turn and report it as NDJSON.

Breadboard drives the cloned DeepTutor the way its own CLI does — build a
``TurnRequest``, start the turn through ``DeepTutorApp``, and consume the
turn's event stream — but writes the stream to stdout as one JSON object per
line so the dashboard can paint it as a live card in chat.

Why a bridge and not ``deeptutor run``: the CLI's ``run`` command cannot carry
attachments or skills (``build_turn_request`` has no flag for either), and its
``--format json`` is a raw passthrough of DeepTutor's internal event protocol —
dozens of chunk events per round, with the answer spread across per-round
buffers that only settle when a later ``call_status`` marker names the round.
Everything below is the CLI's own aggregation (see ``TurnStreamRenderer`` in
``deeptutor_cli/common.py``) minus the terminal, reduced to the handful of
events a chat card actually shows. Nothing about the tutoring is reimplemented.

The model layer is ChatMock, configured before we are called: Breadboard writes
``<home>/data/user/settings/model_catalog.json`` with a ``custom`` (OpenAI-
compatible) binding pointed at ChatMock's ``/v1``. This script never touches
credentials.

Material access is also configured before we are called: ``<home>/data/user/
settings/mcp.json`` registers Breadboard's own read-only file server, scoped to
the surface's roots. To DeepTutor those are ordinary MCP tools.

Protocol: the job is one JSON object on stdin; every event is one JSON object
on stdout. stderr stays free for tracebacks and library logging. Event types:

    started    {sessionId, turnId, capability}
    stage      {stage, state}                  state: start | end
    thinking   {callId}                        reasoning began (text is not sent)
    tool       {tool, status, title, summary}
    block      {role, text}                    role: narration | finish | text
    note       {text}                          a bridge-side remark, not the model's
    sources    {sources: [...]}
    usage      {rounds, toolSteps, totalTokens, costUsd}
    ask        {questions}                     auto-answered empty, headless
    completed  {answer, sessionId, turnId}
    failed     {error, detail}
"""

from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import sys
import traceback
from pathlib import Path
from typing import Any

# The clone is the package root; the bridge lives outside it so the checkout
# stays pristine and a `git pull` there never conflicts with Breadboard's file.
CLONE_ROOT = Path(os.environ.get("DEEPTUTOR_CLONE_ROOT", "")).resolve()
if str(CLONE_ROOT) not in sys.path:
    sys.path.insert(0, str(CLONE_ROOT))


def emit(event_type: str, **payload: Any) -> None:
    """Write one event. Flushed per line so the reader sees progress live."""
    line = json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


# One LLM round starting looks like a call_status whose kind is one of these.
# Copied from deeptutor_cli.common._LLM_ROUND_CALL_KINDS rather than imported:
# it is a private name, and a rename upstream should degrade the liveness
# labels, not crash the run.
_LLM_ROUND_CALL_KINDS = {"agent_loop_round", "llm_call"}

MAX_BLOCK_CHARS = 200_000
MAX_ANSWER_CHARS = 400_000
MAX_TOOL_SUMMARY_CHARS = 600
# An attachment is inlined into the turn as base64, so the cap here is about
# what a model can be handed, not what a disk can hold.
MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024


def read_job() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("no job was sent on stdin")
    job = json.loads(raw)
    if not isinstance(job, dict):
        raise ValueError("the job must be a JSON object")
    return job


def build_attachments(entries: list[Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Load the files Breadboard picked for this turn.

    Paths rather than bytes cross the pipe: a garden's materials can run to
    megabytes, and stdin is not the place for that. Anything unreadable or
    oversized is skipped with a note rather than failing the turn — a tutor
    that answers about nine of ten attached pages beats one that refuses.
    """
    attachments: list[dict[str, Any]] = []
    skipped: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        path_value = str(entry.get("path") or "")
        if not path_value:
            continue
        source = Path(path_value)
        name = str(entry.get("filename") or source.name)
        try:
            size = source.stat().st_size
        except OSError as exc:
            skipped.append(f"{name} ({exc.strerror or 'unreadable'})")
            continue
        if size > MAX_ATTACHMENT_BYTES:
            skipped.append(f"{name} (too large)")
            continue
        try:
            data = source.read_bytes()
        except OSError as exc:
            skipped.append(f"{name} ({exc.strerror or 'unreadable'})")
            continue
        mime = str(entry.get("mimeType") or "") or (
            mimetypes.guess_type(name)[0] or "application/octet-stream"
        )
        attachments.append(
            {
                "type": "image" if mime.startswith("image/") else "file",
                "filename": name,
                "mime_type": mime,
                "base64": base64.b64encode(data).decode("ascii"),
                "url": "",
            }
        )
    return attachments, skipped


class TurnReader:
    """Aggregate one turn's event stream into the events a chat card shows.

    The chat agent loop streams every round's text as ``content`` chunks and
    only labels the round once it completes — a ``call_status`` marker whose
    ``call_role`` says whether that text was ``narration`` (preamble to tool
    calls) or the ``finish`` (the user-facing answer). Chunks are therefore
    buffered per ``call_id`` and settled when the marker arrives. Content
    without that trace metadata (deep_solve, deep_research, visualize, …) is
    buffered flat and flushed at stage boundaries, exactly as the CLI does.
    """

    def __init__(self, app: Any, turn_id: str) -> None:
        self._app = app
        self._turn_id = turn_id
        self._legacy = ""
        self._rounds: dict[str, str] = {}
        self._order: list[str] = []
        self._thinking_seen: set[str] = set()
        self._answer_parts: list[str] = []
        self._sources: list[dict[str, Any]] = []
        self._result_meta: dict[str, Any] = {}
        self.status = "running"

    # -- text settling ----------------------------------------------------

    def _push_answer(self, text: str) -> None:
        cleaned = text.strip()
        if cleaned:
            self._answer_parts.append(cleaned)

    def _settle_round(self, call_id: str, role: str) -> None:
        text = self._rounds.pop(call_id, "")
        if call_id in self._order:
            self._order.remove(call_id)
        if not text.strip():
            return
        emit("block", role=role, text=text[:MAX_BLOCK_CHARS])
        # Narration is the model talking to itself before a tool call. It is
        # worth showing live and worth leaving out of the saved answer.
        if role == "finish":
            self._push_answer(text)

    def _flush_pending(self) -> None:
        for call_id in list(self._order):
            self._settle_round(call_id, role="finish")
        if self._legacy.strip():
            emit("block", role="text", text=self._legacy[:MAX_BLOCK_CHARS])
            self._push_answer(self._legacy)
            self._legacy = ""

    # -- event handlers ---------------------------------------------------

    async def handle(self, item: dict[str, Any]) -> None:
        handler = getattr(self, f"_on_{str(item.get('type', ''))}", None)
        if handler is not None:
            await handler(item)

    async def _on_stage_start(self, item: dict[str, Any]) -> None:
        self._flush_pending()
        emit("stage", stage=str(item.get("stage") or ""), state="start")

    async def _on_stage_end(self, item: dict[str, Any]) -> None:
        self._flush_pending()
        emit("stage", stage=str(item.get("stage") or ""), state="end")

    async def _on_thinking(self, item: dict[str, Any]) -> None:
        # Reasoning text is not forwarded: it streams chunk-by-chunk and is
        # the model's private draft. One marker per round is the signal.
        call_id = str((item.get("metadata") or {}).get("call_id") or "")
        if call_id and call_id in self._thinking_seen:
            return
        self._thinking_seen.add(call_id)
        emit("thinking", callId=call_id)

    async def _on_progress(self, item: dict[str, Any]) -> None:
        metadata = item.get("metadata") or {}
        content = str(item.get("content") or "")
        if metadata.get("trace_kind") != "call_status":
            if content.strip():
                emit("stage", stage=str(item.get("stage") or ""), state="progress", label=content)
            return
        state = str(metadata.get("call_state") or "")
        call_id = str(metadata.get("call_id") or "")
        if state == "complete":
            role = str(metadata.get("call_role") or "")
            if role in {"narration", "finish"}:
                self._settle_round(call_id, role=role)
            return
        if metadata.get("call_kind") in _LLM_ROUND_CALL_KINDS and content.strip():
            emit("stage", stage=str(item.get("stage") or ""), state="round", label=content.strip())

    async def _on_content(self, item: dict[str, Any]) -> None:
        metadata = item.get("metadata") or {}
        text = str(item.get("content") or "")
        if not text:
            return
        call_id = str(metadata.get("call_id") or "")
        trace_kind = str(metadata.get("trace_kind") or "")
        if call_id and trace_kind == "llm_chunk":
            if call_id not in self._rounds:
                self._rounds[call_id] = ""
                self._order.append(call_id)
            self._rounds[call_id] += text
            return
        if trace_kind == "llm_output":
            # Whole-text emission (terminator tool / section / fallback).
            # Flush buffered chunks first so blocks keep the model's order.
            self._flush_pending()
            emit("block", role="text", text=text[:MAX_BLOCK_CHARS])
            self._push_answer(text)
            return
        self._legacy += text

    async def _on_tool_call(self, item: dict[str, Any]) -> None:
        metadata = item.get("metadata") or {}
        emit(
            "tool",
            tool=str(item.get("content") or "tool"),
            status="running",
            title=summarize_args(metadata.get("args")),
            summary="",
        )

    async def _on_tool_result(self, item: dict[str, Any]) -> None:
        metadata = item.get("metadata") or {}
        ask = ask_user_payload(item)
        if ask is not None:
            emit("ask", questions=ask.get("questions") or [])
            # Headless: nobody is at the keyboard, so an unanswered question
            # would hang the turn forever. The model sees an empty reply and
            # has to proceed on its own — the same choice the CLI makes for
            # `--format json`.
            await self._app.submit_user_reply(self._turn_id, text="")
            return
        body = str(item.get("content") or "")
        emit(
            "tool",
            tool=str(metadata.get("tool") or "tool"),
            status="failed" if metadata.get("success") is False else "completed",
            title="",
            summary=body[:MAX_TOOL_SUMMARY_CHARS],
        )

    async def _on_sources(self, item: dict[str, Any]) -> None:
        entries = (item.get("metadata") or {}).get("sources")
        if not isinstance(entries, list):
            return
        picked = [entry for entry in entries if isinstance(entry, dict)]
        if not picked:
            return
        self._sources.extend(picked)
        emit("sources", sources=picked)

    async def _on_result(self, item: dict[str, Any]) -> None:
        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            self._result_meta = metadata

    async def _on_error(self, item: dict[str, Any]) -> None:
        self._flush_pending()
        self.status = "failed"
        emit("failed", error=str(item.get("content") or "The turn failed."), detail="")

    async def _on_done(self, item: dict[str, Any]) -> None:
        self._flush_pending()
        metadata = item.get("metadata") or {}
        reported = str(metadata.get("status") or "")
        if reported and self.status != "failed":
            self.status = reported
        self._emit_usage()

    def _emit_usage(self) -> None:
        meta = self._result_meta
        cost = (meta.get("metadata") or {}).get("cost_summary") or {}
        emit(
            "usage",
            rounds=as_number(meta.get("rounds")),
            toolSteps=as_number(meta.get("tool_steps")),
            totalTokens=as_number(cost.get("total_tokens")),
            inputTokens=as_number(cost.get("prompt_tokens") or cost.get("input_tokens")),
            outputTokens=as_number(cost.get("completion_tokens") or cost.get("output_tokens")),
            costUsd=as_number(cost.get("total_cost_usd")),
        )

    def answer(self) -> str:
        return "\n\n".join(self._answer_parts)[:MAX_ANSWER_CHARS]


def as_number(value: Any) -> float | int:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def ask_user_payload(item: dict[str, Any]) -> dict[str, Any] | None:
    """The ``ask_user`` question payload carried by a tool_result event."""
    if str(item.get("type") or "") != "tool_result":
        return None
    tool_meta = (item.get("metadata") or {}).get("tool_metadata")
    if not isinstance(tool_meta, dict):
        return None
    ask = tool_meta.get("ask_user")
    return ask if isinstance(ask, dict) and ask.get("questions") else None


def summarize_args(args: Any, max_len: int = 160) -> str:
    if isinstance(args, dict) and args:
        rendered = ", ".join(f"{key}={one_line(value)}" for key, value in args.items())
    elif args:
        rendered = one_line(args)
    else:
        return ""
    return rendered[: max_len - 1].rstrip(", ") + "…" if len(rendered) > max_len else rendered


def one_line(value: Any) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            text = str(value)
    return " ".join(text.split())[:120]


async def run_turn(job: dict[str, Any]) -> int:
    from deeptutor.app import DeepTutorApp, TurnRequest
    from deeptutor.logging import configure_logging

    # Same first move as the CLI's entry point. DeepTutor's console handler is
    # a StreamHandler on *stdout*, which is this protocol's channel, so
    # Breadboard's generated main.yaml turns console logging off — the reason a
    # turn failed reaches the reader as a `failed` event instead.
    configure_logging()

    attachments, skipped = build_attachments(list(job.get("attachments") or []))
    if skipped:
        emit("note", text=f"Skipped {len(skipped)} attachment(s): {', '.join(skipped[:8])}")

    request = TurnRequest(
        content=str(job.get("message") or ""),
        capability=str(job.get("capability") or "chat"),
        session_id=str(job.get("sessionId") or "") or None,
        tools=[str(name) for name in (job.get("tools") or []) if str(name).strip()],
        knowledge_bases=[str(name) for name in (job.get("knowledgeBases") or []) if str(name)],
        language=str(job.get("language") or "en"),
        config=dict(job.get("config") or {}),
        attachments=attachments,
        skills=[str(name) for name in (job.get("skills") or []) if str(name).strip()],
    )

    app = DeepTutorApp()
    session, turn = await app.start_turn(request)
    session_id = str(session.get("id") or "")
    turn_id = str(turn.get("id") or "")
    emit("started", sessionId=session_id, turnId=turn_id, capability=request.capability)

    reader = TurnReader(app, turn_id)
    async for item in app.stream_turn(turn_id):
        await reader.handle(item)

    if reader.status == "failed":
        # The error event already said why; this only closes the run.
        emit("completed", answer=reader.answer(), sessionId=session_id, turnId=turn_id,
             status="failed")
        return 1
    emit(
        "completed",
        answer=reader.answer(),
        sessionId=session_id,
        turnId=turn_id,
        status=reader.status or "completed",
    )
    return 0


def main() -> int:
    try:
        job = read_job()
    except Exception as exc:
        emit("failed", error=f"The tutoring request could not be read: {exc}", detail="")
        return 2

    home = str(job.get("home") or "").strip()
    if home:
        # Set before any deeptutor import: `deeptutor.runtime.home` resolves the
        # workspace root at import time and every settings path hangs off it.
        os.environ["DEEPTUTOR_HOME"] = home

    try:
        return asyncio.run(run_turn(job))
    except KeyboardInterrupt:
        emit("failed", error="The session was interrupted.", detail="")
        return 130
    except Exception as exc:
        emit("failed", error=str(exc) or exc.__class__.__name__, detail=traceback.format_exc()[-4000:])
        return 1


if __name__ == "__main__":
    sys.exit(main())
