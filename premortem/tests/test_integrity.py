from __future__ import annotations

from datetime import datetime, timezone

import pytest

from premortem.models import Edge, Mitigation, Node, Persona, ProjectMeta, Reason, Score
from premortem.store import PremortemError, ProjectStore
from premortem.validation import validate_store


NOW = datetime(2026, 7, 24, tzinfo=timezone.utc)


def make_store(tmp_path) -> ProjectStore:
    store = ProjectStore(tmp_path / ".premortem")
    store.init_project(
        ProjectMeta(
            id="pm_integrity",
            initiative="Test initiative",
            description="Exercise cross-entity integrity.",
            failure_statement="The initiative failed.",
            created_at=NOW,
            updated_at=NOW,
        )
    )
    store.save_persona(Persona(id="p001", name="Avery", role="Owner", created_at=NOW))
    store.save_reason(
        Reason(
            id="r001",
            persona_id="p001",
            kind="episodic",
            text="A concrete failure.",
            created_at=NOW,
        )
    )
    store.save_node(Node(id="n001", label="Cause", reason_ids=["r001"], created_at=NOW))
    store.save_node(Node(id="n002", label="Effect", created_at=NOW))
    store.save_edge(Edge(id="e001", source="n001", target="n002", created_at=NOW))
    store.save_score(Score(node_id="n001", likelihood="high", impact="high", created_at=NOW))
    store.save_mitigation(
        Mitigation(id="m001", text="Reduce the cause.", node_ids=["n001", "n002"], created_at=NOW)
    )
    return store


def test_referenced_entities_cannot_be_deleted(tmp_path) -> None:
    store = make_store(tmp_path)

    with pytest.raises(PremortemError, match="still referenced") as persona_error:
        store.delete_persona("p001")
    assert persona_error.value.code == "CONFLICT"

    with pytest.raises(PremortemError, match="still cited") as reason_error:
        store.delete_reason("r001")
    assert reason_error.value.code == "CONFLICT"


def test_deleting_node_cascades_derived_references(tmp_path) -> None:
    store = make_store(tmp_path)

    store.delete_node("n001")

    assert store.list_edges() == []
    assert store.list_scores() == []
    assert store.get_mitigation("m001").node_ids == ["n002"]
    assert not [issue for issue in validate_store(store) if issue.severity == "error"]


def test_validation_reports_corrupt_cross_references(tmp_path) -> None:
    store = make_store(tmp_path)
    store.reason_path("r001").unlink()

    issues = validate_store(store)

    assert "dangling_node_reasons" in {issue.code for issue in issues}


def test_validation_reports_causal_cycles(tmp_path) -> None:
    store = make_store(tmp_path)
    store.save_edge(Edge(id="e002", source="n002", target="n001", created_at=NOW))

    issues = validate_store(store)

    assert "causal_cycle" in {issue.code for issue in issues}
