from __future__ import annotations

import json
import unittest

from chatmock.responses_api import aggregate_response_from_sse


class _FakeUpstream:
    """Minimal stand-in for the streaming `requests` response."""

    def __init__(self, events: list[dict]) -> None:
        self._lines = [b"data: " + json.dumps(event).encode("utf-8") for event in events]
        self._lines.append(b"data: [DONE]")
        self.closed = False

    def iter_lines(self, decode_unicode: bool = False):  # noqa: ARG002 - requests signature
        yield from self._lines

    def close(self) -> None:
        self.closed = True


def _image_item(result: str = "iVBORw0KGgo=") -> dict:
    return {
        "type": "image_generation_call",
        "id": "ig_1",
        "status": "completed",
        "result": result,
    }


class ResponsesAggregationTests(unittest.TestCase):
    def test_streamed_items_fill_an_empty_completed_output(self) -> None:
        """The image-generation shape: items stream, then `output` completes empty."""
        upstream = _FakeUpstream(
            [
                {"type": "response.output_item.added", "output_index": 0, "item": {"type": "image_generation_call", "id": "ig_1"}},
                {"type": "response.output_item.done", "output_index": 0, "item": _image_item()},
                {"type": "response.output_item.done", "output_index": 1, "item": {"type": "message", "id": "msg_1", "role": "assistant", "content": []}},
                {"type": "response.completed", "response": {"id": "resp_1", "status": "completed", "output": []}},
            ]
        )

        response, error = aggregate_response_from_sse(upstream)

        self.assertIsNone(error)
        self.assertIsNotNone(response)
        assert response is not None
        self.assertEqual([item["type"] for item in response["output"]], ["image_generation_call", "message"])
        self.assertEqual(response["output"][0]["result"], "iVBORw0KGgo=")
        self.assertTrue(upstream.closed)

    def test_a_complete_final_output_is_left_alone(self) -> None:
        final_output = [{"type": "message", "id": "msg_1", "role": "assistant", "content": [{"type": "output_text", "text": "hi"}]}]
        upstream = _FakeUpstream(
            [
                {"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "id": "msg_1"}},
                {"type": "response.completed", "response": {"id": "resp_1", "output": final_output}},
            ]
        )

        response, _ = aggregate_response_from_sse(upstream)

        assert response is not None
        self.assertEqual(response["output"], final_output)

    def test_failure_still_reports_the_upstream_error(self) -> None:
        upstream = _FakeUpstream(
            [
                {"type": "response.output_item.done", "output_index": 0, "item": _image_item()},
                {"type": "response.failed", "response": {"error": {"message": "nope"}}},
            ]
        )

        _, error = aggregate_response_from_sse(upstream)

        self.assertEqual(error, {"error": {"message": "nope"}})


if __name__ == "__main__":
    unittest.main()
