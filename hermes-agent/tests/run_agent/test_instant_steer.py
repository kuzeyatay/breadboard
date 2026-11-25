"""Instant steering: a correction sent while a tool runs stops that tool and
the same turn answers the correction at once (Codex 0.163 parity).

These drive a real ``run_conversation`` loop. Only the provider and the tool
handler are faked: the tool blocks until Hermes' per-thread interrupt fires,
exactly like a long terminal command, so a steer that waited for the batch
would hang the test instead of passing it.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from run_agent import AIAgent
from tools.interrupt import is_interrupted


def _tool_defs(*names):
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": f"{name} tool",
                "parameters": {"type": "object", "properties": {}},
            },
        }
        for name in names
    ]


def _tool_call(name, arguments="{}"):
    return SimpleNamespace(
        id=f"call_{uuid.uuid4().hex[:8]}",
        type="function",
        function=SimpleNamespace(name=name, arguments=arguments),
    )


def _response(content, tool_calls=None):
    msg = SimpleNamespace(
        content=content,
        tool_calls=tool_calls,
        reasoning=None,
        reasoning_content=None,
        reasoning_details=None,
    )
    finish = "tool_calls" if tool_calls else "stop"
    return SimpleNamespace(
        choices=[SimpleNamespace(message=msg, finish_reason=finish)],
        model="test/model",
        usage=None,
    )


@pytest.fixture()
def agent():
    with (
        patch("run_agent.get_tool_definitions", return_value=_tool_defs("terminal", "web_search")),
        patch("run_agent.check_toolset_requirements", return_value={}),
        patch("run_agent.OpenAI"),
    ):
        a = AIAgent(
            api_key="test-key-1234567890",
            base_url="https://openrouter.ai/api/v1",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )
    a.client = MagicMock()
    a._cached_system_prompt = "You are helpful."
    a._use_prompt_caching = False
    a.tool_delay = 0
    a.compression_enabled = False
    a.save_trajectories = False
    return a


def _transcript(messages):
    """Readable view of the live turn, printed with ``-s`` for test runs."""
    lines = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue
        content = m.get("content")
        if isinstance(content, list):
            content = " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
        content = (content or "").strip().replace("\n", " ")
        calls = m.get("tool_calls") or []
        names = ", ".join(c["function"]["name"] for c in calls) if calls else ""
        label = {"assistant": "BREAD", "user": "USER", "tool": "TOOL"}.get(role, role)
        lines.append(f"  [{label}] {content[:110]}" + (f"  -> calls {names}" if names else ""))
    return "\n".join(lines)


def _run(agent, user_text, responses, tool_handler):
    """Run one turn; return (result, model requests seen, wall seconds)."""
    requests = []

    def fake_api_call(api_kwargs):
        requests.append([dict(m) for m in api_kwargs["messages"]])
        return responses[len(requests) - 1]

    started = time.monotonic()
    with (
        patch.object(agent, "_interruptible_api_call", side_effect=fake_api_call),
        patch("run_agent.handle_function_call", side_effect=tool_handler),
        patch.object(agent, "_persist_session"),
        patch.object(agent, "_save_trajectory"),
        patch.object(agent, "_cleanup_task_resources"),
    ):
        result = agent.run_conversation(user_text)
    return result, requests, time.monotonic() - started


def test_steer_during_long_tool_stops_it_and_answers_in_the_same_turn(agent):
    tool_started = threading.Event()
    tool_saw_interrupt = threading.Event()

    def long_terminal(name, args, *_a, **_k):
        # A 60s command that only returns early when Hermes interrupts it.
        tool_started.set()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if is_interrupted():
                tool_saw_interrupt.set()
                return json.dumps({"output": "[command interrupted]", "exit_code": 130})
            time.sleep(0.01)
        return json.dumps({"output": "full test suite finished", "exit_code": 0})

    steered = {}

    def steer_when_tool_runs():
        tool_started.wait(5)
        steered["accepted"] = agent.redirect("Stop. Only run the auth tests.")

    threading.Thread(target=steer_when_tool_runs, daemon=True).start()
    result, requests, seconds = _run(
        agent,
        "Run the full test suite and tell me what fails.",
        [
            _response(
                "I'll run the whole suite first.",
                [_tool_call("terminal", '{"command":"pytest"}')],
            ),
            _response("Got it, running only the auth tests: all 12 pass."),
        ],
        long_terminal,
    )

    print("\n--- instant steer during a long tool ---")
    print(_transcript(result["messages"]))
    print(f"  FINAL: {result['final_response']}  ({seconds:.2f}s)")

    assert steered["accepted"] is True
    assert tool_saw_interrupt.is_set(), "the running tool was not interrupted"
    assert seconds < 10, "the steer waited for the tool instead of stopping it"
    assert result["completed"] is True
    assert result["interrupted"] is False
    assert result["final_response"] == "Got it, running only the auth tests: all 12 pass."
    # The model's second request carries the stopped tool, a checkpoint, then
    # the correction as a real user message: strict role alternation.
    tail = requests[1][-3:]
    assert [m["role"] for m in tail] == ["tool", "assistant", "user"]
    assert "stopped by a user correction" in tail[1]["content"]
    assert tail[2]["content"] == "Stop. Only run the auth tests."
    assert agent._interrupt_requested is False
    assert agent._pending_redirect is None


def test_steer_skips_tools_not_yet_started_in_the_batch(agent):
    calls = []
    tool_started = threading.Event()

    def handler(name, args, *_a, **_k):
        calls.append(name)
        tool_started.set()
        while not is_interrupted():
            time.sleep(0.01)
        return json.dumps({"output": "[interrupted]"})

    def steer_when_tool_runs():
        tool_started.wait(5)
        agent.redirect("Never mind, just summarise what you have.")

    # Two sequential (unsafe) terminal calls: the second must never start.
    threading.Thread(target=steer_when_tool_runs, daemon=True).start()
    result, requests, _ = _run(
        agent,
        "Deploy then smoke-test.",
        [
            _response(
                "Deploying, then smoke testing.",
                [
                    _tool_call("terminal", '{"command":"./deploy.sh"}'),
                    _tool_call("terminal", '{"command":"./smoke.sh"}'),
                ],
            ),
            _response("Summary: deploy was stopped before it finished; nothing else ran."),
        ],
        handler,
    )

    print("\n--- instant steer skips queued tools ---")
    print(_transcript(result["messages"]))
    print(f"  FINAL: {result['final_response']}")

    assert calls == ["terminal"]
    tool_results = [m for m in requests[1] if m.get("role") == "tool"]
    assert len(tool_results) == 2  # every tool_call id still gets a result
    assert "skipped" in tool_results[1]["content"]
    assert result["completed"] is True
    assert result["final_response"].startswith("Summary:")


def test_without_instant_steer_the_correction_waits_for_the_tool(agent):
    agent.instant_steer = False
    tool_started = threading.Event()
    release = threading.Event()

    def handler(name, args, *_a, **_k):
        tool_started.set()
        release.wait(5)
        return json.dumps({"output": "suite finished", "exit_code": 0})

    def steer_when_tool_runs():
        tool_started.wait(5)
        assert agent.redirect("Only the auth tests.") is True
        release.set()

    threading.Thread(target=steer_when_tool_runs, daemon=True).start()
    result, requests, _ = _run(
        agent,
        "Run the suite.",
        [
            _response("Running.", [_tool_call("terminal", '{"command":"pytest"}')]),
            _response("Done."),
        ],
        handler,
    )

    print("\n--- instant steer off (waits for the tool) ---")
    print(_transcript(result["messages"]))
    print(f"  FINAL: {result['final_response']}")

    last_tool = [m for m in requests[1] if m.get("role") == "tool"][-1]
    assert "suite finished" in last_tool["content"]
    assert "Only the auth tests." in last_tool["content"]
    assert result["completed"] is True
