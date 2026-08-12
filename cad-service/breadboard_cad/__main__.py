"""CLI entry point: ``python -m breadboard_cad serve``."""

from __future__ import annotations

import argparse
import sys

from . import SERVICE_VERSION
from .server import serve


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="breadboard_cad", description="Breadboard CAD service")
    subcommands = parser.add_subparsers(dest="command", required=True)

    serve_command = subcommands.add_parser("serve", help="Run the loopback CAD service.")
    serve_command.add_argument("--host", default="127.0.0.1")
    serve_command.add_argument("--port", type=int, default=7731)
    serve_command.add_argument(
        "--workspace",
        default=None,
        help="Root for per-execution workspaces. Defaults to the system temp directory.",
    )
    serve_command.add_argument(
        "--secret",
        default=None,
        help="Shared secret. Prefer BREADBOARD_CAD_SECRET so it stays out of process listings.",
    )

    subcommands.add_parser("version", help="Print the service version.")

    arguments = parser.parse_args(argv[1:])
    if arguments.command == "version":
        sys.stdout.write(f"{SERVICE_VERSION}\n")
        return 0

    import os

    secret = (arguments.secret or os.environ.get("BREADBOARD_CAD_SECRET", "")).strip()
    serve(arguments.host, arguments.port, secret, arguments.workspace)
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main(sys.argv))
