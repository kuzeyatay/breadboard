from __future__ import annotations

"""Dev-only CouncilRun inspector.

GET /debug/council-runs             — list recent runs (id, createdAt, mode, taskType, ...)
GET /debug/council-runs/<runId>     — full run JSON + event ledger

Gated by ENABLE_COUNCIL_DEBUG=true (403 otherwise). Request messages that can
contain hidden system prompts are redacted unless the caller passes
includePrompts=true AND ENABLE_COUNCIL_DEBUG_PROMPTS=true is set.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from .ledger import default_ledger_dir

council_debug_bp = Blueprint("council_debug", __name__)

_RUN_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_TRUE_VALUES = {"1", "true", "yes", "on"}


def _env_true(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in _TRUE_VALUES


def _debug_enabled() -> bool:
    return _env_true("ENABLE_COUNCIL_DEBUG")


def _prompts_enabled() -> bool:
    return _env_true("ENABLE_COUNCIL_DEBUG_PROMPTS")


def _ledger_dir() -> Path:
    configured = (os.environ.get("COUNCIL_LEDGER_DIR") or "").strip()
    return Path(configured) if configured else default_ledger_dir()


def _disabled_response():
    return (
        jsonify(
            {
                "error": {
                    "message": "Council debug endpoints are disabled. Set ENABLE_COUNCIL_DEBUG=true to enable them in development.",
                }
            }
        ),
        403,
    )


def _redact_messages(run: Dict[str, Any]) -> Dict[str, Any]:
    """Hide system/developer prompt content by default; user/assistant turns stay."""
    messages = run.get("messages")
    if isinstance(messages, list):
        redacted: List[Any] = []
        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") in ("system", "developer"):
                redacted.append(
                    {
                        "role": msg.get("role"),
                        "content": "[redacted — pass includePrompts=true with ENABLE_COUNCIL_DEBUG_PROMPTS=true]",
                    }
                )
            else:
                redacted.append(msg)
        run = dict(run)
        run["messages"] = redacted
    return run


@council_debug_bp.get("/debug/council-runs")
def list_council_runs():
    if not _debug_enabled():
        return _disabled_response()

    try:
        limit = int(request.args.get("limit", "50"))
    except Exception:
        limit = 50
    limit = max(1, min(limit, 200))

    base = _ledger_dir()
    runs: List[Dict[str, Any]] = []
    try:
        files = sorted(
            (p for p in base.glob("*.json") if not p.name.endswith(".events.json")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )[:limit]
    except Exception:
        files = []
    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        runs.append(
            {
                "id": data.get("id") or path.stem,
                "createdAt": data.get("createdAt"),
                "councilMode": data.get("councilMode"),
                "taskType": data.get("taskType"),
                "gardenId": data.get("gardenId"),
                "pageId": data.get("pageId"),
            }
        )
    return jsonify({"runs": runs, "ledgerDir": str(base)})


@council_debug_bp.get("/debug/council-runs/<run_id>")
def get_council_run(run_id: str):
    if not _debug_enabled():
        return _disabled_response()
    if not _RUN_ID_RE.match(run_id or ""):
        return jsonify({"error": {"message": "Invalid run id"}}), 400

    base = _ledger_dir()
    run_path = base / f"{run_id}.json"
    if not run_path.exists():
        return jsonify({"error": {"message": f"Council run {run_id} not found"}}), 404

    try:
        run = json.loads(run_path.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": {"message": "Council run file could not be parsed"}}), 500

    include_prompts = (
        (request.args.get("includePrompts") or "").strip().lower() in _TRUE_VALUES
        and _prompts_enabled()
    )
    if isinstance(run, dict) and not include_prompts:
        run = _redact_messages(run)

    events: List[Dict[str, Any]] = []
    events_path = base / f"{run_id}.events.jsonl"
    if events_path.exists():
        try:
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    events.append(json.loads(line))
                except Exception:
                    continue
        except Exception:
            pass

    return jsonify({"run": run, "events": events})
