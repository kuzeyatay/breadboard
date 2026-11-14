"""Anthropic caches nothing unless the request marks where."""

from chatmock.providers.anthropic import build_payload


def _marked(body):
    marks = []
    for index, message in enumerate(body["messages"]):
        for block in message["content"]:
            if "cache_control" in block:
                marks.append(index)
    return marks


def _tool_turn(call_id):
    return [
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": call_id, "function": {"name": "search", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": call_id, "content": "result"},
    ]


def test_system_history_boundaries_and_newest_block_are_marked():
    body = build_payload({"messages": [
        {"role": "system", "content": "Standing rules."},
        {"role": "user", "content": "first"},
        *_tool_turn("a"),
        {"role": "assistant", "content": "answer one"},
        {"role": "user", "content": "second"},
        *_tool_turn("b"),
        {"role": "assistant", "content": "answer two"},
        {"role": "user", "content": "third\n\n<turn_context>volatile</turn_context>"},
        *_tool_turn("c"),
    ]}, "claude-opus-5-5", stream=True)

    assert body["system"] == [
        {"type": "text", "text": "Standing rules.", "cache_control": {"type": "ephemeral"}}]
    messages = body["messages"]
    authored = [i for i, m in enumerate(messages)
                if m["role"] == "user" and any(b["type"] != "tool_result" for b in m["content"])]
    # End of the history before each of the last two user-authored messages,
    # plus the newest block. With the system block that is the four allowed.
    assert _marked(body) == [authored[-2] - 1, authored[-1] - 1, len(messages) - 1]
    assert messages[authored[-1]]["content"][0].get("cache_control") is None


def test_first_turn_marks_only_what_exists():
    body = build_payload({"messages": [{"role": "user", "content": "hello"}]},
                         "claude-opus-5-5", stream=False)
    assert "system" not in body
    assert _marked(body) == [0]
