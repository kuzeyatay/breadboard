"""Small JSON CLI; stdin carries tool arguments without shell interpolation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .service import service_for
from .tools import CONTRACTS, dispatch


def main():
    parser = argparse.ArgumentParser(description="Breadboard Multisim Agent")
    parser.add_argument("--workspace", default=".breadboard/circuits")
    parser.add_argument("--backend", choices=["ngspice", "multisim"], default="ngspice")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    sub.add_parser("tools")
    call = sub.add_parser("call")
    call.add_argument("tool", choices=sorted(CONTRACTS))
    call.add_argument("--input", type=Path, help="JSON argument file (default: stdin)")
    sub.add_parser("serve", help="Native MCP stdio server")
    sub.add_parser(
        "upstream",
        help="Unmodified upstream 107-tool MCP compatibility server (NI-specific tools require licensed Multisim)",
    )
    args = parser.parse_args()
    try:
        if args.command == "serve":
            from .server import serve

            serve(args.workspace, args.backend)
            return
        if args.command == "upstream":
            from multisim_mcp.server import mcp

            mcp.run(transport="stdio")
            return
        if args.command == "tools":
            result = [contract for _, contract in CONTRACTS.values()]
        else:
            service = service_for(args.workspace, args.backend)
            if args.command == "doctor":
                result = service.runtime_status()
            else:
                raw = args.input.read_text(encoding="utf-8") if args.input else sys.stdin.read(2_000_001)
                if len(raw.encode("utf-8")) > 2_000_000:
                    raise ValueError("Arguments exceed 2 MB")
                result = dispatch(service, args.tool, json.loads(raw or "{}"))
        print(json.dumps(result, allow_nan=False))
    except (ValueError, OSError, RuntimeError, KeyError) as exc:
        print(json.dumps({"success": False, "error": str(exc), "error_type": type(exc).__name__}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
