from __future__ import annotations

import json
import os
import shlex
import shutil
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, TypeVar

from pydantic import BaseModel, ValidationError

from .models import (
    Edge,
    Mitigation,
    Node,
    Persona,
    ProjectMeta,
    Reason,
    Score,
)
from .protocol import ErrorBody, ErrorDetails, ErrorEnvelope, SuccessEnvelope, command_action

T = TypeVar("T", bound=BaseModel)


class PremortemError(Exception):
    def __init__(self, code: str, message: str, context: str | None = None, hint: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.context = context
        self.hint = hint


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def default_project_dir() -> Path:
    from os import getenv

    explicit = getenv("PREMORTEM_PROJECT_DIR")
    if explicit:
        return Path(explicit)
    return Path("./.premortem")


def make_json_envelope(command: str, data: Any, warnings: list[str] | None = None, next_steps: list[str] | None = None) -> dict[str, Any]:
    return SuccessEnvelope(
        command=shlex.split(command),
        data=data,
        warnings=warnings or [],
        next_actions=[command_action(step) for step in (next_steps or [])],
    ).model_dump(mode="json")


def error_envelope(command: str, err: PremortemError) -> dict[str, Any]:
    return ErrorEnvelope(
        command=shlex.split(command),
        error=ErrorBody(
            code=err.code,
            message=err.message,
            details=ErrorDetails(context=err.context, hint=err.hint),
        ),
    ).model_dump(mode="json", exclude_none=True)


class ProjectStore:
    def __init__(self, root: Path):
        self.root = root

    @property
    def meta_path(self) -> Path:
        return self.root / "meta.json"

    def require_project(self) -> None:
        if not self.meta_path.exists():
            raise PremortemError("ID_NOT_FOUND", "Project does not exist.", context=str(self.root), hint="Run `premortem init` first.")

    def init_project(self, meta: ProjectMeta, force: bool = False) -> None:
        if self.root.exists():
            if any(self.root.iterdir()) and not force:
                raise PremortemError("ALREADY_EXISTS", "Project directory already exists.", context=str(self.root), hint="Pass `--force` to re-initialize.")
            if force:
                shutil.rmtree(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        for path in [
            "personas",
            "reasons",
            "graph/nodes",
            "graph/edges",
            "scores",
            "mitigations",
            "output",
        ]:
            (self.root / path).mkdir(parents=True, exist_ok=True)
        self.write_model(self.meta_path, meta)

    @contextmanager
    def locked(self):
        self.root.mkdir(parents=True, exist_ok=True)
        lock_path = self.root / ".premortem.lock"
        with lock_path.open("w") as handle:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    # ── generic I/O ──────────────────────────────────────────────

    def read_model(self, path: Path, model_type: type[T]) -> T:
        try:
            data = json.loads(path.read_text())
            return model_type.model_validate(data)
        except FileNotFoundError as exc:
            raise PremortemError("ID_NOT_FOUND", "File not found.", context=str(path)) from exc
        except ValidationError as exc:
            raise PremortemError("VALIDATION_FAILED", "JSON validation failed.", context=f"{path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise PremortemError("VALIDATION_FAILED", "Invalid JSON.", context=f"{path}: {exc}") from exc

    def write_model(self, path: Path, model: BaseModel) -> None:
        self.write_json(path, model.model_dump(mode="json"))

    def write_json(self, path: Path, data: Any) -> None:
        serialized = json.dumps(data, indent=2) + "\n"
        self.write_text(path, serialized)

    def write_text(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except BaseException:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise

    def read_meta(self) -> ProjectMeta:
        self.require_project()
        return self.read_model(self.meta_path, ProjectMeta)

    def write_meta(self, meta: ProjectMeta) -> None:
        meta.updated_at = now_utc()
        self.write_model(self.meta_path, meta)

    def next_id(self, prefix: str, existing_ids: Iterable[str]) -> str:
        numeric = [int(item[len(prefix):]) for item in existing_ids if item.startswith(prefix)]
        return f"{prefix}{(max(numeric) + 1 if numeric else 1):03d}"

    # ── personas ─────────────────────────────────────────────────

    def persona_path(self, persona_id: str) -> Path:
        return self.root / "personas" / f"{persona_id}.json"

    def list_personas(self) -> list[Persona]:
        return [self.read_model(p, Persona) for p in sorted((self.root / "personas").glob("*.json"))]

    def get_persona(self, persona_id: str) -> Persona:
        path = self.persona_path(persona_id)
        return self.read_model(path, Persona)

    def save_persona(self, persona: Persona) -> None:
        self.write_model(self.persona_path(persona.id), persona)

    def delete_persona(self, persona_id: str) -> None:
        path = self.persona_path(persona_id)
        if not path.exists():
            raise PremortemError("ID_NOT_FOUND", "Persona not found.", context=persona_id)
        references = [reason.id for reason in self.list_reasons() if reason.persona_id == persona_id]
        if references:
            raise PremortemError(
                "CONFLICT",
                "Persona is still referenced by failure reasons.",
                context=f"{persona_id}: {', '.join(references)}",
                hint="Delete or reassign the referenced reasons first.",
            )
        path.unlink()

    # ── reasons ──────────────────────────────────────────────────

    def reason_path(self, reason_id: str) -> Path:
        return self.root / "reasons" / f"{reason_id}.json"

    def list_reasons(self) -> list[Reason]:
        return [self.read_model(p, Reason) for p in sorted((self.root / "reasons").glob("*.json"))]

    def get_reason(self, reason_id: str) -> Reason:
        return self.read_model(self.reason_path(reason_id), Reason)

    def save_reason(self, reason: Reason) -> None:
        self.write_model(self.reason_path(reason.id), reason)

    def delete_reason(self, reason_id: str) -> None:
        path = self.reason_path(reason_id)
        if not path.exists():
            raise PremortemError("ID_NOT_FOUND", "Reason not found.", context=reason_id)
        references = [node.id for node in self.list_nodes() if reason_id in node.reason_ids]
        if references:
            raise PremortemError(
                "CONFLICT",
                "Reason is still cited by causal-graph nodes.",
                context=f"{reason_id}: {', '.join(references)}",
                hint="Remove the reason citation from those nodes first.",
            )
        path.unlink()

    # ── graph: nodes ─────────────────────────────────────────────

    def node_path(self, node_id: str) -> Path:
        return self.root / "graph" / "nodes" / f"{node_id}.json"

    def list_nodes(self) -> list[Node]:
        return [self.read_model(p, Node) for p in sorted((self.root / "graph" / "nodes").glob("*.json"))]

    def get_node(self, node_id: str) -> Node:
        return self.read_model(self.node_path(node_id), Node)

    def save_node(self, node: Node) -> None:
        self.write_model(self.node_path(node.id), node)

    def delete_node(self, node_id: str) -> None:
        path = self.node_path(node_id)
        if not path.exists():
            raise PremortemError("ID_NOT_FOUND", "Node not found.", context=node_id)
        path.unlink()
        # also remove edges referencing this node
        for edge in self.list_edges():
            if edge.source == node_id or edge.target == node_id:
                self.delete_edge(edge.id)
        self.score_path(node_id).unlink(missing_ok=True)
        for mitigation in self.list_mitigations():
            if node_id not in mitigation.node_ids:
                continue
            mitigation.node_ids = [item for item in mitigation.node_ids if item != node_id]
            self.save_mitigation(mitigation)

    # ── graph: edges ─────────────────────────────────────────────

    def edge_path(self, edge_id: str) -> Path:
        return self.root / "graph" / "edges" / f"{edge_id}.json"

    def list_edges(self) -> list[Edge]:
        return [self.read_model(p, Edge) for p in sorted((self.root / "graph" / "edges").glob("*.json"))]

    def get_edge(self, edge_id: str) -> Edge:
        return self.read_model(self.edge_path(edge_id), Edge)

    def save_edge(self, edge: Edge) -> None:
        self.write_model(self.edge_path(edge.id), edge)

    def delete_edge(self, edge_id: str) -> None:
        path = self.edge_path(edge_id)
        if not path.exists():
            raise PremortemError("ID_NOT_FOUND", "Edge not found.", context=edge_id)
        path.unlink()

    # ── scores ───────────────────────────────────────────────────

    def score_path(self, node_id: str) -> Path:
        return self.root / "scores" / f"{node_id}.json"

    def list_scores(self) -> list[Score]:
        return [self.read_model(p, Score) for p in sorted((self.root / "scores").glob("*.json"))]

    def get_score(self, node_id: str) -> Score:
        return self.read_model(self.score_path(node_id), Score)

    def save_score(self, score: Score) -> None:
        self.write_model(self.score_path(score.node_id), score)

    # ── mitigations ──────────────────────────────────────────────

    def mitigation_path(self, mitigation_id: str) -> Path:
        return self.root / "mitigations" / f"{mitigation_id}.json"

    def list_mitigations(self) -> list[Mitigation]:
        return [self.read_model(p, Mitigation) for p in sorted((self.root / "mitigations").glob("*.json"))]

    def get_mitigation(self, mitigation_id: str) -> Mitigation:
        return self.read_model(self.mitigation_path(mitigation_id), Mitigation)

    def save_mitigation(self, mitigation: Mitigation) -> None:
        self.write_model(self.mitigation_path(mitigation.id), mitigation)

    def delete_mitigation(self, mitigation_id: str) -> None:
        path = self.mitigation_path(mitigation_id)
        if not path.exists():
            raise PremortemError("ID_NOT_FOUND", "Mitigation not found.", context=mitigation_id)
        path.unlink()
