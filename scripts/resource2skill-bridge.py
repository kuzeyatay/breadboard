#!/usr/bin/env python3
"""Breadboard adapter for the cloned Resource2Skill runtime.

The upstream project is kept pristine.  This adapter points its model calls at
ChatMock, gives every run a private output directory, and emits a small JSONL
protocol that the dashboard can stream.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any


def emit(event: str, **payload: Any) -> None:
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Resource2Skill for Breadboard")
    parser.add_argument("--root", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--domain", choices=("web", "ppt", "excel", "blender", "reaper"), required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--model", default="default")
    parser.add_argument("--reasoning", default="medium")
    parser.add_argument("--max-iter", type=int, default=60)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


def openai_compatible_call(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    model: str = "default",
    reasoning_effort: str = "medium",
    max_completion_tokens: int = 4096,
    timeout: int = 120,
    max_retries: int = 5,
    retry_delay: float = 2.0,
    tool_choice: str | dict[str, Any] | None = None,
    **_: Any,
) -> dict[str, Any]:
    """Resource2Skill's LLM hook, implemented against ChatMock's OpenAI API."""
    import requests

    base_url = os.environ.get("CHATMOCK_BASE_URL", "http://127.0.0.1:8765/v1").rstrip("/")
    api_key = os.environ.get("CHATMOCK_API_KEY", "local")
    selected_model = os.environ.get("CHATMOCK_MODEL", "").strip() or model or "default"
    payload: dict[str, Any] = {
        "model": selected_model,
        "messages": messages,
        "max_completion_tokens": max_completion_tokens,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice or "auto"
        payload["parallel_tool_calls"] = False
    if reasoning_effort and reasoning_effort != "none":
        payload["reasoning_effort"] = reasoning_effort

    emit("model.call", model=selected_model, reasoning=reasoning_effort)
    last_error = ""
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=timeout,
            )
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]
            last_error = f"HTTP {response.status_code}: {response.text[:500]}"
            if response.status_code != 429 and response.status_code < 500:
                break
        except requests.RequestException as exc:
            last_error = str(exc)
        if attempt < max_retries:
            time.sleep(retry_delay)
    raise RuntimeError(f"ChatMock request failed: {last_error}")


def configure_output(config: dict[str, Any], domain: str, workspace: Path) -> dict[str, Any]:
    configured = dict(config)
    mcp = dict(configured.get("mcp") or {})
    mcp["command"] = sys.executable
    args = [str(value) for value in (mcp.get("args") or [])]
    if domain in {"web", "excel", "blender", "reaper"}:
        args.extend(["--demo-dir", str(workspace)])
    mcp["args"] = args
    configured["mcp"] = mcp
    return configured


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    workspace = Path(args.workspace).resolve()
    if not (root / "cli.py").is_file() or not (root / "core" / "agent_executor.py").is_file():
        emit("run.failed", error=f"Resource2Skill was not found at {root}")
        return 2
    if sys.version_info[:2] != (3, 11):
        emit("run.failed", error=f"Resource2Skill requires Python 3.11; found {sys.version.split()[0]}")
        return 2
    if args.check:
        sys.path.insert(0, str(root))
        import core  # noqa: F401
        import mcp  # noqa: F401
        import openpyxl  # noqa: F401
        import playwright  # noqa: F401
        import pptx  # noqa: F401

        emit("check.completed", python=sys.version.split()[0], root=str(root))
        return 0

    workspace.mkdir(parents=True, exist_ok=True)
    os.chdir(root)
    sys.path.insert(0, str(root))

    # Patch the shared function before AgentExecutor and domain hooks import it.
    from core import get_library_dir, load_domain
    from core import llm as r2s_llm

    r2s_llm.call_azure_openai = openai_compatible_call

    from core import executor as executor_module

    original_call_tool = executor_module._MCPWrapper.call_tool

    async def streaming_call_tool(self: Any, tool_name: str, arguments: dict[str, Any]) -> str:
        emit("tool.started", tool=tool_name)
        try:
            result = await original_call_tool(self, tool_name, arguments)
        except Exception as exc:
            emit("tool.completed", tool=tool_name, status="failed", summary=str(exc)[:800])
            raise
        emit("tool.completed", tool=tool_name, status="completed", summary=str(result)[:800])
        return result

    executor_module._MCPWrapper.call_tool = streaming_call_tool

    from core.agent_executor import run_agent

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s", stream=sys.stderr)
    config = configure_output(load_domain(args.domain), args.domain, workspace)
    task = args.task.strip()
    if args.domain == "ppt":
        output = workspace / "presentation.pptx"
        task = (
            f"{task}\n\nBreadboard output boundary: save the final presentation with "
            f"save_presentation to this exact path: {output}. Do not write deliverables elsewhere."
        )
    else:
        task = (
            f"{task}\n\nBreadboard output boundary: all final deliverables must be saved inside "
            f"{workspace}. Do not write deliverables elsewhere."
        )

    emit("run.started", domain=args.domain, model=args.model, workspace=str(workspace))
    try:
        result = run_agent(
            task,
            config,
            get_library_dir(args.domain),
            model=args.model,
            reasoning_effort=args.reasoning,
            max_iterations=max(1, min(args.max_iter, 120)),
            n_skills=8,
            top_k=60,
        )
    except Exception as exc:
        emit("run.failed", error=str(exc))
        return 2

    summary = (result.final_message or result.summary()).strip()
    receipt = {
        "success": bool(result.success),
        "domain": args.domain,
        "iterations": result.iterations,
        "toolCalls": len(result.tool_calls),
        "summary": summary,
        "error": result.error,
        "note": result.note,
    }
    (workspace / ".breadboard-result.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if result.success:
        emit("run.completed", **receipt)
        return 0
    emit("run.failed", error=result.error or result.note or summary, **receipt)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
