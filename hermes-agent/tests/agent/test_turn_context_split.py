"""A client's per-turn context must never reach the system message."""

from agent.turn_context import (
    TURN_CONTEXT_MARKER,
    append_turn_context,
    split_ephemeral_system_prompt,
)


def test_prompt_without_marker_is_all_stable():
    assert split_ephemeral_system_prompt("Standing rules.") == ("Standing rules.", "")
    assert split_ephemeral_system_prompt(None) == ("", "")


def test_stable_part_is_identical_across_turns_with_different_context():
    turn_one = f"Standing rules.\n\n{TURN_CONTEXT_MARKER}\n\nGrant expires 10:00.\nMemory A."
    turn_two = f"Standing rules.\n\n{TURN_CONTEXT_MARKER}\n\nGrant expires 10:05.\nMemory B."
    stable_one, context_one = split_ephemeral_system_prompt(turn_one)
    stable_two, context_two = split_ephemeral_system_prompt(turn_two)
    assert stable_one == stable_two == "Standing rules."
    assert context_one != context_two
    assert "Memory B." in context_two


def test_context_rides_the_user_message_without_mutating_it():
    assert append_turn_context("hello", "") == "hello"
    text = append_turn_context("hello", "Memory A.")
    assert text.startswith("hello\n\n<turn_context>")
    assert "Memory A." in text and text.endswith("</turn_context>")

    parts = [{"type": "text", "text": "look"}, {"type": "image_url", "image_url": {"url": "data:,"}}]
    extended = append_turn_context(parts, "Memory A.")
    assert len(parts) == 2, "the stored multimodal message must stay clean"
    assert extended[:2] == parts and "Memory A." in extended[2]["text"]
