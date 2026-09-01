from __future__ import annotations

import argparse
import os
from pathlib import Path

from .assets import AssetStore
from .pipeline import DetectPipeline
from .resources import detect_resources
from .server import serve
from .worker import DetectionWorker


def main() -> None:
    parser = argparse.ArgumentParser(prog="breadboard-detect-ai")
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("serve")
    command.add_argument("--host", default="127.0.0.1")
    command.add_argument("--port", type=int, default=int(os.environ.get("BREADBOARD_DETECT_AI_PORT", "7742")))
    args = parser.parse_args()

    secret = os.environ.get("BREADBOARD_DETECT_AI_SECRET", "")
    home = Path(
        os.environ.get("BREADBOARD_DETECT_AI_HOME", "~/.breadboard/detect-ai")
    ).expanduser()
    device = os.environ.get("BREADBOARD_DETECT_AI_DEVICE", "auto")
    idle_timeout = int(os.environ.get("BREADBOARD_DETECT_AI_WORKER_IDLE_SECONDS", "600"))
    resources = detect_resources(device)
    assets = AssetStore(home / "models")
    pipeline = DetectPipeline(assets, resources, idle_timeout)
    worker = DetectionWorker(pipeline, idle_timeout_seconds=idle_timeout)
    serve(args.host, args.port, secret, worker)


if __name__ == "__main__":
    main()
