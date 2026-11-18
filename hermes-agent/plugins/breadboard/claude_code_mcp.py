"""Breadboard's tools as a stdio MCP server, for a Claude Code run.

Claude Code owns its own loop, so it reaches Breadboard the way any MCP client
does. Every call goes through the same ``_call_breadboard`` broker Hermes uses,
under the launching chat's runtime session (``BREADBOARD_MCP_SESSION_ID``), so
the dashboard applies the same tool allowlist, garden scope and permission
decisions it applies to Hermes.

Run with: python -m plugins.breadboard.claude_code_mcp
Needs: BREADBOARD_MCP_SESSION_ID, BREADBOARD_HERMES_TOOL_SECRET,
       BREADBOARD_INTERNAL_URL (all set by the dashboard's run manager).
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Callable

logger = logging.getLogger(__name__)


class _Collector:
    """Stands in for the Hermes plugin context and keeps only the tools."""

    def __init__(self) -> None:
        self.tools: list[tuple[str, dict, Callable[..., str], Callable[[], bool] | None]] = []

    def register_tool(self, *, name: str, schema: dict, handler: Callable[..., str],
                      check_fn: Callable[[], bool] | None = None, **_: Any) -> None:
        self.tools.append((name, schema, handler, check_fn))


def breadboard_tools() -> list[tuple[str, dict, Callable[..., str]]]:
    """The Breadboard plugin's tools that are available on this machine."""
    from plugins import breadboard

    collector = _Collector()
    breadboard.register(collector)
    available = []
    for name, schema, handler, check_fn in collector.tools:
        try:
            if check_fn is not None and not check_fn():
                continue
        except Exception:  # an unavailable optional tool is just left out
            continue
        available.append((name, schema, handler))
    return available


def call_tool(handler: Callable[..., str], arguments: dict[str, Any], session_id: str) -> str:
    try:
        return handler({k: v for k, v in (arguments or {}).items() if v is not None}, task_id=session_id)
    except Exception as exc:
        logger.exception("Breadboard tool failed")
        return json.dumps({"error": str(exc)})


def main() -> int:
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    session_id = os.environ.get("BREADBOARD_MCP_SESSION_ID", "").strip()
    if not session_id:
        print("BREADBOARD_MCP_SESSION_ID is not set.", file=sys.stderr)
        return 2

    import anyio
    import mcp.types as types
    from mcp.server.lowlevel import Server
    from mcp.server.stdio import stdio_server

    tools = {name: (schema, handler) for name, schema, handler in breadboard_tools()}
    server = Server("breadboard")

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(name=name, description=schema.get("description") or name,
                       inputSchema=schema.get("parameters") or {"type": "object", "properties": {}})
            for name, (schema, _) in tools.items()
        ]

    @server.call_tool()
    async def handle(name: str, arguments: dict[str, Any]) -> list[types.TextContent]:
        entry = tools.get(name)
        if entry is None:
            text = json.dumps({"error": f"Unknown Breadboard tool {name}."})
        else:
            text = await anyio.to_thread.run_sync(call_tool, entry[1], arguments, session_id)
        return [types.TextContent(type="text", text=text)]

    async def run() -> None:
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())

    anyio.run(run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
