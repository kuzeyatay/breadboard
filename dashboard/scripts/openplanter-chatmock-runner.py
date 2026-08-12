#!/usr/bin/env python3
"""Run OpenPlanter against ChatMock and expose its UI state as NDJSON events."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
import traceback
from pathlib import Path
from typing import Any


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

    entries = parse_index(wiki_dir)
    for entry in entries:
        entry.title, entry.cross_refs = extract_cross_refs(wiki_dir / entry.rel_path)
    registry = _build_name_registry(entries)
    nodes = [
        {
            "id": entry.name,
            "label": entry.name,
            "title": entry.title or entry.name,
            "category": entry.category or "source",
            "path": entry.rel_path,
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
            edges.append({"source": entry.name, "target": target, "label": reference})
    return {"nodes": nodes, "edges": edges}


def artifact_snapshot(workspace: Path, session_id: str) -> list[dict[str, Any]]:
    session_dir = workspace / ".openplanter" / "sessions" / session_id
    artifacts_dir = session_dir / "artifacts"
    rows: list[dict[str, Any]] = []
    if not artifacts_dir.is_dir():
        return rows
    for file_path in sorted(path for path in artifacts_dir.rglob("*") if path.is_file()):
        relative = file_path.relative_to(session_dir).as_posix()
        content = file_path.read_text(encoding="utf-8", errors="replace")
        artifact_id = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:20]
        rows.append(
            {
                "id": artifact_id,
                "name": file_path.name,
                "path": relative,
                "kind": file_path.suffix.lstrip(".") or "text",
                "size": file_path.stat().st_size,
                "preview": content[:1200],
            }
        )
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--openplanter-root", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--max-steps", type=int, default=40)
    parser.add_argument("--max-seconds", type=int, default=900)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    openplanter_root = Path(args.openplanter_root).expanduser().resolve()
    workspace = Path(args.workspace).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
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
            "task": args.task,
            "model": args.model,
            "sessionId": runtime.session_id,
        },
    )
    emit("graph.updated", graph_snapshot(workspace / ".openplanter" / "wiki"))

    totals = {"steps": 0, "inputTokens": 0, "outputTokens": 0, "maxDepth": 0}

    def on_trace(message: str) -> None:
        emit("trace", {"message": message})

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
                "objective": step.get("objective", ""),
                "action": {
                    "name": action.get("name", "model"),
                    "arguments": action.get("arguments", {}),
                },
                "observation": str(step.get("observation") or step.get("model_text") or "")[:8000],
                "elapsedSec": step.get("elapsed_sec", 0),
                "isFinal": bool(step.get("is_final")),
                **totals,
            },
        )

    result = runtime.solve(args.task, on_event=on_trace, on_step=on_step)
    runtime.store.write_artifact(runtime.session_id, "outputs", "result.md", result)
    artifacts = artifact_snapshot(workspace, runtime.session_id)
    emit("artifacts.updated", {"artifacts": artifacts})
    emit("graph.updated", graph_snapshot(workspace / ".openplanter" / "wiki"))
    emit(
        "run.completed",
        {
            "summary": result,
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
