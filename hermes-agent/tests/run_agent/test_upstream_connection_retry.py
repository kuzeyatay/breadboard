"""Exercise provider-error recovery through real HTTP and the OpenAI SDK."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
from openai import APIError


CONNECTION_ERROR = {
    "error": {
        "code": "upstream_incomplete",
        "message": "The upstream connection failed before the response completed.",
    }
}
MESSAGES = [
    {"role": "user", "content": "Read the course file and explain oscillators."},
    {"role": "assistant", "content": None, "tool_calls": [{
        "id": "read-course", "type": "function",
        "function": {"name": "read_file", "arguments": '{"path":"course.txt"}'},
    }]},
    {"role": "tool", "tool_call_id": "read-course", "content": "Saved course evidence."},
]


def chunk(delta, finish_reason=None):
    return {"id": "completion-test", "object": "chat.completion.chunk",
            "created": 1, "model": "test-model",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]}


@pytest.fixture
def provider():
    state = SimpleNamespace(requests=[], responses=[], on_request=None)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state.requests.append(payload)
            if state.on_request:
                state.on_request()
            events = state.responses[min(len(state.requests) - 1, len(state.responses) - 1)]
            status = 200
            if isinstance(events, tuple):
                status, error = events
                body = json.dumps(error).encode()
            else:
                body = "".join(f"data: {json.dumps(event)}\n\n" for event in events)
                body = (body + "data: [DONE]\n\n").encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream" if status == 200 else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state.url = f"http://127.0.0.1:{server.server_port}/v1"
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def agent(provider, monkeypatch):
    from run_agent import AIAgent

    monkeypatch.setenv("HERMES_STREAM_RETRIES", "2")
    result = AIAgent(api_key="test-key", base_url=provider.url, provider="custom",
                     model="test-model", quiet_mode=True, skip_context_files=True,
                     skip_memory=True)
    result.api_mode = "chat_completions"
    yield result
    result.client.close()


def call(agent):
    return agent._interruptible_streaming_api_call({"model": "test-model", "messages": MESSAGES})


def test_upstream_disconnect_retries_the_same_request_with_saved_tool_results(provider, agent):
    provider.responses = [[CONNECTION_ERROR], [CONNECTION_ERROR], [
        chunk({"content": "The recovered answer."}), chunk({}, "stop"),
    ]]
    response = call(agent)
    assert response.choices[0].message.content == "The recovered answer."
    assert len(provider.requests) == 3
    assert all(request["messages"] == MESSAGES for request in provider.requests)


def test_upstream_disconnect_retries_an_incomplete_tool_call(provider, agent):
    provider.responses = [[
        chunk({"content": "Reading the next section."}),
        chunk({"tool_calls": [{"index": 0, "id": "partial", "type": "function",
               "function": {"name": "read_file", "arguments": '{"path":'}}]}),
        CONNECTION_ERROR,
    ], [
        chunk({"tool_calls": [{"index": 0, "id": "complete", "type": "function",
               "function": {"name": "read_file", "arguments": '{"path":"next.txt"}'}}]}),
        chunk({}, "tool_calls"),
    ]]
    response = call(agent)
    calls = response.choices[0].message.tool_calls
    assert len(provider.requests) == 2
    assert len(calls) == 1
    assert calls[0].id == "complete"
    assert json.loads(calls[0].function.arguments) == {"path": "next.txt"}


def test_upstream_disconnect_stops_after_the_stream_retry_budget(provider, agent):
    provider.responses = [[CONNECTION_ERROR]]
    with pytest.raises(APIError, match="upstream connection failed"):
        call(agent)
    assert len(provider.requests) == 3


def test_stop_during_upstream_failure_does_not_open_another_request(provider, agent):
    provider.responses = [[CONNECTION_ERROR]]
    provider.on_request = lambda: setattr(agent, "_interrupt_requested", True)
    with pytest.raises(InterruptedError):
        call(agent)
    assert len(provider.requests) == 1


@pytest.mark.parametrize("code,message", [
    ("invalid_api_key", "The provided API key is invalid."),
    ("insufficient_quota", "Your account has no remaining credits."),
    ("content_policy_violation", "This request is blocked by content policy."),
])
def test_permanent_provider_errors_do_not_enter_stream_retries(provider, agent, code, message):
    provider.responses = [[{"error": {"code": code, "message": message}}]]
    with pytest.raises(APIError):
        call(agent)
    assert len(provider.requests) == 1


def test_turn_retries_a_provider_503_without_repeating_completed_tools(provider, agent, monkeypatch):
    provider.responses = [
        (503, {"error": {"message": "Service temporarily unavailable"}}),
        (503, {"error": {"message": "Service temporarily unavailable"}}),
        [chunk({"content": "The recovered answer."}), chunk({}, "stop")],
    ]
    agent._api_max_retries = 3
    monkeypatch.setattr("agent.conversation_loop.jittered_backoff", lambda *args, **kwargs: 0)
    response = agent.run_conversation("Finish the answer using that evidence.", conversation_history=MESSAGES)
    assert response["completed"] is True
    assert response["final_response"] == "The recovered answer."
    assert len(provider.requests) == 3
    assert provider.requests[0]["messages"] == provider.requests[1]["messages"]
    assert provider.requests[1]["messages"] == provider.requests[2]["messages"]
    for request in provider.requests:
        assert [message for message in request["messages"] if message["role"] == "tool"] == [MESSAGES[-1]]


def test_turn_stops_when_provider_503_retries_are_exhausted(provider, agent, monkeypatch):
    provider.responses = [(503, {"error": {"message": "Service temporarily unavailable"}})]
    agent._api_max_retries = 3
    monkeypatch.setattr("agent.conversation_loop.jittered_backoff", lambda *args, **kwargs: 0)
    response = agent.run_conversation("Explain oscillators.")
    assert response["failed"] is True
    assert len(provider.requests) == 3


def test_turn_does_not_retry_a_permanent_bad_request(provider, agent):
    provider.responses = [(400, {"error": {"code": "invalid_request", "message": "Invalid request format"}})]
    agent._api_max_retries = 3
    response = agent.run_conversation("Explain oscillators.")
    assert response["failed"] is True
    assert len(provider.requests) == 1
