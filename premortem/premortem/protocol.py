from __future__ import annotations

import shlex
from typing import Any, Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"


class Action(BaseModel):
    kind: Literal["command"] = "command"
    label: str
    command: list[str]
    mutates_state: bool = False
    requires_network: bool = False
    requires_user_approval: bool = False


class SuccessEnvelope(BaseModel):
    schema_version: str = SCHEMA_VERSION
    ok: Literal[True] = True
    command: list[str]
    data: Any
    warnings: list[str] = Field(default_factory=list)
    next_actions: list[Action] = Field(default_factory=list)


class ErrorDetails(BaseModel):
    context: str | None = None
    hint: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: ErrorDetails


class ErrorEnvelope(BaseModel):
    schema_version: str = SCHEMA_VERSION
    ok: Literal[False] = False
    command: list[str]
    error: ErrorBody
    warnings: list[str] = Field(default_factory=list)
    next_actions: list[Action] = Field(default_factory=list)


def command_action(command: str) -> Action:
    argv = shlex.split(command)
    prefix = tuple(argv[:3])
    runs_model = tuple(argv[:2]) == ("ep", "run")
    network = runs_model or tuple(argv[:3]) == ("ep", "auth", "login") or tuple(argv[:2]) == ("ep", "check")
    mutating_prefixes = {
        ("premortem", "init"),
        ("premortem", "project", "update"),
        ("premortem", "persona", "add"),
        ("premortem", "persona", "edit"),
        ("premortem", "persona", "rename"),
        ("premortem", "persona", "delete"),
        ("premortem", "reason", "add"),
        ("premortem", "reason", "edit"),
        ("premortem", "reason", "delete"),
        ("premortem", "graph", "add-node"),
        ("premortem", "graph", "add-edge"),
        ("premortem", "graph", "remove-node"),
        ("premortem", "graph", "remove-edge"),
        ("premortem", "score", "set"),
        ("premortem", "mitigate", "add"),
        ("premortem", "mitigate", "edit"),
        ("premortem", "mitigate", "delete"),
        ("premortem", "ingest"),
        ("premortem", "job", "generate"),
        ("premortem", "report", "context"),
        ("premortem", "report", "generate"),
        ("premortem", "report", "html"),
    }
    mutates = runs_model or any(prefix[: len(candidate)] == candidate for candidate in mutating_prefixes)
    destructive = any(token in {"delete", "remove-node", "remove-edge", "--replace", "--force"} for token in argv)
    return Action(
        label=f"Run `{command}`",
        command=argv,
        mutates_state=mutates,
        requires_network=network,
        requires_user_approval=runs_model or destructive,
    )
