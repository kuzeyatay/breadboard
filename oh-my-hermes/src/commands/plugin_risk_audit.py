from __future__ import annotations

import argparse
from pathlib import Path

from ..installer import OmhError
from ..workflows.plugin_risk_audit import audit_plugin_risk
from .common import _print_json


def cmd_ops_plugin_risk_audit(args: argparse.Namespace) -> int:
    try:
        payload = audit_plugin_risk(Path(args.path))
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def add_ops_plugin_risk_audit_command(ops_sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    audit = ops_sub.add_parser(
        "plugin-risk-audit",
        help="Statically audit one explicit local plugin directory without importing or registering it.",
    )
    audit.add_argument("--path", required=True, help="Explicit local plugin root directory to audit.")
    audit.set_defaults(func=cmd_ops_plugin_risk_audit)
