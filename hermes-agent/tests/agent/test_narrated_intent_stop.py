"""Tests for the narrated-intent turn-end stop guard."""

from __future__ import annotations

import pytest

from agent.narrated_intent_stop import (
    build_narrated_intent_nudge,
    looks_like_narrated_intent,
    narrated_intent_nudge_enabled,
)


@pytest.fixture
def clear_env(monkeypatch):
    for var in ("HERMES_INTENT_STOP_NUDGE", "HERMES_INTENT_STOP_MAX_NUDGES"):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


# The exact reply from the Neuro Comp garden turn on 2026-11-09: one API
# call, no tool calls, finish_reason=stop, rendered as the finished answer.
NEURO_COMP = (
    "I’ll review the available Neuro Comp material and organize a study "
    "sequence, starting with neural computation before moving into circuit "
    "implementation."
)


@pytest.mark.parametrize(
    "text",
    [
        NEURO_COMP,
        "Let me check the garden sources first.",
        "I'll pull the lecture notes and put together the outline now.",
        "I'm going to look through the slides and summarize the key ideas.",
        "Sure. I will start by gathering the relevant pages.",
        "On it — I'll go through each lecture and draft the list.",
        # Live miss on 2026-11-09 13:44: the verb "use" was not in the old list.
        "I’ll use the lecture list to propose a study order and check whether the underlying material is available to ground the outline.",
        "I'll take care of that.",
    ],
)
def test_announcements_are_detected(text):
    assert looks_like_narrated_intent(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "",
        None,
        # A real answer with structure.
        "Here is the outline:\n\n1. Neurons and spikes\n2. Synaptic integration\n3. Rate coding",
        # A question for the user is a legitimate stop.
        "I'll need the course code first — which module is this for?",
        # A sign-off, not an intent to act.
        "I'll be here if you need anything else.",
        "Done. Let me know if you want it expanded.",
        # A refusal / blocker.
        "I can't access that garden; it has no sources yet.",
        # Long prose is a deliverable even without markdown.
        " ".join(["Neural computation studies how networks of neurons encode and transform signals."] * 8),
        # No intent phrasing at all.
        "The outline covers neurons, synapses, plasticity and population coding.",
        # A team or worker was started; the server wakes the chat later.
        "I've started the research team; results will wake this conversation when the workers finish.",
        "The team is running in the background. I'll update you when it completes.",
        "I'll report back once the download job finishes.",
    ],
)
def test_real_answers_questions_and_signoffs_are_not_flagged(text):
    assert looks_like_narrated_intent(text) is False


def test_nudge_fires_then_respects_budget(clear_env):
    first = build_narrated_intent_nudge(final_response=NEURO_COMP, attempts=0)
    assert first and "carry out the work" in first
    second = build_narrated_intent_nudge(final_response=NEURO_COMP, attempts=1)
    assert second and "blocking you" in second
    assert build_narrated_intent_nudge(final_response=NEURO_COMP, attempts=2) is None


def test_nudge_is_silent_for_real_answers(clear_env):
    assert build_narrated_intent_nudge(final_response="Here is the outline:\n\n- A\n- B", attempts=0) is None


def test_env_can_disable(clear_env):
    clear_env.setenv("HERMES_INTENT_STOP_NUDGE", "0")
    assert narrated_intent_nudge_enabled() is False
    assert build_narrated_intent_nudge(final_response=NEURO_COMP, attempts=0) is None


def test_env_can_change_budget(clear_env):
    clear_env.setenv("HERMES_INTENT_STOP_MAX_NUDGES", "1")
    from agent.narrated_intent_stop import max_narrated_intent_nudges

    assert max_narrated_intent_nudges() == 1
    assert build_narrated_intent_nudge(final_response=NEURO_COMP, attempts=1, max_attempts=1) is None


def test_flag_is_registered_as_ephemeral_scaffolding():
    from agent.conversation_compression import _SYNTHETIC_USER_FLAGS
    from agent.turn_finalizer import _VERIFICATION_CONTINUATION_FLAGS
    from run_agent import _EPHEMERAL_SCAFFOLDING_FLAGS

    for flags in (_SYNTHETIC_USER_FLAGS, _VERIFICATION_CONTINUATION_FLAGS, _EPHEMERAL_SCAFFOLDING_FLAGS):
        assert "_narrated_intent_synthetic" in flags
