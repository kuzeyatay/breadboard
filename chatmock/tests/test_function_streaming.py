import json
import unittest

from chatmock.utils import sse_translate_chat


class Upstream:
    def __init__(self, events):
        self.events = events
        self.consumed = 0
        self.closed = False

    def iter_lines(self, **_kwargs):
        for event in self.events:
            self.consumed += 1
            yield f"data: {json.dumps(event)}".encode()

    def close(self):
        self.closed = True


def item_event(kind, item_id="item_1", call_id="call_1", arguments=""):
    return {"type": f"response.output_item.{kind}", "item": {
        "type": "function_call", "id": item_id, "call_id": call_id,
        "name": "cad_create_project", "arguments": arguments,
    }}


def arguments_delta(text, item_id="item_1"):
    return {"type": "response.function_call_arguments.delta", "item_id": item_id, "delta": text}


def decode(raw):
    return json.loads(raw.decode().removeprefix("data: "))


def translate(upstream):
    return [decode(raw) for raw in sse_translate_chat(upstream, "test-model", 1)
            if raw.strip() != b"data: [DONE]"]


def tool_deltas(chunks):
    return [tool for chunk in chunks for choice in chunk.get("choices", [])
            for tool in choice.get("delta", {}).get("tool_calls", [])]


class FunctionStreamingTests(unittest.TestCase):
    def test_arguments_arrive_before_the_upstream_finishes_the_function(self):
        args = '{"name": "Hand", "description": "caf\u00e9"}'
        upstream = Upstream([
            item_event("added"), arguments_delta(args[:12]), arguments_delta(args[12:]),
            item_event("done", arguments=args), {"type": "response.completed"},
        ])
        iterator = sse_translate_chat(upstream, "test-model", 1)
        first = decode(next(iterator))
        self.assertEqual(upstream.consumed, 1)
        second = decode(next(iterator))
        self.assertEqual(upstream.consumed, 2, "tool output must not wait for output_item.done")
        chunks = [first, second] + [decode(raw) for raw in iterator if raw.strip() != b"data: [DONE]"]
        deltas = tool_deltas(chunks)
        self.assertEqual("".join(part["function"].get("arguments", "") for part in deltas), args)
        self.assertEqual(sum("name" in part["function"] for part in deltas), 1)
        self.assertTrue(upstream.closed)

    def test_final_item_supplies_only_the_missing_argument_suffix(self):
        args = '{"source": "complete"}'
        upstream = Upstream([item_event("added"), arguments_delta(args[:10]), item_event("done", arguments=args)])
        deltas = tool_deltas(translate(upstream))
        self.assertEqual("".join(part["function"].get("arguments", "") for part in deltas), args)

    def test_interleaved_functions_keep_distinct_indices_and_arguments(self):
        upstream = Upstream([
            item_event("added"), item_event("added", "item_2", "call_2"),
            arguments_delta('{"a":'), arguments_delta('{"b":2}', "item_2"),
            arguments_delta('1}'), item_event("done", arguments='{"a":1}'),
            item_event("done", "item_2", "call_2", '{"b":2}'),
        ])
        grouped = {}
        for part in tool_deltas(translate(upstream)):
            grouped.setdefault(part["index"], "")
            grouped[part["index"]] += part["function"].get("arguments", "")
        self.assertEqual(grouped, {0: '{"a":1}', 1: '{"b":2}'})

    def test_a_provider_without_argument_deltas_keeps_the_complete_call_fallback(self):
        chunks = translate(Upstream([item_event("done", arguments='{"name":"Hand"}')]))
        deltas = tool_deltas(chunks)
        self.assertEqual(len(deltas), 1)
        self.assertEqual(json.loads(deltas[0]["function"]["arguments"]), {"name": "Hand"})

    def test_inconsistent_final_arguments_fail_instead_of_appending_a_different_call(self):
        upstream = Upstream([item_event("added"), arguments_delta('{"a":1}'), item_event("done", arguments='{"a":2}')])
        chunks = translate(upstream)
        self.assertTrue(any("error" in chunk for chunk in chunks))
        self.assertFalse(any(choice.get("finish_reason") for chunk in chunks for choice in chunk.get("choices", [])))
        self.assertTrue(upstream.closed)


if __name__ == "__main__":
    unittest.main()
