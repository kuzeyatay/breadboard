"""Breadboard constrains Hermes computer use to approved background input."""

import pytest

import plugins.breadboard as breadboard


@pytest.mark.parametrize(
    "action",
    ["capture", "wait", "list_apps", "list_windows"],
)
def test_read_only_computer_use_does_not_request_approval(action):
    assert (
        breadboard._guard_computer_use(
            tool_name="computer_use",
            args={"action": action},
        )
        is None
    )


@pytest.mark.parametrize(
    "action",
    [
        "click",
        "double_click",
        "right_click",
        "middle_click",
        "drag",
        "scroll",
        "type",
        "key",
        "set_value",
        "focus_app",
    ],
)
def test_mutating_background_computer_use_requires_scoped_approval(action):
    args = {"action": action, "delivery_mode": "background"}
    if action == "type":
        args["text"] = "private value"

    directive = breadboard._guard_computer_use(
        tool_name="computer_use",
        args=args,
    )

    assert directive == {
        "action": "approve",
        "message": (
            f"Allow Hermes to {action.replace('_', ' ')} in the selected app "
            "in the background?"
        ),
        "rule_key": f"breadboard-computer-use:{action}:background",
    }
    assert "private value" not in directive["message"]


@pytest.mark.parametrize(
    "args",
    [
        {"action": "click", "delivery_mode": "foreground"},
        {"action": "click", "bring_to_front": True},
        {"action": "focus_app", "raise_window": True},
        {"action": "click", "delivery_mode": "surprise"},
    ],
)
def test_foreground_or_unknown_delivery_is_blocked(args):
    directive = breadboard._guard_computer_use(
        tool_name="computer_use",
        args=args,
    )

    assert directive == {
        "action": "block",
        "message": (
            "Breadboard computer use is background-only; foreground delivery "
            "and window raising are disabled."
        ),
    }


def test_other_tools_are_untouched():
    assert (
        breadboard._guard_computer_use(
            tool_name="terminal_execute_command",
            args={"action": "click"},
        )
        is None
    )


def test_register_installs_the_computer_use_guard_hook():
    hooks = {}

    class _Context:
        def register_hook(self, name, callback):
            hooks[name] = callback

        def register_tool(self, **_kwargs):
            return None

    breadboard.register(_Context())

    assert hooks == {"pre_tool_call": breadboard._guard_computer_use}
