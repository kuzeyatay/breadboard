#!/usr/bin/env python3
"""Run OpenPlanter against ChatMock and expose its UI state as NDJSON events."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import time
import traceback
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit


MAX_INVOCATION_BYTES = 1024 * 1024
MAX_GRAPH_NODES = 128
MAX_GRAPH_EDGES = 192
MAX_PUBLIC_ARTIFACTS = 32
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024
MAX_EVENT_TEXT_BYTES = 32 * 1024
MAX_RESULT_SUMMARY_BYTES = 128 * 1024
INVOCATION_KEYS = {
    "protocolVersion",
    "task",
    "model",
    "baseUrl",
    "apiKey",
    "reasoningEffort",
    "maxSteps",
    "maxSeconds",
}


def bounded_utf8(value: Any, maximum_bytes: int) -> str:
    encoded = str(value or "").encode("utf-8")
    if len(encoded) <= maximum_bytes:
        return encoded.decode("utf-8")
    return encoded[:maximum_bytes].decode("utf-8", errors="ignore")


def bounded_json_value(value: Any, maximum_bytes: int) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=True, default=str).encode("utf-8")
    except (TypeError, ValueError):
        encoded = str(value).encode("utf-8")
    if len(encoded) <= maximum_bytes:
        return value
    return {
        "truncated": True,
        "preview": bounded_utf8(encoded.decode("utf-8", errors="replace"), maximum_bytes - 64),
    }


def emit(event_type: str, payload: dict[str, Any] | None = None) -> None:
    print(
        json.dumps(
            {"type": event_type, "payload": payload or {}},
            ensure_ascii=True,
            default=str,
        ),
        flush=True,
    )


def graph_snapshot(wiki_dir: Path) -> dict[str, list[dict[str, Any]]]:
    from agent.wiki_graph import _build_name_registry, extract_cross_refs, match_reference, parse_index

    entries = parse_index(wiki_dir)[:MAX_GRAPH_NODES]
    for entry in entries:
        entry.title, entry.cross_refs = extract_cross_refs(wiki_dir / entry.rel_path)
    registry = _build_name_registry(entries)
    nodes = [
        {
            "id": entry.name,
            "label": bounded_utf8(entry.name, 256),
            "title": bounded_utf8(entry.title or entry.name, 256),
            "category": bounded_utf8(entry.category or "source", 128),
            "path": bounded_utf8(entry.rel_path, 512),
        }
        for entry in entries
    ]
    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    names = {entry.name for entry in entries}
    for entry in entries:
        for reference in entry.cross_refs:
            target = match_reference(reference, registry)
            if not target or target not in names or target == entry.name:
                continue
            key = tuple(sorted((entry.name, target)))
            if key in seen:
                continue
            seen.add(key)
            edges.append(
                {
                    "source": bounded_utf8(entry.name, 256),
                    "target": bounded_utf8(target, 256),
                    "label": bounded_utf8(reference, 256),
                }
            )
            if len(edges) >= MAX_GRAPH_EDGES:
                return {"nodes": nodes, "edges": edges}
    return {"nodes": nodes, "edges": edges}


def artifact_snapshot(workspace: Path, session_id: str) -> list[dict[str, Any]]:
    session_dir = workspace / ".openplanter" / "sessions" / session_id
    artifacts_dir = session_dir / "artifacts"
    rows: list[dict[str, Any]] = []
    if not artifacts_dir.is_dir():
        return rows
    canonical_session = session_dir.resolve(strict=True)
    candidates: list[Path] = []
    for candidate in artifacts_dir.rglob("*"):
        if candidate.is_symlink() or not candidate.is_file():
            continue
        try:
            canonical = candidate.resolve(strict=True)
            canonical.relative_to(canonical_session)
            if canonical.stat().st_size > MAX_ARTIFACT_BYTES:
                continue
        except (OSError, ValueError):
            continue
        candidates.append(canonical)
    for file_path in sorted(candidates)[:MAX_PUBLIC_ARTIFACTS]:
        relative = file_path.relative_to(canonical_session).as_posix()
        with file_path.open("rb") as source:
            preview = source.read(4804).decode("utf-8", errors="replace")[:1200]
        artifact_id = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:20]
        rows.append(
            {
                "id": artifact_id,
                "name": file_path.name,
                "path": relative,
                "kind": file_path.suffix.lstrip(".") or "text",
                "size": file_path.stat().st_size,
                "preview": preview,
            }
        )
    return rows


def _bounded_text(value: Any, maximum_bytes: int, *, empty: bool = False) -> bool:
    return (
        isinstance(value, str)
        and (empty or bool(value.strip()))
        and len(value.encode("utf-8")) <= maximum_bytes
        and "\x00" not in value
    )


def _direct_environment_directory(name: str) -> Path:
    raw = os.environ.get(name, "").strip()
    candidate = Path(raw)
    if not raw or not candidate.is_absolute() or candidate.is_symlink():
        raise ValueError(f"{name} is unavailable")
    resolved = candidate.resolve(strict=True)
    absolute = Path(os.path.abspath(candidate))
    if os.path.normcase(str(resolved)) != os.path.normcase(str(absolute)) or not resolved.is_dir():
        raise ValueError(f"{name} is indirect")
    return resolved


def read_invocation() -> SimpleNamespace:
    raw = sys.stdin.buffer.read(MAX_INVOCATION_BYTES + 1)
    if not raw or len(raw) > MAX_INVOCATION_BYTES or not raw.endswith(b"\n"):
        raise ValueError("OpenPlanter Runtime invocation is invalid")
    try:
        value = json.loads(raw[:-1])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("OpenPlanter Runtime invocation is invalid JSON") from exc
    if not isinstance(value, dict) or set(value) != INVOCATION_KEYS:
        raise ValueError("OpenPlanter Runtime invocation shape is invalid")
    parsed_url = urlsplit(value.get("baseUrl", ""))
    if (
        value.get("protocolVersion") != 1
        or not _bounded_text(value.get("task"), 768 * 1024)
        or not _bounded_text(value.get("model"), 256)
        or "\n" in value["model"]
        or value.get("reasoningEffort") not in {"none", "low", "medium", "high", "xhigh"}
        or not _bounded_text(value.get("baseUrl"), 2048)
        or parsed_url.scheme not in {"http", "https"}
        or not parsed_url.hostname
        or parsed_url.username is not None
        or parsed_url.password is not None
        or bool(parsed_url.query)
        or bool(parsed_url.fragment)
        or not _bounded_text(value.get("apiKey"), 4096)
        or "\n" in value["apiKey"]
        or type(value.get("maxSteps")) is not int
        or value["maxSteps"] != 40
        or type(value.get("maxSeconds")) is not int
        or value["maxSeconds"] != 900
    ):
        raise ValueError("OpenPlanter Runtime invocation values are invalid")
    return SimpleNamespace(
        task=value["task"],
        model=value["model"],
        base_url=value["baseUrl"],
        api_key=value["apiKey"],
        reasoning_effort=value["reasoningEffort"],
        max_steps=value["maxSteps"],
        max_seconds=value["maxSeconds"],
    )


def main() -> int:
    if len(sys.argv) != 1:
        raise ValueError("OpenPlanter Runtime bridge accepts no command-line arguments")
    args = read_invocation()
    openplanter_root = _direct_environment_directory("OPENPLANTER_ROOT")
    workspace = _direct_environment_directory("OPENPLANTER_RUNTIME_WORKSPACE")
    if not (openplanter_root / "agent" / "runtime.py").is_file():
        raise ValueError("The sealed OpenPlanter source is incomplete")
    baseline_wiki = openplanter_root / "wiki"
    workspace_wiki = workspace / "wiki"
    if baseline_wiki.is_dir() and not workspace_wiki.exists():
        shutil.copytree(baseline_wiki, workspace_wiki)

    sys.path.insert(0, str(openplanter_root))
    from agent.builder import build_engine
    from agent.config import AgentConfig
    from agent.runtime import SessionRuntime

    config = AgentConfig.from_env(workspace)
    config.provider = "openai"
    config.model = args.model
    config.reasoning_effort = args.reasoning_effort or None
    config.base_url = args.base_url.rstrip("/")
    config.openai_base_url = config.base_url
    config.api_key = args.api_key
    config.openai_api_key = args.api_key
    config.max_steps_per_call = max(1, min(args.max_steps, 100))
    config.max_solve_seconds = max(30, min(args.max_seconds, 3600))
    config.command_timeout_sec = min(config.command_timeout_sec, 45)
    if sys.platform == "win32":
        config.shell = "powershell.exe"

    engine = build_engine(config)
    runtime = SessionRuntime.bootstrap(engine, config)
    started_at = time.monotonic()
    emit(
        "run.started",
        {
            "task": bounded_utf8(args.task, 128 * 1024),
            "model": args.model,
            "sessionId": runtime.session_id,
        },
    )
    emit("graph.updated", graph_snapshot(workspace / ".openplanter" / "wiki"))

    totals = {"steps": 0, "inputTokens": 0, "outputTokens": 0, "maxDepth": 0}

    def on_trace(message: str) -> None:
        emit("trace", {"message": bounded_utf8(message, MAX_EVENT_TEXT_BYTES)})

    def on_step(step: dict[str, Any]) -> None:
        totals["steps"] += 1
        totals["inputTokens"] += int(step.get("input_tokens") or 0)
        totals["outputTokens"] += int(step.get("output_tokens") or 0)
        totals["maxDepth"] = max(totals["maxDepth"], int(step.get("depth") or 0))
        action = step.get("action") if isinstance(step.get("action"), dict) else {}
        emit(
            "step.completed",
            {
                "depth": step.get("depth", 0),
                "step": step.get("step", totals["steps"]),
                "objective": bounded_utf8(step.get("objective", ""), MAX_EVENT_TEXT_BYTES),
                "action": {
                    "name": bounded_utf8(action.get("name", "model"), 512),
                    "arguments": bounded_json_value(
                        action.get("arguments", {}), MAX_EVENT_TEXT_BYTES
                    ),
                },
                "observation": bounded_utf8(
                    step.get("observation") or step.get("model_text") or "",
                    MAX_EVENT_TEXT_BYTES,
                ),
                "elapsedSec": step.get("elapsed_sec", 0),
                "isFinal": bool(step.get("is_final")),
                **totals,
            },
        )

    result = runtime.solve(args.task, on_event=on_trace, on_step=on_step)
    runtime.store.write_artifact(runtime.session_id, "outputs", "result.md", result)
    artifacts = artifact_snapshot(workspace, runtime.session_id)
    emit("artifacts.updated", {"sessionId": runtime.session_id, "artifacts": artifacts})
    emit("graph.updated", graph_snapshot(workspace / ".openplanter" / "wiki"))
    emit(
        "run.completed",
        {
            "summary": bounded_utf8(result, MAX_RESULT_SUMMARY_BYTES),
            "sessionId": runtime.session_id,
            "elapsedSec": round(time.monotonic() - started_at, 3),
            "artifacts": artifacts,
            **totals,
        },
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        emit(
            "run.failed",
            {
                "error": str(exc) or exc.__class__.__name__,
                "detail": traceback.format_exc(limit=8),
            },
        )
        raise SystemExit(1)
