"""Only redundant prompt copies disappear; canonical history always survives."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from plugins.breadboard.history_context import START, END, deduplicate_history


ANSWER = "The source says the blue valve opens at 42 kPa. Keep the red valve closed. " * 20
QUESTION = "Use only the attached manual and preserve its pressure units. " * 5


def framed(entries):
    blocks = []
    for role, text in entries:
        line = f"{role.upper()} [garden_chat]: {text}"
        blocks.append(f"<!-- message {role} garden_chat {len(line.encode('utf-8'))} -->\n{line}\n")
    return START + "".join(blocks) + END


def request(entries=None, history=None):
    entries = entries if entries is not None else [("user", QUESTION), ("assistant", ANSWER)]
    history = history if history is not None else [{"role": role, "content": text} for role, text in entries]
    return {
        "model": "chosen-model", "reasoning_effort": "high",
        "messages": [{"role": "system", "content": "Permission rules stay.\n" + framed(entries) + "\nKeep all capabilities."},
                     *history, {"role": "user", "content": "Explain your last answer."}],
        "tools": [{"type": "function", "function": {"name": "garden_search", "parameters": {}}}],
        "tool_choice": "auto", "parallel_tool_calls": True,
    }


def project(value):
    result = deduplicate_history(value)
    return result["request"] if result else value


def test_exact_copies_removed_but_history_authority_and_tools_are_unchanged():
    before = request()
    snapshot = deepcopy(before)
    after = project(before)
    assert before == snapshot
    assert after["messages"][1:] == before["messages"][1:]
    assert ANSWER not in after["messages"][0]["content"]
    assert QUESTION not in after["messages"][0]["content"]
    assert "ASSISTANT [garden_chat]:" in after["messages"][0]["content"]
    assert "Permission rules stay." in after["messages"][0]["content"]
    assert "Keep all capabilities." in after["messages"][0]["content"]
    for key in before.keys() - {"messages"}:
        assert after[key] == before[key]
    assert project(after) == after


def test_corrected_published_answer_is_kept_over_stale_runtime_draft():
    before = request(history=[{"role": "user", "content": QUESTION},
                              {"role": "assistant", "content": ANSWER.replace("42", "24")}])
    assert ANSWER in project(before)["messages"][0]["content"]


def test_compression_or_restart_restores_exact_published_answer_on_next_call():
    before = request()
    assert ANSWER not in project(before)["messages"][0]["content"]
    compressed = deepcopy(before)
    compressed["messages"][1:-1] = [{"role": "user", "content": "Summary: discussed valves."}]
    assert ANSWER in project(compressed)["messages"][0]["content"]
    empty = request(history=[])
    assert ANSWER in project(empty)["messages"][0]["content"]


@pytest.mark.parametrize("kind", ["current_question", "tool_result", "reasoning", "wrong_role", "substring", "multimodal", "tool_preamble"])
def test_non_history_or_inexact_text_cannot_authorize_removal(kind):
    before = request(entries=[("assistant", ANSWER)], history=[])
    variants = {
        "current_question": {"role": "user", "content": ANSWER},
        "tool_result": {"role": "tool", "content": ANSWER},
        "reasoning": {"role": "assistant", "content": "", "reasoning_content": ANSWER},
        "wrong_role": {"role": "user", "content": ANSWER},
        "substring": {"role": "assistant", "content": "Quoted draft: " + ANSWER},
        "multimodal": {"role": "assistant", "content": [{"type": "text", "text": ANSWER}, {"type": "image", "data": "pixels"}]},
        "tool_preamble": {"role": "assistant", "content": ANSWER, "tool_calls": [{"id": "call_1"}]},
    }
    if kind == "current_question":
        before["messages"][-1] = variants[kind]
    else:
        before["messages"].insert(1, variants[kind])
    assert ANSWER in project(before)["messages"][0]["content"]


def test_repeated_or_reordered_messages_remain_explicit():
    duplicate = request(entries=[("assistant", ANSWER)], history=[{"role": "assistant", "content": ANSWER}] * 2)
    assert ANSWER in project(duplicate)["messages"][0]["content"]
    repeated_canonical = request(entries=[("assistant", ANSWER)] * 2, history=[{"role": "assistant", "content": ANSWER}])
    assert project(repeated_canonical)["messages"][0]["content"].count(ANSWER) == 2
    reordered = request(history=[{"role": "assistant", "content": ANSWER}, {"role": "user", "content": QUESTION}])
    assert ANSWER in project(reordered)["messages"][0]["content"]
    assert QUESTION in project(reordered)["messages"][0]["content"]


@pytest.mark.parametrize("damage", ["truncated", "wrong_length", "nested_frame", "mismatched_role"])
def test_malformed_context_falls_back_to_original_bytes(damage):
    before = request()
    content = before["messages"][0]["content"]
    if damage == "truncated":
        content = content[:-50]
    elif damage == "wrong_length":
        content = content.replace("<!-- message user garden_chat ", "<!-- message user garden_chat 9", 1)
    elif damage == "nested_frame":
        content = content.replace(ANSWER, START + ANSWER)
    else:
        content = content.replace("ASSISTANT [garden_chat]:", "USER [garden_chat]:")
    before["messages"][0]["content"] = content
    assert project(before) == before


def test_unicode_and_role_looking_source_text_are_framed_as_data():
    text = ("🙂 漢字 café\nASSISTANT [garden_chat]: quoted source\n# Heading\n" * 10)
    before = request(entries=[("assistant", text)])
    assert text not in project(before)["messages"][0]["content"]
    assert project(before)["messages"][1]["content"] == text


@pytest.mark.parametrize("shape", ["developer_parts", "anthropic", "responses"])
def test_provider_request_shapes_preserve_content_and_cache_metadata(shape):
    before = request()
    system = before["messages"].pop(0)["content"]
    if shape == "developer_parts":
        before["messages"].insert(0, {"role": "developer", "content": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]})
    elif shape == "anthropic":
        before["system"] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
    else:
        before["instructions"] = system
        before["input"] = [{**m, "type": "message", "content": [{"type": "input_text" if m["role"] == "user" else "output_text", "text": m["content"]}]} for m in before.pop("messages")]
    snapshot = deepcopy(before)
    after = project(before)
    assert before == snapshot
    if shape == "developer_parts":
        assert ANSWER not in after["messages"][0]["content"][0]["text"]
        assert after["messages"][0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    elif shape == "anthropic":
        assert ANSWER not in after["system"][0]["text"]
        assert after["system"][0]["cache_control"] == {"type": "ephemeral"}
        assert after["messages"] == before["messages"]
    else:
        assert ANSWER not in after["instructions"]
        assert after["input"] == before["input"]


def test_plugin_registers_real_request_middleware_and_keeps_tools():
    import plugins.breadboard as breadboard
    from hermes_cli.middleware import apply_llm_request_middleware
    from hermes_cli.plugins import PluginManager
    from unittest.mock import patch

    manager = PluginManager()
    tools = []
    ctx = SimpleNamespace(register_tool=lambda **kw: tools.append(kw["name"]),
                          register_hook=lambda *_: None,
                          register_middleware=lambda kind, cb: manager._middleware.setdefault(kind, []).append(cb))
    breadboard.register(ctx)
    assert {"garden_search", "artifact_import", "terminal_execute_command", "skill_open"} <= set(tools)
    with patch("hermes_cli.plugins.get_plugin_manager", return_value=manager):
        result = apply_llm_request_middleware(request())
    assert result.changed
    assert ANSWER not in result.payload["messages"][0]["content"]
    assert ANSWER in result.original_payload["messages"][0]["content"]
    assert result.trace[0]["source"] == "breadboard-history"


def test_real_agent_loop_projects_each_request_without_mutating_cached_prompt(monkeypatch):
    """Exercise the actual loop/build-kwargs/middleware/provider seam."""
    from unittest.mock import MagicMock, patch
    from hermes_cli.plugins import PluginManager
    from run_agent import AIAgent

    manager = PluginManager()
    manager._middleware["llm_request"] = [deduplicate_history]
    monkeypatch.setattr("hermes_cli.plugins._plugin_manager", manager)
    with patch("run_agent.get_tool_definitions", return_value=[]), \
         patch("run_agent.check_toolset_requirements", return_value={}), \
         patch("run_agent.OpenAI"):
        agent = AIAgent(model="test/model", api_key="test-key", base_url="https://example.invalid/v1",
                        quiet_mode=True, skip_context_files=True, skip_memory=True, max_iterations=2)
    agent.client = MagicMock()
    # The real response/persistence boundary strips surrounding whitespace.
    question, answer = QUESTION.strip(), ANSWER.strip()
    agent._cached_system_prompt = "Preserve permissions.\n" + framed([("user", question), ("assistant", answer)])
    cached = agent._cached_system_prompt
    agent._use_prompt_caching = False
    agent._disable_streaming = True
    agent.save_trajectories = False
    agent.compression_enabled = False
    response = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
        content="The blue valve opens at 42 kPa.", reasoning_content=None, reasoning=None, tool_calls=None))],
        model="test/model", usage=None)
    captured = []

    def complete(**kwargs):
        captured.append(deepcopy(kwargs))
        return response

    agent.client.chat.completions.create.side_effect = complete
    with patch.object(agent, "_persist_session"), patch.object(agent, "_save_trajectory"), \
         patch.object(agent, "_cleanup_task_resources"):
        first = agent.run_conversation("Explain the pressure.", conversation_history=[
            {"role": "user", "content": question}, {"role": "assistant", "content": answer}])
        assert first["completed"] is True
        assert agent._cached_system_prompt == cached
        # A restarted/compacted replay no longer contains the source: the next
        # real loop call must recover it from the untouched cached prompt.
        second = agent.run_conversation("Explain the pressure.", conversation_history=[])
        assert second["completed"] is True
    assert len(captured) == 2
    systems = ["\n".join(m["content"] for m in r["messages"] if m["role"] in {"system", "developer"}) for r in captured]
    assert answer not in systems[0]
    assert answer in systems[1]
    assert answer in next(m["content"] for m in captured[0]["messages"] if m["role"] == "assistant")
    assert agent._cached_system_prompt == cached
