from __future__ import annotations

import unittest

from chatmock.utils import convert_chat_messages_to_responses_input


class ToolImageConversionTests(unittest.TestCase):
    def test_tool_pixels_survive_alongside_text_and_call_identity(self) -> None:
        image = "data:image/png;base64,aGVsbG8="
        messages = [
            {"role": "assistant", "tool_calls": [{"id": "figure-call", "type": "function", "function": {"name": "garden_get_source_figure", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "figure-call", "content": [
                {"type": "text", "text": "Untrusted source figure"},
                {"type": "image_url", "image_url": {"url": image, "detail": "original"}},
                {"type": "text", "text": "Page 28"},
            ]},
        ]
        items = convert_chat_messages_to_responses_input(messages)
        self.assertEqual(items[0]["call_id"], "figure-call")
        self.assertEqual(items[1], {"type": "function_call_output", "call_id": "figure-call", "output": [
            {"type": "input_text", "text": "Untrusted source figure"},
            {"type": "input_image", "image_url": image, "detail": "original"},
            {"type": "input_text", "text": "Page 28"},
        ]})
        self.assertEqual(messages[1]["content"][1]["type"], "image_url")

    def test_text_only_output_keeps_existing_string_shape(self) -> None:
        items = convert_chat_messages_to_responses_input([
            {"role": "tool", "tool_call_id": "a", "content": [{"type": "text", "text": "one"}, {"type": "text", "text": "two"}]},
            {"role": "tool", "tool_call_id": "b", "content": "unchanged"},
            {"role": "tool", "tool_call_id": "c", "content": []},
        ])
        self.assertEqual([item["output"] for item in items], ["one\ntwo", "unchanged", ""])

    def test_image_only_output_is_not_discarded(self) -> None:
        items = convert_chat_messages_to_responses_input([{
            "role": "tool", "tool_call_id": "image-only", "content": [
                {"type": "input_image", "image_url": "https://example.invalid/diagram.png", "detail": "high"},
            ],
        }])
        self.assertEqual(items[0]["output"], [{"type": "input_image", "image_url": "https://example.invalid/diagram.png", "detail": "high"}])


if __name__ == "__main__":
    unittest.main()
