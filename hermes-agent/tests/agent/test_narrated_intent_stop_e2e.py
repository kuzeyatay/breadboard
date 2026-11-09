"""End-to-end: a narrated-intent stop is nudged into a real answer.

Regression for the Breadboard garden turn of 2026-11-09 where the model answered
"I'll review the material and organize a study sequence…" with no tool calls and
``finish_reason=stop``; the loop accepted that as the final answer and the chat
rendered an unfinished response as complete. Exercised through
``AIAgent.run_conversation`` against an in-process OpenAI-compatible stub.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

ANNOUNCEMENT = (
    "I’ll review the available Neuro Comp material and organize a study "
    "sequence, starting with neural computation before moving into circuit "
    "implementation."
)
OUTLINE = (
    "Neuro Comp outline:\n\n"
    "1. Neurons, spikes and rate coding\n"
    "2. Synaptic integration and plasticity\n"
    "3. Population codes and decoding\n"
    "4. Circuit implementation"
)


class _StubHandler(BaseHTTPRequestHandler):
    captured_requests: list = []
    response_queue: list = []

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(length).decode())
        type(self).captured_requests.append(req)
        text = type(self).response_queue.pop(0) if type(self).response_queue else "DONE"
        if req.get("stream") is True:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for chunk in (
                {"id": "m", "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]},
                {"id": "m", "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}]},
                {"id": "m", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            ):
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return
        body = json.dumps({
            "id": "m",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a, **kw):
        pass


@pytest.fixture()
def agent_env(monkeypatch):
    monkeypatch.delenv("HERMES_INTENT_STOP_NUDGE", raising=False)
    monkeypatch.delenv("HERMES_INTENT_STOP_MAX_NUDGES", raising=False)
    _StubHandler.captured_requests = []
    _StubHandler.response_queue = []
    srv = HTTPServer(("127.0.0.1", 0), _StubHandler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    test_home = tempfile.mkdtemp(prefix="hermes_intent_e2e_")
    os.makedirs(os.path.join(test_home, ".hermes"))
    monkeypatch.setenv("HERMES_HOME", os.path.join(test_home, ".hermes"))
    for mod in list(sys.modules):
        if mod == "run_agent" or mod.startswith("agent.") or mod.startswith("tools.") or mod.startswith("hermes_"):
            del sys.modules[mod]
    from run_agent import AIAgent

    agent = AIAgent(
        api_key="test-key", base_url=f"http://127.0.0.1:{port}/v1",
        provider="openai-compat", model="test-model",
        max_iterations=10, enabled_toolsets=[],
        quiet_mode=True, skip_context_files=True, skip_memory=True,
        save_trajectories=False, platform="cli",
    )
    interims: list[tuple[str, bool]] = []
    agent.interim_assistant_callback = lambda text, already_streamed=False: interims.append((text, already_streamed))
    try:
        yield agent, _StubHandler, interims
    finally:
        srv.shutdown()
        shutil.rmtree(test_home, ignore_errors=True)


def _chat_requests(handler) -> list[dict]:
    """Only completion calls; the model probe posts a bare ``{"name": ...}``."""
    return [req for req in handler.captured_requests if isinstance(req.get("messages"), list)]


def test_announcement_is_nudged_into_the_real_answer(agent_env):
    agent, handler, interims = agent_env
    handler.response_queue.extend([ANNOUNCEMENT, OUTLINE])

    result = agent.run_conversation("Create an outline for the Neuro Comp garden.", conversation_history=[], task_id="t")

    assert result.get("completed", False)
    assert result.get("final_response") == OUTLINE
    # Two model calls: the announcement, then the nudged real answer.
    assert len(_chat_requests(handler)) == 2
    nudge = _chat_requests(handler)[1]["messages"][-1]
    assert nudge["role"] == "user" and "carry out the work" in nudge["content"]
    # The announcement reached the UI as interim narration, not as the answer.
    assert [text for text, _ in interims] == [ANNOUNCEMENT]
    # The synthetic nudge never becomes durable transcript context.
    assert not any(m.get("_narrated_intent_synthetic") for m in result["messages"] if isinstance(m, dict))
    assert all("carry out the work" not in (m.get("content") or "") for m in result["messages"]
               if isinstance(m, dict) and m.get("role") == "user")


def test_real_answer_is_not_nudged(agent_env):
    agent, handler, interims = agent_env
    handler.response_queue.append(OUTLINE)

    result = agent.run_conversation("Create an outline for the Neuro Comp garden.", conversation_history=[], task_id="t")

    assert result.get("final_response") == OUTLINE
    assert len(_chat_requests(handler)) == 1
    assert interims == []


def test_persistent_announcer_falls_back_after_the_budget(agent_env):
    agent, handler, interims = agent_env
    handler.response_queue.extend([ANNOUNCEMENT, "Let me start by reading the lecture notes now.", "Sure, I'll put the outline together now."])

    result = agent.run_conversation("Create an outline for the Neuro Comp garden.", conversation_history=[], task_id="t")

    # Two nudges, then the loop stops asking and keeps the last reply.
    assert len(_chat_requests(handler)) == 3
    assert result.get("final_response") == "Sure, I'll put the outline together now."
    assert len(interims) == 2
