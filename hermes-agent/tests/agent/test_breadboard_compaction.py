"""Breadboard's rolling compaction must not resurrect an answered inline question."""

from unittest.mock import patch

import pytest

from agent.context_compressor import ContextCompressor


@pytest.mark.parametrize("with_system", [False, True])
def test_old_inline_exchange_is_summarized_together_and_current_approval_survives(with_system):
    with patch("agent.context_compressor.get_model_context_length", return_value=100000):
        compressor = ContextCompressor(model="test", quiet_mode=True, protect_first_n=0, protect_last_n=2)
    compressor.tail_token_budget = 200
    old_question = '[Ask here: side question about "The element laws"] whats that'
    old_answer = "Those are the component voltage-current relationships."
    messages = ([{"role": "system", "content": "Follow the current request."}] if with_system else []) + [
        {"role": "user", "content": "Fix the math formatting."},
        {"role": "assistant", "content": "Fixed the formatting."},
        {"role": "user", "content": old_question},
        {"role": "assistant", "content": old_answer},
        {"role": "user", "content": "Review this note: " + "older material " * 2000},
        {"role": "assistant", "content": "Review completed. " + "older findings " * 2000},
        {"role": "user", "content": "Propose the missing parts."},
        {"role": "assistant", "content": "Created proposals 28 through 33, pending review."},
        {"role": "user", "content": "apply all of them"},
    ]
    with patch.object(compressor, "_generate_summary", return_value="Earlier formatting and inline questions were answered. The note was reviewed.") as summarize:
        result = compressor.compress(messages)
    summarized = summarize.call_args.args[0]
    assert any(message["content"] == old_question for message in summarized)
    assert any(message["content"] == old_answer for message in summarized)
    assert not any(message["content"] == old_question for message in result)
    assert result[-1] == messages[-1]
    assert any("proposals 28 through 33" in message["content"] for message in result)
    if with_system:
        assert result[0]["role"] == "system"
        assert result[0]["content"].startswith(messages[0]["content"])
