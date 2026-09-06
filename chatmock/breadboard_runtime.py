"""Breadboard's source-pinned ChatMock entry point (stdlib only)."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys


SOURCE_ENV = "BREADBOARD_CHATMOCK_SOURCE_ROOT"


def _is_competing_source(entry: str, selected: Path) -> bool:
    try:
        candidate = Path(entry).resolve()
    except (OSError, RuntimeError):
        return False
    return candidate != selected and (candidate / "chatmock" / "cli.py").is_file()


def select_source() -> Path:
    root = Path(__file__).resolve().parent
    sys.path[:] = [str(root)] + [
        entry for entry in sys.path if entry and not _is_competing_source(entry, root)
    ]
    os.environ[SOURCE_ENV] = str(root)
    inherited = os.environ.get("PYTHONPATH", "").split(os.pathsep)
    os.environ["PYTHONPATH"] = os.pathsep.join(
        [str(root)]
        + [entry for entry in inherited if entry and not _is_competing_source(entry, root)]
    )
    spec = importlib.util.find_spec("chatmock.cli")
    origin = Path(spec.origin).resolve() if spec and spec.origin else None
    if origin is None or not origin.is_relative_to(root):
        raise RuntimeError(
            f"ChatMock source mismatch: chatmock.cli resolved to {origin!r}, expected {root}"
        )
    return root


def main() -> None:
    root = select_source()
    if sys.argv[1:] == ["--check-source"]:
        print(root)
        return
    from chatmock.cli import main as chatmock_main

    chatmock_main()


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(f"[chatmock-source] {exc}", file=sys.stderr)
        raise SystemExit(1)
