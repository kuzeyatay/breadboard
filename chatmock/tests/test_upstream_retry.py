from __future__ import annotations

import os
import unittest
from unittest.mock import patch

import requests
from flask import Flask, jsonify, make_response

from chatmock.council.gateway import _empty_final_answer_message
from chatmock.council.types import CouncilRun
from chatmock.providers.chatgpt_upstream import ChatGptUpstreamProvider
from chatmock.providers.types import ModelCall, ProviderError
from chatmock.upstream import start_upstream_raw_request


class FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        self.closed = False

    def close(self) -> None:
        self.closed = True


class UpstreamRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = Flask(__name__)
        self.env = patch.dict(
            os.environ,
            {
                "CHATMOCK_UPSTREAM_MAX_ATTEMPTS": "3",
                "CHATMOCK_UPSTREAM_RETRY_BACKOFF_SECONDS": "0",
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def _start(self):
        return start_upstream_raw_request(
            {"model": "gpt-test", "input": [], "stream": True},
            session_id="session-test",
            stream=True,
        )

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_retries_502_until_a_request_succeeds(self, mock_post, _mock_auth) -> None:
        first = FakeResponse(502)
        second = FakeResponse(502)
        success = FakeResponse(200)
        mock_post.side_effect = [first, second, success]

        with self.app.test_request_context():
            upstream, error_response = self._start()

        self.assertIs(upstream, success)
        self.assertIsNone(error_response)
        self.assertEqual(mock_post.call_count, 3)
        self.assertTrue(first.closed)
        self.assertTrue(second.closed)
        self.assertEqual(mock_post.call_args.kwargs["timeout"], (30.0, 120.0))

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_returns_the_final_502_after_retry_budget_is_exhausted(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        responses = [FakeResponse(502), FakeResponse(502), FakeResponse(502)]
        mock_post.side_effect = responses

        with self.app.test_request_context():
            upstream, error_response = self._start()

        self.assertIs(upstream, responses[-1])
        self.assertIsNone(error_response)
        self.assertEqual(mock_post.call_count, 3)
        self.assertTrue(responses[0].closed)
        self.assertTrue(responses[1].closed)
        self.assertFalse(responses[2].closed)

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_retries_transport_timeouts_and_preserves_the_final_cause(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        mock_post.side_effect = [
            requests.ReadTimeout("read timed out"),
            requests.ReadTimeout("read timed out"),
            requests.ReadTimeout("read timed out"),
        ]

        with self.app.test_request_context():
            upstream, error_response = self._start()
            body = error_response.get_json()

        self.assertIsNone(upstream)
        self.assertEqual(error_response.status_code, 502)
        self.assertEqual(mock_post.call_count, 3)
        self.assertIn("failed after 3 attempts", body["error"]["message"])
        self.assertIn("ReadTimeout", body["error"]["message"])

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_does_not_retry_usage_limit_responses(self, mock_post, _mock_auth) -> None:
        limited = FakeResponse(429)
        mock_post.return_value = limited

        with self.app.test_request_context():
            upstream, error_response = self._start()

        self.assertIs(upstream, limited)
        self.assertIsNone(error_response)
        self.assertEqual(mock_post.call_count, 1)
        self.assertFalse(limited.closed)

    def test_timeout_diagnostic_is_actionable_without_leaking_raw_details(self) -> None:
        run = CouncilRun(
            id="crun_timeout",
            user_prompt="test",
            messages=[],
            council_mode="direct_council",
            diagnostics={
                "error": (
                    "chatgpt upstream unavailable for gpt-test: Upstream ChatGPT request "
                    "failed after 3 attempts: ReadTimeout: secret transport detail"
                ),
            },
        )

        message = _empty_final_answer_message(run)

        self.assertIn("timed out after automatic retries", message)
        self.assertNotIn("secret transport detail", message)

    @patch("chatmock.providers.chatgpt_upstream.start_upstream_request")
    def test_council_provider_preserves_transport_failure_cause(self, mock_start) -> None:
        with self.app.test_request_context():
            error_response = make_response(
                jsonify(
                    {
                        "error": {
                            "message": (
                                "Upstream ChatGPT request failed after 3 attempts: "
                                "ReadTimeout: read timed out"
                            ),
                        },
                    }
                ),
                502,
            )
            mock_start.return_value = (None, error_response)

            with self.assertRaisesRegex(
                ProviderError,
                "failed after 3 attempts: ReadTimeout",
            ):
                ChatGptUpstreamProvider().call_model(
                    ModelCall(
                        model="gpt-test",
                        messages=[{"role": "user", "content": "hello"}],
                    )
                )

    def test_502_diagnostic_reports_temporary_upstream_failure(self) -> None:
        run = CouncilRun(
            id="crun_502",
            user_prompt="test",
            messages=[],
            council_mode="direct_council",
            diagnostics={
                "error": "chatgpt upstream returned HTTP 502 for gpt-test after automatic retries",
            },
        )

        message = _empty_final_answer_message(run)

        self.assertIn("temporarily unavailable after automatic retries", message)


if __name__ == "__main__":
    unittest.main()
