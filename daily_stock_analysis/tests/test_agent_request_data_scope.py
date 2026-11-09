"""A restricted chat must never call the shared market-data handlers."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from api.v1.endpoints import agent as endpoint
from src.agent.agent_backend import AgentRunRequest
from src.agent.factory import SkillPromptState, build_agent_chat_executor
from src.agent.llm_adapter import LLMResponse, ToolCall
from src.agent.tools.registry import ToolDefinition, ToolPolicy, ToolRegistry


class ToolRequestAdapter:
    def __init__(self):
        self.calls = []

    def call_with_tools(self, messages, tools, timeout=None):
        self.calls.append(tools)
        if len(self.calls) == 1:
            # Even an invented tool call must not regain access to the cached registry.
            return LLMResponse(tool_calls=[ToolCall("call-1", "get_realtime_quote", {})], model="fixture", provider="fixture")
        return LLMResponse(content="10%; 0.4; 150", model="fixture", provider="fixture")


def test_restricted_backend_blocks_lookup_without_mutating_normal_requests():
    retrieved = []
    shared = ToolRegistry()
    shared.register(ToolDefinition(
        name="get_realtime_quote", description="Owned test probe", parameters=[],
        handler=lambda: retrieved.append(True) or {"price": 1},
        policy=ToolPolicy.declared(read_only=True),
    ))
    state = SkillPromptState(
        skill_manager=SimpleNamespace(), skills_to_activate=[], explicit_skill_selection=False,
        use_legacy_default_prompt=True, skill_instructions="Normal market tools",
        default_skill_policy="Normal research", technical_skill_policy="Normal technical analysis",
    )
    config = SimpleNamespace(agent_backend="auto", agent_arch="single", agent_max_steps=2, agent_orchestrator_timeout_s=30)
    request = AgentRunRequest(
        system_prompt="Use the supplied figures", history_messages=[], user_message="Revenue 1000, income 100",
        session_id="owned-scope-test", stock_scope=None, max_steps=2, max_wall_clock_seconds=30,
    )
    restricted_adapter, normal_adapter = ToolRequestAdapter(), ToolRequestAdapter()
    with patch("src.agent.factory.get_tool_registry", return_value=shared), \
         patch("src.agent.factory.resolve_skill_prompt_state", return_value=state), \
         patch("src.agent.llm_adapter.LLMToolAdapter", side_effect=[restricted_adapter, normal_adapter]):
        restricted = build_agent_chat_executor(config, allow_external_data=False)
        normal = build_agent_chat_executor(config)
    assert "supplied" in restricted.default_skill_policy
    assert restricted.skill_instructions == ""
    assert state.default_skill_policy == "Normal research"
    assert normal.backend.tool_registry is shared
    result = restricted.backend.run(request)
    assert result.success
    assert retrieved == []
    assert restricted_adapter.calls and all(tools == [] for tools in restricted_adapter.calls)
    assert shared.list_names() == ["get_realtime_quote"]
    result = normal.backend.run(request)
    assert result.success
    assert retrieved == [True]
    assert normal_adapter.calls[0][0]["function"]["name"] == "get_realtime_quote"


def test_multi_agent_factory_preserves_the_request_limit():
    sentinel = object()
    with patch("src.agent.factory.build_agent_executor", return_value=sentinel) as build:
        result = build_agent_chat_executor(SimpleNamespace(agent_backend="auto", agent_arch="multi"), allow_external_data=False)
    assert result is sentinel
    assert build.call_args.kwargs["allow_external_data"] is False


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("allow_external_data", [False, True])
def test_both_chat_endpoints_forward_scope_and_preserve_the_default(streaming, allow_external_data):
    config = SimpleNamespace(report_language="en")
    selection = SimpleNamespace(effective_skill_ids=[], selected_skill_ids_update=None)
    sessions = SimpleNamespace(resolve_skill_selection=lambda *args: selection)
    result = SimpleNamespace(success=True, content="10%; 0.4; 150", error=None, total_steps=1, backend="litellm", error_code=None)
    executor = MagicMock()
    executor.chat.return_value = result
    executor.execute_turn.return_value = result
    request = endpoint.ChatRequest(message="Use only these supplied figures", allow_external_data=allow_external_data)

    async def run():
        if streaming:
            response = await endpoint.agent_chat_stream(request, session_service=sessions)
            events = [json.loads(chunk.removeprefix("data: ").strip()) async for chunk in response.body_iterator]
            assert events[-1]["type"] == "done"
        else:
            response = await endpoint.agent_chat(request, session_service=sessions)
            assert response.success

    with patch.object(endpoint, "get_config", return_value=config), \
         patch.object(endpoint, "_select_agent_chat_backend", return_value="litellm"), \
         patch.object(endpoint, "_build_executor", return_value=executor) as build:
        asyncio.run(run())
    assert build.call_args.kwargs == ({} if allow_external_data else {"allow_external_data": False})


def test_data_scope_is_optional_and_requires_a_boolean():
    assert endpoint.ChatRequest(message="Normal research").allow_external_data is True
    for value in [None, "false", 0, [], {}]:
        with pytest.raises(ValueError):
            endpoint.ChatRequest(message="Invalid policy", allow_external_data=value)


def test_codex_can_intentionally_reason_without_tools_but_keeps_isolation_checks():
    from tests.test_agent_backend import _FakeTransport, _request

    class NoToolTransport(_FakeTransport):
        isolation_passed = True
        isolation_checked = False

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.tool_calls = ()

        def inspect_external_tool_isolation(self, thread_id):
            self.isolation_checked = True
            return {"passed": self.isolation_passed}

    config = SimpleNamespace(agent_backend="codex_app_server", agent_arch="single", agent_max_steps=2, agent_orchestrator_timeout_s=30)
    state = SkillPromptState(SimpleNamespace(), [], False, True, "Normal", "Normal", "Normal")
    with patch("src.agent.factory.get_tool_registry", return_value=ToolRegistry()), \
         patch("src.agent.factory.resolve_skill_prompt_state", return_value=state), \
         patch("src.agent.codex_agent_backend.build_hardened_command", return_value=["owned-offline-fixture"]):
        restricted = build_agent_chat_executor(config, allow_external_data=False)
        restricted.backend.transport_factory = NoToolTransport
        assert restricted.backend.run(_request()).success
        assert NoToolTransport.last.thread_kwargs["tool_names"] == []
        assert NoToolTransport.last.isolation_checked
        assert "Non-stock market tools remain available" not in NoToolTransport.last.thread_kwargs["developer_instructions"]

        NoToolTransport.isolation_passed = False
        assert restricted.backend.run(_request()).error_code == "capability_unsupported"

        normal = build_agent_chat_executor(config)
        normal.backend.transport_factory = NoToolTransport
        NoToolTransport.isolation_passed = True
        assert normal.backend.run(_request()).error_code == "capability_unsupported"
