"""CLI entry point: ``python -m breadboard_humanizer serve``."""

from __future__ import annotations

import argparse
import os
import sys

from . import (
    DEFAULT_IDLE_UNLOAD_SECONDS,
    DEFAULT_MAX_CHUNK_TOKENS,
    DEFAULT_MODEL_ID,
    DEFAULT_MODEL_REVISION,
    HARD_CEILING_TOKENS,
    SERVICE_VERSION,
)


def _configure_offline_telemetry() -> None:
    """Nothing here phones home.

    Set before transformers is imported anywhere. `setdefault` rather than
    assignment so a developer debugging a download can still override them from
    the shell for one launch.
    """
    for name, value in (
        ("HF_HUB_DISABLE_TELEMETRY", "1"),
        ("DISABLE_TELEMETRY", "1"),
        ("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1"),
        ("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1"),
        # Inference is a local operation. The loader also passes
        # local_files_only, so this is belt and braces rather than the only
        # thing standing between a rewrite and the network.
        ("HF_HUB_OFFLINE", "1"),
    ):
        os.environ.setdefault(name, value)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="breadboard_humanizer",
        description="Breadboard's local text-humanization service",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    serve_command = subcommands.add_parser("serve", help="Run the loopback humanizer service.")
    serve_command.add_argument("--host", default="127.0.0.1")
    serve_command.add_argument("--port", type=int, default=7735)
    serve_command.add_argument(
        "--model",
        default=None,
        help="Checkpoint to load. Defaults to " + DEFAULT_MODEL_ID + ".",
    )
    serve_command.add_argument(
        "--revision",
        default=None,
        help="Pinned model revision. Defaults to " + DEFAULT_MODEL_REVISION + ".",
    )
    serve_command.add_argument(
        "--device",
        default=None,
        choices=["auto", "cuda", "cpu"],
        help="auto picks CUDA when it is there. cuda fails loudly when it is not.",
    )
    serve_command.add_argument(
        "--secret",
        default=None,
        help="Shared secret. Prefer BREADBOARD_HUMANIZER_SECRET so it stays out of process listings.",
    )
    serve_command.add_argument(
        "--preload",
        action="store_true",
        help="Load an installed checkpoint before opening the service socket.",
    )

    subcommands.add_parser("version", help="Print the service version.")

    arguments = parser.parse_args(argv[1:])
    if arguments.command == "version":
        sys.stdout.write(SERVICE_VERSION + "\n")
        return 0

    _configure_offline_telemetry()

    # The host binding is not configurable beyond loopback on purpose. There is
    # no authentication story here beyond a per-launch bearer, and a service
    # holding a language model has no business on a network interface.
    host = "127.0.0.1" if arguments.host != "127.0.0.1" else arguments.host

    secret = (arguments.secret or os.environ.get("BREADBOARD_HUMANIZER_SECRET", "")).strip()
    model_id = arguments.model or os.environ.get("BREADBOARD_HUMANIZER_MODEL", "").strip() or DEFAULT_MODEL_ID
    revision = (
        arguments.revision
        or os.environ.get("BREADBOARD_HUMANIZER_REVISION", "").strip()
        or DEFAULT_MODEL_REVISION
    )
    device = arguments.device or os.environ.get("BREADBOARD_HUMANIZER_DEVICE", "").strip() or "auto"
    if device not in {"auto", "cuda", "cpu"}:
        sys.stderr.write("[humanizer] unknown device '" + device + "'; using auto\n")
        device = "auto"

    raw_idle = os.environ.get("BREADBOARD_HUMANIZER_IDLE_UNLOAD_SECONDS", "").strip()
    try:
        idle_seconds = float(raw_idle) if raw_idle else DEFAULT_IDLE_UNLOAD_SECONDS
    except ValueError:
        idle_seconds = DEFAULT_IDLE_UNLOAD_SECONDS

    raw_budget = os.environ.get("BREADBOARD_HUMANIZER_MAX_CHUNK_TOKENS", "").strip()
    try:
        max_chunk_tokens = int(raw_budget) if raw_budget else DEFAULT_MAX_CHUNK_TOKENS
    except ValueError:
        max_chunk_tokens = DEFAULT_MAX_CHUNK_TOKENS
    # Past the hard ceiling the model is outside the regime it was trained on,
    # whatever the environment says.
    max_chunk_tokens = max(32, min(HARD_CEILING_TOKENS, max_chunk_tokens))

    from .server import serve

    serve(
        host,
        arguments.port,
        secret,
        model_id,
        revision,
        device,
        idle_seconds,
        max_chunk_tokens,
        arguments.preload,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main(sys.argv))
