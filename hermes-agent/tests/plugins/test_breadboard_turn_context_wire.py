"""The per-turn context now travels on the current user message."""

from plugins.breadboard.history_context import END, START, deduplicate_history, tag_session

ANSWER = "The source says the blue valve opens at 42 kPa. Keep the red valve closed. " * 20


def _framed(role, text):
    line = f"{role.upper()} [garden_chat]: {text}"
    return START + f"<!-- message {role} garden_chat {len(line.encode('utf-8'))} -->\n{line}\n" + END


def test_history_copy_in_the_current_user_message_is_deduplicated():
    request = {"messages": [
        {"role": "system", "content": "Standing rules."},
        {"role": "user", "content": "First question."},
        {"role": "assistant", "content": ANSWER},
        {"role": "user", "content": "Explain that.\n\n<turn_context>\n" + _framed("assistant", ANSWER) + "\n</turn_context>"},
    ]}
    projected = deduplicate_history(request)["request"]["messages"]
    assert projected[2]["content"] == ANSWER, "runtime history is never touched"
    assert ANSWER not in projected[3]["content"]
    assert "identical to the earlier assistant message" in projected[3]["content"]
    assert projected[3]["content"].startswith("Explain that.")


def test_an_earlier_user_message_is_left_alone():
    earlier = "Old.\n\n" + _framed("assistant", ANSWER)
    request = {"messages": [
        {"role": "assistant", "content": ANSWER},
        {"role": "user", "content": earlier},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "Next."},
    ]}
    assert deduplicate_history(request) is None


def test_session_is_named_once_for_the_provider_cache():
    request = {"messages": [], "extra_headers": {"x-initiator": "user"}}
    tagged = tag_session(request, session_id="abc")["request"]
    assert tagged["extra_headers"] == {"x-initiator": "user", "X-Session-Id": "abc"}
    assert "X-Session-Id" not in request["extra_headers"]
    assert tag_session(tagged, session_id="abc") is None
    assert tag_session(request, session_id="") is None
