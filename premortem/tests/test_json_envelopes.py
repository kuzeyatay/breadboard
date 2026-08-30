from __future__ import annotations

import json
import sys

from typer.testing import CliRunner

from premortem.cli import app
from premortem.store import PremortemError, error_envelope, make_json_envelope


runner = CliRunner()


def test_success_envelope_contract(monkeypatch) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "docs", "list"])
    payload = make_json_envelope(
        "legacy command label",
        {"items": []},
        warnings=["example warning"],
        next_steps=["premortem status"],
    )

    assert payload["schema_version"] == "1.0"
    assert payload["ok"] is True
    assert payload["command"] == ["legacy", "command", "label"]
    assert payload["data"] == {"items": []}
    assert payload["warnings"] == ["example warning"]
    assert payload["next_actions"][0]["command"] == ["premortem", "status"]
    assert payload["next_actions"][0]["kind"] == "command"
    assert payload["next_actions"][0]["mutates_state"] is False
    assert "error" not in payload


def test_model_run_action_requires_network_and_approval() -> None:
    payload = make_json_envelope(
        "workflow next",
        {},
        next_steps=["ep run jobs/reasons.jobs.ep --output jobs/reasons-results.ep"],
    )

    action = payload["next_actions"][0]
    assert action["requires_network"] is True
    assert action["mutates_state"] is True
    assert action["requires_user_approval"] is True


def test_error_envelope_contract(monkeypatch) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "docs", "show", "missing"])
    payload = error_envelope(
        "legacy command label",
        PremortemError("ID_NOT_FOUND", "Missing.", context="missing", hint="List topics."),
    )

    assert payload["schema_version"] == "1.0"
    assert payload["ok"] is False
    assert payload["command"] == ["legacy", "command", "label"]
    assert payload["error"] == {
        "code": "ID_NOT_FOUND",
        "message": "Missing.",
        "details": {"context": "missing", "hint": "List topics."},
    }
    assert "data" not in payload


def test_docs_list_emits_one_success_envelope(monkeypatch) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "docs", "list"])
    result = runner.invoke(app, ["docs", "list"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["schema_version"] == "1.0"
    assert payload["command"] == ["docs", "list"]
    assert isinstance(payload["data"], list)


def test_domain_failure_emits_one_error_envelope(monkeypatch) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "docs", "show", "missing"])
    result = runner.invoke(app, ["docs", "show", "missing"])

    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ID_NOT_FOUND"
    assert payload["next_actions"] == []


def test_agent_start_guides_a_fresh_agent(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "agent-start", "--project-dir", str(tmp_path)])
    result = runner.invoke(app, ["agent-start", "--project-dir", str(tmp_path)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["data"]["state"]["phase"] == "intake"
    assert payload["data"]["agent_guide"]
    assert payload["data"]["state"]["required_user_inputs"] == ["initiative to analyze"]
    assert "Ask only: What planned initiative should we analyze?" in str(payload["data"]["state"])
    assert any(action["command"][:3] == ["premortem", "docs", "show"] for action in payload["next_actions"])


def test_workflow_next_surfaces_executable_actions(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "workflow", "next", "--project-dir", str(tmp_path)])
    result = runner.invoke(app, ["workflow", "next", "--project-dir", str(tmp_path)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["data"]["phase"] == "intake"
    assert payload["next_actions"]
    assert all(action["command"][0] in {"premortem", "ep"} for action in payload["next_actions"])


def test_agent_end_includes_packaged_wrapup_guide(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(sys, "argv", ["premortem", "agent-end", "--project-dir", str(tmp_path)])
    result = runner.invoke(app, ["agent-end", "--project-dir", str(tmp_path)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert "Required handoff" in payload["data"]["wrapup_guide"]
    assert "report-context.json" in payload["data"]["wrapup_guide"]
