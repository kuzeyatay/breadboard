from __future__ import annotations

import os
import unittest
from unittest.mock import patch

import requests
from flask import Flask

from chatmock.accounts import ChatGptAccount
from chatmock.council.gateway import _empty_final_answer_message
from chatmock.council.types import CouncilRun
from chatmock.providers.chatgpt_upstream import ChatGptUpstreamProvider
from chatmock.providers.types import ModelCall, ProviderError
from chatmock.upstream import start_upstream_raw_request


class FakeResponse:
    def __init__(self, status_code: int, body: dict | None = None) -> None:
        self.status_code = status_code
        self._body = body or {}
        self.headers = {}
        self.closed = False

    def json(self):
        return self._body

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

    def _start(self, *, strict_single_attempt: bool = False):
        return start_upstream_raw_request(
            {"model": "gpt-test", "input": [], "stream": True},
            session_id="session-test",
            stream=True,
            strict_single_attempt=strict_single_attempt,
        )

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_unqualified_502_is_returned_without_replay(self, mock_post, _mock_auth) -> None:
        first = FakeResponse(502)
        success = FakeResponse(200)
        mock_post.side_effect = [first, success]

        with self.app.test_request_context():
            upstream, error_response = self._start()

        self.assertIs(upstream, first)
        self.assertIsNone(error_response)
        self.assertEqual(mock_post.call_count, 1)
        self.assertFalse(first.closed)
        self.assertEqual(mock_post.call_args.kwargs["timeout"], (30.0, 120.0))

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_unqualified_http_failures_are_never_replayed(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        for status in (408, 500, 502, 503, 504):
            with self.subTest(status=status):
                failed = FakeResponse(status)
                success = FakeResponse(200)
                mock_post.reset_mock(side_effect=True)
                mock_post.side_effect = [failed, success]

                with self.app.test_request_context():
                    upstream, error_response = self._start()

                self.assertIs(upstream, failed)
                self.assertIsNone(error_response)
                self.assertEqual(mock_post.call_count, 1)
                self.assertFalse(failed.closed)

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_read_timeout_fails_closed_and_preserves_the_failure_kind(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        mock_post.side_effect = [
            requests.ReadTimeout("read timed out"),
            FakeResponse(200),
        ]

        with self.app.test_request_context():
            upstream, error_response = self._start()
            body = error_response.get_json()

        self.assertIsNone(upstream)
        self.assertEqual(error_response.status_code, 502)
        self.assertEqual(mock_post.call_count, 1)
        self.assertIn("failed without replay", body["error"]["message"])
        self.assertIn("ReadTimeout", body["error"]["message"])
        self.assertNotIn("read timed out", body["error"]["message"])

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_strict_connection_refusal_can_retry_before_send(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        success = FakeResponse(200)
        mock_post.side_effect = [
            requests.ConnectionError(
                ConnectionRefusedError(10061, "connection refused")
            ),
            success,
        ]

        with self.app.test_request_context():
            upstream, error_response = self._start()

        self.assertIs(upstream, success)
        self.assertIsNone(error_response)
        self.assertEqual(mock_post.call_count, 2)

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_learn_strict_route_disables_even_preconnect_replay(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        mock_post.side_effect = [
            requests.ConnectionError(ConnectionRefusedError(10061, "connection refused")),
            FakeResponse(200),
        ]
        with self.app.test_request_context():
            upstream, error_response = self._start(strict_single_attempt=True)
        self.assertIsNone(upstream)
        self.assertEqual(error_response.status_code, 502)
        self.assertEqual(mock_post.call_count, 1)

    @patch("chatmock.upstream.get_effective_chatgpt_auth", return_value=("token", "account"))
    @patch("chatmock.upstream.requests.post")
    def test_mixed_refusal_and_reset_evidence_fails_closed(
        self,
        mock_post,
        _mock_auth,
    ) -> None:
        mock_post.side_effect = [
            requests.ConnectionError(
                ConnectionRefusedError(10061, "connection refused"),
                ConnectionResetError(10054, "connection reset"),
            ),
            FakeResponse(200),
        ]

        with self.app.test_request_context():
            upstream, error_response = self._start()

        self.assertIsNone(upstream)
        self.assertEqual(error_response.status_code, 502)
        self.assertEqual(mock_post.call_count, 1)

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

    def test_quota_observer_failure_preserves_the_exact_http_response(self) -> None:
        primary = ChatGptAccount(
            key="primary",
            path="primary.json",
            auth={"tokens": {"access_token": "first"}},
            email=None,
            plan="pro",
            primary=True,
        )
        limited = FakeResponse(
            429,
            {"error": {"message": "authoritative quota response"}},
        )
        with (
            patch("chatmock.upstream.select_account", return_value=primary),
            patch(
                "chatmock.upstream.get_effective_chatgpt_auth",
                return_value=("token", "account"),
            ),
            patch("chatmock.upstream.requests.post", return_value=limited),
            patch(
                "chatmock.upstream.note_account_exhausted",
                side_effect=RuntimeError("cooldown observer failed"),
            ),
            patch("chatmock.upstream._retry_with_next_account", return_value=None),
        ):
            with self.app.test_request_context():
                upstream, error_response = self._start()

        self.assertIs(upstream, limited)
        self.assertIsNone(error_response)
        self.assertFalse(limited.closed)

    def test_replacement_account_ambiguous_failure_replaces_original_429(self) -> None:
        primary = ChatGptAccount(
            key="primary",
            path="primary.json",
            auth={"tokens": {"access_token": "first"}},
            email=None,
            plan="pro",
            primary=True,
        )
        replacement = ChatGptAccount(
            key="replacement",
            path="replacement.json",
            auth={"tokens": {"access_token": "second"}},
            email=None,
            plan="pro",
            primary=False,
        )
        limited = FakeResponse(
            429,
            {"error": {"message": "primary quota exhausted"}},
        )

        with (
            patch(
                "chatmock.upstream.select_account",
                side_effect=[primary, replacement],
            ),
            patch(
                "chatmock.upstream.get_effective_chatgpt_auth",
                side_effect=[("first-token", "first-id"), ("second-token", "second-id")],
            ),
            patch("chatmock.upstream.note_account_exhausted"),
            patch(
                "chatmock.upstream.requests.post",
                side_effect=[limited, requests.ReadTimeout("secret transport detail")],
            ) as mock_post,
        ):
            with self.app.test_request_context():
                upstream, error_response = self._start()
                body = error_response.get_json()

        self.assertIsNone(upstream)
        self.assertEqual(error_response.status_code, 502)
        self.assertEqual(mock_post.call_count, 2)
        self.assertTrue(limited.closed)
        self.assertIn("failed without replay", body["error"]["message"])
        self.assertIn("ReadTimeout", body["error"]["message"])
        self.assertNotIn("secret transport detail", body["error"]["message"])

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

        self.assertIn("timed out before the response completed", message)
        self.assertNotIn("secret transport detail", message)

    @patch(
        "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
        return_value=("token", "account"),
    )
    @patch("chatmock.providers.chatgpt_upstream.select_account", return_value=None)
    @patch(
        "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
        side_effect=requests.ReadTimeout("secret read detail"),
    )
    def test_council_provider_wraps_transport_failure_without_replay(
        self,
        mock_connect,
        _mock_account,
        _mock_auth,
    ) -> None:
        with self.assertRaises(ProviderError) as raised:
            ChatGptUpstreamProvider().call_model(
                ModelCall(
                    model="gpt-test",
                    messages=[{"role": "user", "content": "hello"}],
                )
            )

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.phase, "connect")
        self.assertEqual(raised.exception.code, "connection_failed")
        self.assertFalse(raised.exception.partial_output)
        self.assertNotIn("secret read detail", str(raised.exception))
        self.assertEqual(mock_connect.call_count, 1)

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

        self.assertIn("temporarily unavailable", message)
        self.assertNotIn("automatic retries", message)


    def test_exhausted_routes_name_credit_and_quota_refusals(self) -> None:
        # The concept-extraction run that failed the Feynman Vol. II ingestion:
        # the requested OpenRouter stealth model 429'd, the Codex fallback hit
        # its weekly window, and the OpenRouter fallback answered 402 because
        # the account could afford ~1k tokens. Only the last error reached the
        # diagnostics, and it matched none of the wording branches.
        run = CouncilRun(
            id="crun_exhausted",
            user_prompt="test",
            messages=[],
            council_mode="direct_council",
            diagnostics={
                "error": (
                    "This request requires more credits, or fewer max_tokens. "
                    "You requested up to 64000 tokens, but can only afford 1185."
                ),
            },
        )
        run.record_model_attempts(
            [
                {
                    "resolvedModel": "openrouter/stealth/union-alpha",
                    "provider": "openrouter",
                    "outcome": "quota_exhausted",
                    "statusCode": 429,
                    "error": "Provider returned error",
                },
                {
                    "resolvedModel": "gpt-5.6-sol",
                    "provider": "chatgpt",
                    "outcome": "quota_exhausted",
                    "fallback": True,
                    "statusCode": 429,
                },
                {
                    "resolvedModel": "openrouter/anthropic/claude-sonnet-4.5",
                    "provider": "openrouter",
                    "outcome": "failed",
                    "fallback": True,
                    "statusCode": 402,
                    "error": "This request requires more credits, or fewer max_tokens.",
                },
            ]
        )

        message = _empty_final_answer_message(run)

        self.assertIn("out of quota or credits", message)
        self.assertIn("openrouter/stealth/union-alpha has reached its usage limit (HTTP 429)", message)
        self.assertIn("gpt-5.6-sol has reached its usage limit (HTTP 429)", message)
        self.assertIn(
            "openrouter/anthropic/claude-sonnet-4.5 needs more provider credits (HTTP 402)",
            message,
        )
        self.assertNotIn("all candidate models failed", message)
        self.assertNotIn("64000", message)

    def test_mixed_route_failures_keep_generic_wording(self) -> None:
        run = CouncilRun(
            id="crun_mixed",
            user_prompt="test",
            messages=[],
            council_mode="direct_council",
            diagnostics={"error": "chatgpt upstream returned an unexpected payload"},
        )
        run.record_model_attempts(
            [
                {"resolvedModel": "a", "outcome": "quota_exhausted", "statusCode": 429},
                {"resolvedModel": "b", "outcome": "failed", "statusCode": 500},
            ]
        )

        message = _empty_final_answer_message(run)

        self.assertIn("all candidate models failed", message)


if __name__ == "__main__":
    unittest.main()


class QuotaDetailTests(unittest.TestCase):
    """A 429's reset time decides how long the account rests, not a default."""

    def test_body_reset_seconds_are_carried_into_the_cooldown(self) -> None:
        from chatmock.upstream import _quota_detail

        limited = FakeResponse(
            429,
            {
                "error": {
                    "type": "usage_limit_reached",
                    "message": "The usage limit has been reached",
                    "resets_in_seconds": 382846,
                }
            },
        )
        # A reset days away can only be the weekly window. Saying so is what
        # stops a reader from checking the (nearly empty) five-hour meter.
        self.assertEqual(
            _quota_detail(limited),
            ("The weekly Codex usage limit has been reached", 382846),
        )

    def test_a_short_reset_without_headers_keeps_the_backend_wording(self) -> None:
        from chatmock.upstream import _quota_detail

        limited = FakeResponse(
            429,
            {"error": {"message": "The usage limit has been reached", "resets_in_seconds": 1200}},
        )
        # Twenty minutes out could be either window; do not guess.
        self.assertEqual(_quota_detail(limited), ("The usage limit has been reached", 1200))

    def test_headers_name_the_five_hour_window(self) -> None:
        from chatmock.upstream import _quota_detail

        limited = FakeResponse(429, {"error": {"message": "The usage limit has been reached"}})
        limited.headers = {
            "x-codex-primary-used-percent": "100",
            "x-codex-primary-window-minutes": "300",
            "x-codex-primary-reset-after-seconds": "1200",
            "x-codex-secondary-used-percent": "40",
            "x-codex-secondary-window-minutes": "10080",
            "x-codex-secondary-reset-after-seconds": "382846",
        }
        self.assertEqual(
            _quota_detail(limited),
            ("The 5-hour Codex usage limit has been reached", 1200),
        )

    def test_headers_name_the_spent_window_when_the_body_does_not(self) -> None:
        from chatmock.upstream import _quota_detail

        limited = FakeResponse(429, {"error": {"message": "Too many requests"}})
        limited.headers = {
            "x-codex-primary-used-percent": "100",
            "x-codex-primary-window-minutes": "10080",
            "x-codex-primary-reset-after-seconds": "382846",
            "x-codex-secondary-used-percent": "0",
            "x-codex-secondary-window-minutes": "0",
            "x-codex-secondary-reset-after-seconds": "0",
        }
        self.assertEqual(
            _quota_detail(limited),
            ("The weekly Codex usage limit has been reached", 382846),
        )

    def test_a_bare_429_falls_back_to_the_default_rest(self) -> None:
        from chatmock.upstream import _quota_detail

        message, seconds = _quota_detail(FakeResponse(429, {}))
        self.assertEqual(message, "the plan's usage window is spent")
        self.assertIsNone(seconds)

    def test_websocket_error_event_is_read_the_same_way(self) -> None:
        from chatmock.providers.chatgpt_upstream import _event_quota_detail

        event = {
            "type": "error",
            "error": {
                "status_code": 429,
                "message": "The usage limit has been reached",
                "resets_in_seconds": "3600",
            },
        }
        self.assertEqual(_event_quota_detail(event), ("The usage limit has been reached", 3600))
        self.assertEqual(
            _event_quota_detail(None), ("the upstream account returned HTTP 429", None)
        )
