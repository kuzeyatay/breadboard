"""CLI entry point: ``python -m breadboard_colpali serve``."""

from __future__ import annotations

import argparse
import os
import sys

from . import DEFAULT_MODEL_ID, SERVICE_VERSION
from .server import serve


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="breadboard_colpali", description="Breadboard ColPali page-retrieval service"
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    serve_command = subcommands.add_parser("serve", help="Run the loopback ColPali service.")
    serve_command.add_argument("--host", default="127.0.0.1")
    serve_command.add_argument("--port", type=int, default=7733)
    serve_command.add_argument(
        "--index-root",
        default=None,
        help="Where page vectors are kept. Defaults to BREADBOARD_COLPALI_HOME/index.",
    )
    serve_command.add_argument(
        "--model",
        default=None,
        help=f"Checkpoint to load. Defaults to {DEFAULT_MODEL_ID}.",
    )
    serve_command.add_argument(
        "--secret",
        default=None,
        help="Shared secret. Prefer BREADBOARD_COLPALI_SECRET so it stays out of process listings.",
    )

    subcommands.add_parser("version", help="Print the service version.")

    arguments = parser.parse_args(argv[1:])
    if arguments.command == "version":
        sys.stdout.write(f"{SERVICE_VERSION}\n")
        return 0

    secret = (arguments.secret or os.environ.get("BREADBOARD_COLPALI_SECRET", "")).strip()
    home = os.environ.get("BREADBOARD_COLPALI_HOME", "").strip() or os.path.join(
        os.path.expanduser("~"), ".breadboard", "colpali"
    )
    index_root = arguments.index_root or os.path.join(home, "index")
    model_id = arguments.model or os.environ.get("BREADBOARD_COLPALI_MODEL", "").strip() or None

    serve(arguments.host, arguments.port, secret, index_root, model_id)
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main(sys.argv))
