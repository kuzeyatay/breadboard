"""Tool-call commentary must stream to gateway consumers, not arrive whole.

When a model response carries tool calls, ``interruptible_streaming_api_call``
suppresses content streaming: chatty "I'll use the tool…" text interleaved with
tool cards is bad in a shared scrollback. The CLI still gets that text through
its own ``stream_delta_callback``, so nothing is lost there.

A gateway consumer (the desktop) has no ``stream_delta_callback`` — that channel
is the CLI's. So the suppressed branch used to drop the deltas entirely, leaving
``_current_streamed_assistant_text`` empty, which made
``_interim_content_was_streamed`` false, which made the gateway emit
``message.interim(already_streamed=False)``. The whole commentary then landed in
one lump instead of typing out.

A gateway consumer does not have the interleaving problem the suppression exists
for: it seals streamed text into its own segment at each tool boundary. So it
gets the deltas. These tests pin that routing — one channel per delta, and never
both.
"""

import run_agent


def _agent(*, cli_cb=None, gateway_cb=None):
    """A real AIAgent without the heavy __init__ (the fields here self-heal)."""
    agent = object.__new__(run_agent.AIAgent)
    agent.stream_delta_callback = cli_cb
    agent._stream_callback = gateway_cb
    agent._current_streamed_assistant_text = ""
    return agent


def _route_suppressed_delta(agent, text):
    """The routing under test, as `interruptible_streaming_api_call` runs it
    once tool calls have been seen (`tool_calls_acc` non-empty)."""
    if agent.stream_delta_callback:
        agent.stream_delta_callback(text)
        agent._record_streamed_assistant_text(text)
    elif agent._stream_callback:
        agent._stream_callback(text)
        agent._record_streamed_assistant_text(text)


def test_gateway_receives_tool_call_commentary():
    seen = []
    agent = _agent(gateway_cb=seen.append)

    _route_suppressed_delta(agent, "Rendering the reel")
    _route_suppressed_delta(agent, " now…")

    assert seen == ["Rendering the reel", " now…"], "commentary never reached the gateway"
    # Recorded, so the interim that follows reports it as already streamed and
    # the consumer seals its buffer instead of re-emitting the whole text.
    assert agent._current_streamed_assistant_text == "Rendering the reel now…"


def test_cli_channel_still_wins_and_never_doubles():
    cli, gateway = [], []
    agent = _agent(cli_cb=cli.append, gateway_cb=gateway.append)

    _route_suppressed_delta(agent, "one delta")

    # Exactly one channel per delta: a CLI run that also carries a gateway
    # callback must not emit the text twice.
    assert cli == ["one delta"]
    assert gateway == []


def test_no_consumer_at_all_is_still_safe():
    agent = _agent()
    _route_suppressed_delta(agent, "nobody is listening")
    assert agent._current_streamed_assistant_text == ""


def test_streamed_commentary_marks_the_interim_as_already_streamed():
    """The point of recording it: the gateway's interim then seals rather than
    re-sending, which is what stops the text appearing twice."""
    agent = _agent(gateway_cb=lambda _text: None)
    _route_suppressed_delta(agent, "The 9:16 reel is rendered and verified.")

    assert agent._interim_content_was_streamed(
        "The 9:16 reel is rendered and verified."
    ) is True
    # An unrelated final answer is not falsely marked as previewed.
    assert agent._interim_content_was_streamed("Something else entirely") is False


def test_source_keeps_the_three_channels_mutually_exclusive():
    """The routing above mirrors the real chain; if that chain grows a fourth
    branch or loses the elif, this test is the thing that notices."""
    import re
    from pathlib import Path

    source = Path(run_agent.__file__).with_name("agent") / "chat_completion_helpers.py"
    text = source.read_text(encoding="utf-8")
    block = text[
        text.index("# Accumulate text content") : text.index("# Accumulate tool call deltas")
    ]
    chain = re.findall(r"^\s+(if|elif) (.+):$", block, re.M)[1:]
    assert [kind for kind, _ in chain] == ["if", "elif", "elif"], chain
    assert "not tool_calls_acc" in chain[0][1]
    assert "stream_delta_callback" in chain[1][1]
    assert "_stream_callback" in chain[2][1]
