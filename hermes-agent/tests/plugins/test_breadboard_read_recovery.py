"""Exercise read recovery over real loopback sockets, including partial bodies."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import plugins.breadboard as breadboard


@pytest.fixture
def broker(monkeypatch, tmp_path):
    requests = []
    outcomes = []
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers["content-length"]))
            requests.append((self.path, {key.lower(): value for key, value in self.headers.items()}, body))
            outcome = outcomes[len(requests) - 1]
            if outcome == "headers_timeout":
                release.wait(10)
                return
            if outcome == "disconnect":
                self.close_connection = True
                return
            if outcome == "slow_figure":
                release.wait(0.1)
            status = 401 if outcome == "unauthorized" else 200
            payload = (b'{"ok":false,"error":"Not authorized"}' if status == 401 else
                       b'{"ok":false,"error":"Garden not found"}' if outcome == "tool_error" else
                       b'not JSON' if outcome == "invalid_json" else
                       b'{"ok":true,"data":{"sources":["EC 2"],"chunks":[{"content":"Common emitter"}]}}')
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            if outcome in {"body_timeout", "partial"}:
                self.wfile.write(payload[:8])
                self.wfile.flush()
                if outcome == "body_timeout":
                    release.wait(10)
                self.close_connection = True
                return
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("BREADBOARD_INTERNAL_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("BREADBOARD_HERMES_TOOL_SECRET", "read-recovery-test-secret")
    monkeypatch.setattr(breadboard, "_DEFAULT_REQUEST_TIMEOUT_SECONDS", 2)
    monkeypatch.setattr(breadboard, "_GARDEN_READ_RETRY_TIMEOUT_SECONDS", 2)
    monkeypatch.setattr(breadboard, "_LESSON_REVIEW_REQUEST_TIMEOUT_SECONDS", 2)
    monkeypatch.setattr(breadboard, "_IMAGE_GENERATION_REQUEST_TIMEOUT_SECONDS", 2)
    monkeypatch.setattr(breadboard, "_GARDEN_FIGURE_REQUEST_TIMEOUT_SECONDS", 2)
    try:
        yield outcomes, requests
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def call(tool="garden_search", kind="garden"):
    return json.loads(breadboard._call_breadboard(
        {"gardenId": "ec-2", "query": "common emitter"},
        tool_name=tool, route=f"/api/hermes/tools/{kind}", route_kind=kind,
        task_id="read-session", tool_call_id="read-call",
    ))


@pytest.mark.parametrize("failure", ["headers_timeout", "body_timeout", "disconnect", "partial"])
def test_read_recovers_on_a_fresh_connection_without_changing_scope(broker, failure):
    outcomes, requests = broker
    outcomes.extend([failure, "ok"])
    result = call()
    assert result["sources"] == ["EC 2"]
    assert result["chunks"][0]["content"] == "Common emitter"
    assert len(requests) == 2
    assert requests[0] == requests[1]
    assert requests[0][1]["authorization"] == "Bearer read-recovery-test-secret"
    assert requests[0][1]["x-agent-session-id"] == "read-session"


def test_unavailable_read_stops_after_one_recovery_attempt(broker):
    outcomes, requests = broker
    outcomes.extend(["headers_timeout", "headers_timeout"])
    result = call()
    assert "timed out" in result["error"]
    assert "recovery" in result
    assert len(requests) == 2


@pytest.mark.parametrize("outcome", ["unauthorized", "tool_error", "invalid_json"])
def test_completed_failure_is_not_retried(broker, outcome):
    outcomes, requests = broker
    outcomes.append(outcome)
    assert "error" in call()
    assert len(requests) == 1


@pytest.mark.parametrize("tool,kind", [
    ("garden_save_note", "garden"),
    ("garden_create_folder", "garden"),
    ("garden_propose_page_revision", "garden"),
    ("artifact_image_generate", "artifacts"),
    ("unknown_tool", "garden"),
    ("garden_search", "other"),
])
def test_lost_write_or_unknown_response_is_never_replayed(broker, tool, kind):
    outcomes, requests = broker
    outcomes.append("disconnect")
    assert "error" in call(tool, kind)
    assert len(requests) == 1


def test_healthy_read_only_makes_one_request(broker):
    outcomes, requests = broker
    outcomes.append("ok")
    assert call()["sources"] == ["EC 2"]
    assert len(requests) == 1


def test_figure_search_can_finish_beyond_the_short_read_budget(broker, monkeypatch):
    outcomes, requests = broker
    outcomes.append("slow_figure")
    monkeypatch.setattr(breadboard, "_DEFAULT_REQUEST_TIMEOUT_SECONDS", 0.01)
    result = call("garden_get_source_figure")
    assert "error" not in result
    assert result["sources"] == ["EC 2"]
    assert len(requests) == 1


def test_figure_search_timeout_is_bounded_and_does_not_start_a_duplicate_scan(broker):
    outcomes, requests = broker
    outcomes.append("headers_timeout")
    result = call("garden_get_source_figure")
    assert "timed out" in result["error"]
    assert len(requests) == 1
