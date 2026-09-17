from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from chatmock import usage_ledger


class _FakeResponse:
    """The slice of requests.Response the tap relies on."""

    def __init__(self, chunks, status_code=200):
        self._chunks = chunks
        self.status_code = status_code
        self.closed = False

    def iter_content(self, chunk_size=1, decode_unicode=False):
        for chunk in self._chunks:
            yield chunk

    def iter_lines(self, chunk_size=512, decode_unicode=False, delimiter=None):
        pending = b""
        for chunk in self.iter_content(chunk_size=chunk_size):
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                yield line
        if pending:
            yield pending

    @property
    def content(self):
        return b"".join(self.iter_content(chunk_size=None))

    def close(self):
        self.closed = True


class UsageLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "usage_ledger.jsonl")
        os.environ["CHATMOCK_USAGE_LEDGER_FILE"] = self.path

    def tearDown(self) -> None:
        os.environ.pop("CHATMOCK_USAGE_LEDGER_FILE", None)
        self.tmp.cleanup()

    def _rows(self):
        with open(self.path, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def test_record_usage_names_account_tokens_and_origin(self) -> None:
        account = SimpleNamespace(key="acc-1", email="plus@example.com", plan="plus")
        row = usage_ledger.record_usage(
            kind="chat",
            endpoint="chat.completions",
            provider="chatgpt",
            model="gpt-5.6-sol",
            requested_model="chat",
            request_id="mreq_1",
            account=account,
            origin={"source": "chat"},
            tokens={"input_tokens": 120, "output_tokens": 30, "output_tokens_details": {"reasoning_tokens": 10}},
            outcome="succeeded",
            started_at=1_000_000.0,
        )
        self.assertEqual(row["account"]["label"], "plus@example.com")
        self.assertEqual(row["account"]["plan"], "plus")
        self.assertEqual(row["tokens"], {"input": 120, "output": 30, "reasoning": 10, "cached": 0, "total": 150})
        self.assertEqual(row["origin"]["source"], "chat")
        self.assertEqual(self._rows()[0]["requestId"], "mreq_1")

    def test_tap_records_once_with_usage_from_terminal_sse_event(self) -> None:
        completed = json.dumps(
            {"type": "response.completed", "response": {"usage": {"input_tokens": 7, "output_tokens": 3, "total_tokens": 10}}}
        )
        upstream = _FakeResponse(
            [b"data: " + json.dumps({"type": "response.output_text.delta", "delta": "hi"}).encode() + b"\n\n",
             b"data: " + completed.encode() + b"\n\n"]
        )
        upstream.chatmock_account = SimpleNamespace(key="k", email="a@b.c", plan="pro")
        usage_ledger.tap_chatgpt_response(
            upstream,
            request_id="mreq_2",
            endpoint="chat.completions",
            model="gpt-5.6-sol",
            requested_model="default",
            origin={"source": "background"},
            started_at=1.0,
        )
        seen = list(upstream.iter_lines())
        upstream.close()
        upstream.close()
        self.assertEqual(len(seen), 4)
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["tokens"]["total"], 10)
        self.assertEqual(rows[0]["outcome"], "succeeded")
        self.assertEqual(rows[0]["account"]["email"], "a@b.c")
        self.assertTrue(upstream.closed)

    def test_tap_reads_usage_from_a_json_body(self) -> None:
        upstream = _FakeResponse([json.dumps({"id": "resp", "usage": {"input_tokens": 4, "output_tokens": 1}}).encode()])
        usage_ledger.tap_chatgpt_response(
            upstream, request_id="mreq_3", endpoint="responses", model="gpt-5.6-sol", origin={"source": "direct"}
        )
        self.assertIn(b"usage", upstream.content)
        upstream.close()
        rows = self._rows()
        self.assertEqual(rows[0]["tokens"], {"input": 4, "output": 1, "reasoning": 0, "cached": 0, "total": 5})

    def test_tap_marks_a_429_as_quota_exhausted(self) -> None:
        upstream = _FakeResponse([b'{"error":{"message":"limit"}}'], status_code=429)
        usage_ledger.tap_chatgpt_response(
            upstream, request_id="mreq_4", endpoint="chat.completions", model="gpt-5.6-sol", origin={"source": "chat"}
        )
        _ = upstream.content
        upstream.close()
        self.assertEqual(self._rows()[0]["outcome"], "quota_exhausted")

    def test_chat_completion_stream_tap_records_final_usage(self) -> None:
        chunks = [
            b'data: {"choices":[{"delta":{"content":"x"},"finish_reason":null}]}\n\n',
            b'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}\n\n',
            b"data: [DONE]\n\n",
        ]
        relayed = list(
            usage_ledger.tap_chat_completion_stream(
                iter(chunks),
                request_id="mreq_5",
                endpoint="chat.completions",
                provider="cliproxy",
                model="gemini-3.6-flash",
                origin={"source": "agent-turn"},
            )
        )
        self.assertEqual(relayed, chunks)
        row = self._rows()[0]
        self.assertEqual(row["provider"], "cliproxy")
        self.assertEqual(row["account"]["key"], "cliproxy")
        self.assertEqual(row["tokens"]["total"], 11)
        self.assertEqual(row["outcome"], "succeeded")

    def test_read_rows_and_summary_group_by_account_origin_and_window(self) -> None:
        old = SimpleNamespace(key="old", email="old@example.com", plan="pro")
        new = SimpleNamespace(key="new", email="new@example.com", plan="plus")
        usage_ledger.record_usage(kind="council", endpoint="council", provider="chatgpt", model="m", account=old,
                                  origin={"source": "learn", "taskType": "source_map"}, tokens={"input": 10, "output": 5, "reasoning": 0, "cached": 0, "total": 15}, outcome="succeeded")
        usage_ledger.record_usage(kind="chat", endpoint="chat.completions", provider="chatgpt", model="m", account=new,
                                  origin={"source": "chat"}, tokens={"input": 1, "output": 1, "reasoning": 0, "cached": 0, "total": 2}, outcome="succeeded")
        usage_ledger.record_usage(kind="voice", endpoint="voice.realtime", provider="chatgpt", model="codex-realtime", account=new,
                                  origin={"source": "voice"}, tokens=None, outcome="succeeded")
        rows = usage_ledger.read_rows(since=datetime.now(timezone.utc) - timedelta(minutes=1), limit=10)
        self.assertEqual([r["kind"] for r in rows], ["voice", "chat", "council"])
        only_new = usage_ledger.read_rows(limit=10, account="new@example.com")
        self.assertEqual(len(only_new), 2)
        summary = usage_ledger.summarize(rows)
        self.assertEqual(summary["requests"], 3)
        self.assertEqual(summary["tokens"]["total"], 17)
        accounts = {b["label"]: b for b in summary["byAccount"]}
        self.assertEqual(accounts["new@example.com"]["requests"], 2)
        self.assertEqual(accounts["new@example.com"]["windows"]["fiveHours"]["requests"], 2)
        self.assertEqual(accounts["old@example.com"]["tokens"]["total"], 15)
        self.assertEqual(accounts["old@example.com"]["origins"][0]["label"], "source_map")
        origins = {b["key"]: b for b in summary["byOrigin"]}
        self.assertIn("learn:source_map", origins)
        self.assertIn("voice", origins)

    def test_request_origin_infers_feature_without_a_request_context(self) -> None:
        self.assertEqual(usage_ledger.request_origin({"taskType": "small_revision"})["source"], "learn")
        self.assertEqual(usage_ledger.request_origin({"taskType": "page_assistant_answer"})["source"], "page-assistant")
        self.assertEqual(usage_ledger.request_origin({"model": "chat"})["source"], "chat")
        self.assertEqual(usage_ledger.request_origin({"model": "default"})["source"], "background")
        self.assertEqual(usage_ledger.request_origin({"model": "gpt-5.6-sol", "tools": [{"type": "function"}]})["source"], "agent-turn")
        self.assertEqual(usage_ledger.request_origin(kind="voice")["source"], "voice")


if __name__ == "__main__":
    unittest.main()
