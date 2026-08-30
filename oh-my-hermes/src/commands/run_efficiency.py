from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..installer import OmhError
from ..runtime.run_efficiency import build_run_efficiency_report, parse_run_efficiency_input, write_run_efficiency_report
from .common import _paths, _print_json


def cmd_runtime_efficiency_report(args: argparse.Namespace) -> int:
    try:
        raw = json.loads(Path(args.input).expanduser().read_text(encoding="utf-8"))
        report = build_run_efficiency_report(parse_run_efficiency_input(raw))
        artifact = write_run_efficiency_report(_paths(args), report) if args.write else {"written": False}
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json({**report, "artifact": artifact})
    return 0


def add_runtime_efficiency_command(runtime_sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    efficiency = runtime_sub.add_parser(
        "efficiency-report",
        help="Build a local run-efficiency report from supplied context-budget metadata.",
    )
    efficiency.add_argument("--input", required=True, help="Path to a run_efficiency_input/v1 JSON file.")
    efficiency.add_argument("--write", action="store_true", help="Write the deterministic report under the OMH runtime store.")
    efficiency.set_defaults(func=cmd_runtime_efficiency_report)
