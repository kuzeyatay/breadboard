from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from chatmock.accounts import ChatGptAccount
from chatmock.council.policy import CouncilConfig
from chatmock.council.runtime import CouncilRuntime
from chatmock.council.types import CouncilInput, CouncilRun
from chatmock.model_telemetry import record_model_attempt, secret_free_audit_hash
from chatmock.providers.chatgpt_upstream import (
    DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
    DEFAULT_WEBSOCKET_TOTAL_TIMEOUT_SECONDS,
    ChatGptUpstreamProvider,
)
from chatmock.providers.router import ProviderRouter
from chatmock.providers.types import ModelCall, ModelTokenUsage, ProviderError


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeWebsocket:
    def __init__(
        self,
        frames: list[object],
        *,
        clock: FakeClock | None = None,
        advances: list[float] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.frames = list(frames)
        self.clock = clock
        self.advances = list(advances or [])
        self.response = SimpleNamespace(headers=headers or {})
        self.sent: list[str] = []
        self.recv_timeouts: list[float] = []
        self.closed = False

    def send(self, message: str) -> None:
        self.sent.append(message)

    def recv(self, timeout: float | None = None):
        self.recv_timeouts.append(float(timeout or 0))
        if self.advances:
            advance = self.advances.pop(0)
            if self.clock is not None:
                self.clock.advance(advance)
        if not self.frames:
            return None
        frame = self.frames.pop(0)
        if isinstance(frame, BaseException):
            raise frame
        if isinstance(frame, dict):
            return json.dumps(frame)
        return frame

    def close(self) -> None:
        self.closed = True


class ChatGptWebsocketProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.account = ChatGptAccount(
            key="selected-account",
            path="selected-auth.json",
            auth={"tokens": {"access_token": "stored-token"}},
            email="selected@example.test",
            plan="pro",
            primary=True,
        )

    @contextmanager
    def _transport(self, websocket: FakeWebsocket, *, auth=("access-token", "acct-1")):
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                return_value=self.account,
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=auth,
            ) as resolved_auth,
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=websocket,
            ) as connected,
            patch(
                "chatmock.providers.chatgpt_upstream.note_account_exhausted"
            ) as exhausted,
        ):
            yield selected, resolved_auth, connected, exhausted

    @staticmethod
    def _call(**overrides) -> ModelCall:
        values = {
            "model": "gpt-5.4",
            "messages": [{"role": "user", "content": "hello"}],
        }
        values.update(overrides)
        return ModelCall(**values)

    def test_success_preserves_auth_payload_text_reasoning_usage_and_close(self) -> None:
        websocket = FakeWebsocket(
            [
                {"type": "response.created", "response": {"id": "resp-1"}},
                {
                    "type": "response.reasoning_summary_text.delta",
                    "delta": "Checked ",
                },
                {
                    "type": "response.reasoning_summary_text.delta",
                    "delta": "carefully.",
                },
                {"type": "response.output_text.delta", "delta": "complete "},
                {"type": "response.output_text.delta", "delta": "answer"},
                {
                    "type": "response.completed",
                    "response": {
                        "id": "resp-1",
                        "usage": {
                            "input_tokens": 11,
                            "input_tokens_details": {"cached_tokens": 3},
                            "output_tokens": 7,
                            "output_tokens_details": {"reasoning_tokens": 2},
                            "total_tokens": 18,
                        },
                    },
                },
            ],
            headers={"x-codex-primary-used-percent": "7.5"},
        )
        call = self._call(reasoning_effort="high", reasoning_summary="detailed")

        with self._transport(websocket) as (_, resolved_auth, connected, _):
            text = ChatGptUpstreamProvider(
                reasoning_effort="low", reasoning_summary="none"
            ).call_model(call)

        self.assertEqual(text, "complete answer")
        self.assertEqual(call.reasoning_out, "Checked carefully.")
        self.assertEqual(
            call.usage_out,
            ModelTokenUsage(11, 7, 18, cached_input_tokens=3, reasoning_tokens=2),
        )
        resolved_auth.assert_called_once_with((self.account.auth, self.account.path))
        headers = connected.call_args.args[1]
        self.assertEqual(headers["Authorization"], "Bearer access-token")
        self.assertEqual(headers["chatgpt-account-id"], "acct-1")
        payload = json.loads(websocket.sent[0])
        self.assertEqual(payload["type"], "response.create")
        self.assertEqual(payload["model"], "gpt-5.4")
        self.assertEqual(payload["reasoning"], {"effort": "high", "summary": "detailed"})
        self.assertNotIn("include", payload)
        self.assertTrue(websocket.closed)

    def test_rate_limit_observer_failure_cannot_replace_a_model_result(self) -> None:
        websocket = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "valid answer"},
                {"type": "response.completed", "response": {"id": "resp-observer"}},
            ]
        )
        with (
            self._transport(websocket),
            patch(
                "chatmock.providers.chatgpt_upstream.record_rate_limits_from_response",
                side_effect=RuntimeError("rate-limit observer failed"),
            ),
        ):
            result = ChatGptUpstreamProvider().call_model(self._call())

        self.assertEqual(result, "valid answer")
        self.assertEqual(len(websocket.sent), 1)

    def test_quota_observer_failure_preserves_terminal_provider_error(self) -> None:
        websocket = FakeWebsocket(
            [
                {
                    "type": "response.failed",
                    "response": {
                        "error": {
                            "status_code": 429,
                            "code": "usage_limit_reached",
                        }
                    },
                }
            ]
        )
        with self._transport(websocket) as (_, _, connected, exhausted):
            exhausted.side_effect = RuntimeError("cooldown observer failed")
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(self._call())

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.code, "response_failed")
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(len(websocket.sent), 1)

    def test_replacement_account_observer_failure_preserves_terminal_error(self) -> None:
        websocket = FakeWebsocket(
            [
                {
                    "type": "error",
                    "status_code": 429,
                    "error": {"code": "usage_limit_reached"},
                }
            ]
        )
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[
                    self.account,
                    RuntimeError("account-state observer failed"),
                ],
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "account-id"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=websocket,
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(self._call())

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.code, "error_event")
        self.assertEqual(connected.call_count, 1)

    def test_completed_response_body_is_used_when_delta_frames_are_absent(self) -> None:
        websocket = FakeWebsocket(
            [
                {
                    "type": "response.completed",
                    "response": {
                        "output": [
                            {
                                "type": "reasoning",
                                "summary": [{"type": "summary_text", "text": "Reasoned."}],
                            },
                            {
                                "type": "message",
                                "content": [{"type": "output_text", "text": "Final body"}],
                            },
                        ]
                    },
                }
            ]
        )
        call = self._call()

        with self._transport(websocket):
            text = ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(text, "Final body")
        self.assertEqual(call.reasoning_out, "Reasoned.")
        self.assertTrue(websocket.closed)

    def test_healthy_stream_can_run_for_more_than_900_seconds(self) -> None:
        clock = FakeClock()
        websocket = FakeWebsocket(
            [
                {"type": "response.created", "response": {"id": "long"}},
                {"type": "response.output_text.delta", "delta": "still healthy"},
                {"type": "response.completed", "response": {"id": "long"}},
            ],
            clock=clock,
            advances=[500, 500, 500],
        )
        provider = ChatGptUpstreamProvider(
            idle_timeout_seconds=1_000,
            total_timeout_seconds=2_000,
            clock=clock,
        )

        with self._transport(websocket):
            text = provider.call_model(self._call())

        self.assertEqual(text, "still healthy")
        self.assertEqual(clock.now, 1_500)
        self.assertTrue(all(timeout >= 500 for timeout in websocket.recv_timeouts))
        self.assertGreater(DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS, 900)
        self.assertGreater(DEFAULT_WEBSOCKET_TOTAL_TIMEOUT_SECONDS, 900)

    def test_zero_output_receive_close_fails_closed_without_replay(self) -> None:
        websocket = FakeWebsocket([RuntimeError("secret close reason")])
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                return_value=self.account,
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "acct-1"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=websocket,
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted") as exhausted,
        ):
            call = self._call()
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        error = raised.exception
        self.assertEqual(error.status_code, 502)
        self.assertEqual(error.phase, "receive")
        self.assertEqual(error.code, "connection_closed")
        self.assertFalse(error.partial_output)
        self.assertFalse(error.replay_safe)
        self.assertNotIn("secret close reason", str(error))
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(selected.call_count, 1)
        exhausted.assert_not_called()
        self.assertEqual(len(websocket.sent), 1)
        self.assertTrue(websocket.closed)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_partial_output_receive_close_fails_closed_without_replay(self) -> None:
        interrupted = FakeWebsocket(
            [
                {"type": "response.created", "response": {"id": "orphan"}},
                {"type": "response.reasoning_summary_text.delta", "delta": "orphan reasoning"},
                {"type": "response.output_text.delta", "delta": "orphan answer"},
                RuntimeError("private close reason"),
            ]
        )
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                return_value=self.account,
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "acct-1"),
            ) as resolved_auth,
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=interrupted,
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted") as exhausted,
        ):
            call = self._call()
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(raised.exception.phase, "receive")
        self.assertEqual(raised.exception.code, "connection_closed")
        self.assertTrue(raised.exception.partial_output)
        self.assertFalse(raised.exception.replay_safe)
        self.assertNotIn("private close reason", str(raised.exception))
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(selected.call_count, 1)
        self.assertEqual(resolved_auth.call_count, 1)
        exhausted.assert_not_called()
        self.assertEqual(len(interrupted.sent), 1)
        self.assertTrue(interrupted.closed)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_none_receive_close_fails_closed_without_replay(self) -> None:
        websocket = FakeWebsocket([None])
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                return_value=self.account,
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "acct-1"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=websocket,
            ) as connected,
        ):
            call = self._call()
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(raised.exception.code, "connection_closed")
        self.assertFalse(raised.exception.partial_output)
        self.assertFalse(raised.exception.replay_safe)
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(selected.call_count, 1)
        self.assertEqual(len(websocket.sent), 1)
        self.assertTrue(websocket.closed)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_oversized_receive_close_is_sanitized_without_replay(self) -> None:
        class OversizedClose(RuntimeError):
            def __init__(self, secret: str) -> None:
                super().__init__(secret)
                self.rcvd = None
                self.sent = SimpleNamespace(code=1009)

        websocket = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "orphan"},
                OversizedClose("private oversized frame detail"),
            ]
        )
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                return_value=self.account,
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "acct-1"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=websocket,
            ) as connected,
        ):
            call = self._call()
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(connected.call_count, 1)
        self.assertEqual(raised.exception.code, "message_too_large")
        self.assertEqual(raised.exception.websocket_close_code, 1009)
        self.assertTrue(raised.exception.partial_output)
        self.assertFalse(raised.exception.replay_safe)
        self.assertNotIn("private", str(raised.exception))
        self.assertEqual(len(websocket.sent), 1)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_partial_output_quota_event_does_not_switch_account_or_replay(self) -> None:
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email="replacement@example.test",
            plan="pro",
            primary=False,
        )
        websocket = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "partial"},
                {"type": "error", "status_code": 429, "error": {"code": "quota"}},
            ]
        )
        call = self._call(request_id="req-partial-quota")
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "acct-1"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=websocket,
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(raised.exception.status_code, 429)
        self.assertTrue(raised.exception.partial_output)
        self.assertEqual(selected.call_count, 1)
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(len(websocket.sent), 1)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_pre_output_quota_switches_once_to_the_next_selected_account(self) -> None:
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email="replacement@example.test",
            plan="pro",
            primary=False,
        )
        limited = FakeWebsocket(
            [
                {
                    "type": "response.failed",
                    "response": {
                        "error": {
                            "code": "usage_limit_reached",
                            "status_code": 429,
                        }
                    },
                }
            ]
        )
        served = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "served"},
                {"type": "response.completed", "response": {"id": "replacement"}},
            ]
        )

        def auth_for(selection):
            auth, _path = selection
            if auth is self.account.auth:
                return "first-token", "first-id"
            return "second-token", "second-id"

        call = self._call(
            request_id="req-response-failed-handoff",
            reasoning_effort="high",
        )
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                side_effect=auth_for,
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=[limited, served],
            ) as connected,
            patch(
                "chatmock.providers.chatgpt_upstream.note_account_exhausted"
            ) as exhausted,
        ):
            text = ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(text, "served")
        self.assertEqual(connected.call_count, 2)
        self.assertEqual(
            connected.call_args_list[0].args[1]["Authorization"],
            "Bearer first-token",
        )
        self.assertEqual(
            connected.call_args_list[1].args[1]["Authorization"],
            "Bearer second-token",
        )
        first_payload = json.loads(limited.sent[0])
        second_payload = json.loads(served.sent[0])
        self.assertEqual(first_payload["model"], second_payload["model"])
        self.assertEqual(first_payload["reasoning"], second_payload["reasoning"])
        exhausted.assert_called_once_with(
            "selected-account", reason="the upstream account returned HTTP 429"
        )
        self.assertTrue(limited.closed)
        self.assertTrue(served.closed)
        handoff = call.transport_recoveries_out[0]
        self.assertEqual(handoff["type"], "quota_account_handoff")
        self.assertEqual(handoff["terminalEvent"], "response.failed")
        self.assertEqual(handoff["terminalStatus"], 429)
        self.assertEqual(handoff["terminalCode"], "usage_limit_reached")
        self.assertFalse(handoff["accepted"])
        self.assertTrue(handoff["replaySafe"])

    def test_strict_bound_call_never_switches_chatgpt_accounts_after_429(self) -> None:
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email="replacement@example.test",
            plan="pro",
            primary=False,
        )
        limited = FakeWebsocket(
            [{
                "type": "response.failed",
                "response": {
                    "error": {
                        "code": "usage_limit_reached",
                        "status_code": 429,
                    }
                },
            }]
        )
        served = FakeWebsocket([
            {"type": "response.output_text.delta", "delta": "must-not-run"},
            {"type": "response.completed", "response": {"id": "replacement"}},
        ])
        call = self._call(
            request_id="req-strict-no-account-handoff",
            allow_account_failover=False,
        )
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("first-token", "first-id"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=[limited, served],
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(selected.call_count, 1)
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(len(limited.sent), 1)
        self.assertEqual(served.sent, [])
        self.assertEqual(call.transport_recoveries_out, [])

    def test_quota_terminal_payload_with_embedded_answer_cannot_handoff(self) -> None:
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email=None,
            plan="pro",
            primary=False,
        )
        failed_with_output = FakeWebsocket(
            [
                {
                    "type": "response.failed",
                    "response": {
                        "error": {
                            "code": "usage_limit_reached",
                            "status_code": 429,
                        },
                        "output": [
                            {
                                "type": "message",
                                "content": [
                                    {"type": "output_text", "text": "embedded answer"}
                                ],
                            }
                        ],
                    },
                }
            ]
        )
        call = self._call(request_id="req-quota-with-output")
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "account-id"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=failed_with_output,
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertTrue(raised.exception.partial_output)
        self.assertFalse(raised.exception.replay_safe)
        self.assertEqual(selected.call_count, 1)
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_unrendered_output_event_before_quota_cannot_handoff(self) -> None:
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email=None,
            plan="pro",
            primary=False,
        )
        failed_after_output_item = FakeWebsocket(
            [
                {
                    "type": "response.output_item.done",
                    "item": {
                        "type": "message",
                        "content": [
                            {"type": "output_text", "text": "unrendered answer"}
                        ],
                    },
                },
                {
                    "type": "error",
                    "status_code": 429,
                    "error": {"code": "usage_limit_reached"},
                },
            ]
        )
        call = self._call(request_id="req-quota-after-output-item")
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ) as selected,
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "account-id"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                return_value=failed_after_output_item,
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(call)

        self.assertTrue(raised.exception.partial_output)
        self.assertFalse(raised.exception.replay_safe)
        self.assertEqual(selected.call_count, 1)
        self.assertEqual(connected.call_count, 1)
        self.assertEqual(call.transport_recoveries_out, [])

    def test_account_switch_connect_is_bounded_by_remaining_total_deadline(self) -> None:
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email=None,
            plan="pro",
            primary=False,
        )
        clock = FakeClock()
        limited = FakeWebsocket(
            [{"type": "error", "status_code": 429, "error": {"code": "quota"}}],
            clock=clock,
            advances=[1_795],
        )
        connect_timeouts: list[float] = []

        def connect(_url, _headers, *, open_timeout):
            connect_timeouts.append(open_timeout)
            if len(connect_timeouts) == 1:
                return limited
            clock.advance(open_timeout)
            raise TimeoutError()

        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("token", "account-id"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=connect,
            ),
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider(
                    total_timeout_seconds=1_800,
                    clock=clock,
                ).call_model(self._call())

        self.assertEqual(connect_timeouts, [30.0, 5.0])
        self.assertEqual(raised.exception.code, "total_timeout")
        self.assertEqual(raised.exception.status_code, 504)
        self.assertEqual(raised.exception.elapsed_seconds, 1_800)

    def test_handshake_quota_handoff_emits_pre_send_receipt(self) -> None:
        class HandshakeQuotaError(RuntimeError):
            status_code = 429
            code = "usage_limit_reached"

        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email=None,
            plan="pro",
            primary=False,
        )
        served = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "served"},
                {"type": "response.completed", "response": {"id": "replacement"}},
            ]
        )
        call = self._call(request_id="req-handshake-handoff")

        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "account-id"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=[HandshakeQuotaError(), served],
            ) as connected,
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
        ):
            text = ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(text, "served")
        self.assertEqual(connected.call_count, 2)
        self.assertEqual(len(served.sent), 1)
        handoff = call.transport_recoveries_out[0]
        self.assertEqual(handoff["type"], "quota_account_handoff")
        self.assertEqual(
            handoff["terminalEvent"],
            "websocket.handshake_rejected",
        )
        self.assertEqual(handoff["terminalStatus"], 429)
        self.assertEqual(handoff["terminalCode"], "usage_limit_reached")
        self.assertFalse(handoff["accepted"])
        self.assertTrue(handoff["replaySafe"])

    def test_failed_and_error_events_are_distinct_safe_failures(self) -> None:
        cases = [
            (
                {
                    "type": "response.failed",
                    "response": {
                        "error": {
                            "code": "server_error",
                            "message": "secret provider diagnostic",
                            "status_code": 503,
                        }
                    },
                },
                "response_failed",
                503,
            ),
            (
                {
                    "type": "error",
                    "status_code": 400,
                    "error": {
                        "code": "invalid_request",
                        "message": "secret echoed prompt",
                    },
                },
                "error_event",
                400,
            ),
        ]

        for event, expected_code, expected_status in cases:
            with self.subTest(expected_code):
                websocket = FakeWebsocket(
                    [
                        {"type": "response.output_text.delta", "delta": "partial"},
                        event,
                    ]
                )
                call = self._call()
                with self._transport(websocket):
                    with self.assertRaises(ProviderError) as raised:
                        ChatGptUpstreamProvider().call_model(call)
                self.assertEqual(raised.exception.code, expected_code)
                self.assertEqual(raised.exception.status_code, expected_status)
                self.assertEqual(raised.exception.phase, "upstream")
                self.assertTrue(raised.exception.partial_output)
                self.assertFalse(raised.exception.replay_safe)
                self.assertNotIn("secret", str(raised.exception))
                self.assertTrue(websocket.closed)

    def test_incomplete_is_terminal_and_returns_its_partial_output_and_usage(self) -> None:
        websocket = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "partial"},
                {
                    "type": "response.incomplete",
                    "response": {
                        "incomplete_details": {"reason": "max_output_tokens"},
                        "usage": {
                            "input_tokens": 9,
                            "output_tokens": 4,
                            "total_tokens": 13,
                        },
                    },
                },
            ]
        )
        call = self._call()

        with self._transport(websocket):
            text = ChatGptUpstreamProvider().call_model(call)

        self.assertEqual(text, "partial")
        self.assertEqual(call.usage_out, ModelTokenUsage(9, 4, 13))
        self.assertTrue(websocket.closed)

    def test_malformed_frame_is_a_protocol_failure(self) -> None:
        websocket = FakeWebsocket(["not-json"])

        with self._transport(websocket):
            with self.assertRaises(ProviderError) as raised:
                ChatGptUpstreamProvider().call_model(self._call())

        self.assertEqual(raised.exception.phase, "protocol")
        self.assertEqual(raised.exception.code, "malformed_frame")
        self.assertFalse(raised.exception.partial_output)
        self.assertTrue(websocket.closed)

    def test_idle_and_total_timeouts_are_distinguished(self) -> None:
        idle_clock = FakeClock()
        idle_socket = FakeWebsocket([TimeoutError()], clock=idle_clock)
        idle_provider = ChatGptUpstreamProvider(
            idle_timeout_seconds=1_000,
            total_timeout_seconds=3_000,
            clock=idle_clock,
        )
        with self._transport(idle_socket):
            with self.assertRaises(ProviderError) as idle_raised:
                idle_provider.call_model(self._call())
        self.assertEqual(idle_raised.exception.code, "idle_timeout")
        self.assertEqual(idle_raised.exception.status_code, 504)
        self.assertFalse(idle_raised.exception.replay_safe)

        total_clock = FakeClock()
        total_socket = FakeWebsocket(
            [
                {"type": "response.created", "response": {"id": "slow"}},
                TimeoutError(),
            ],
            clock=total_clock,
            advances=[1_500, 0],
        )
        total_provider = ChatGptUpstreamProvider(
            idle_timeout_seconds=1_600,
            total_timeout_seconds=2_000,
            clock=total_clock,
        )
        with self._transport(total_socket):
            with self.assertRaises(ProviderError) as total_raised:
                total_provider.call_model(self._call())
        self.assertEqual(total_raised.exception.code, "total_timeout")
        self.assertEqual(total_raised.exception.elapsed_seconds, 1_500)
        self.assertFalse(total_raised.exception.replay_safe)
        self.assertEqual(total_socket.recv_timeouts[-1], 500)
        self.assertTrue(idle_socket.closed)
        self.assertTrue(total_socket.closed)

    def test_connector_uses_an_explicit_bounded_terminal_frame_limit(self) -> None:
        from chatmock.upstream import connect_upstream_websocket

        connection = object()
        ssl_context = object()
        with (
            patch.dict(
                os.environ,
                {"CHATMOCK_UPSTREAM_WEBSOCKET_MAX_MESSAGE_BYTES": "33554432"},
            ),
            patch("chatmock.upstream.websocket_connect", return_value=connection) as connected,
            patch(
                "chatmock.upstream.build_upstream_websocket_ssl_context",
                return_value=ssl_context,
            ),
        ):
            result = connect_upstream_websocket(
                "wss://example.test/responses",
                {"Authorization": "Bearer redacted"},
                open_timeout=12,
            )

        self.assertIs(result, connection)
        self.assertEqual(connected.call_args.kwargs["max_size"], 32 * 1024 * 1024)
        self.assertEqual(connected.call_args.kwargs["open_timeout"], 12)
        self.assertIs(connected.call_args.kwargs["ssl"], ssl_context)

    def test_each_call_gets_an_independent_socket(self) -> None:
        first = FakeWebsocket(
            [{"type": "response.completed", "response": {"output": []}}]
        )
        second = FakeWebsocket(
            [{"type": "response.completed", "response": {"output": []}}]
        )
        with (
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                return_value=self.account,
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                return_value=("access-token", "acct-1"),
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=[first, second],
            ) as connected,
        ):
            provider = ChatGptUpstreamProvider()
            provider.call_model(self._call())
            provider.call_model(self._call(messages=[{"role": "user", "content": "second"}]))

        self.assertEqual(connected.call_count, 2)
        self.assertTrue(first.closed)
        self.assertTrue(second.closed)
        self.assertEqual(len(first.sent), 1)
        self.assertEqual(len(second.sent), 1)

    def test_missing_auth_and_quota_are_structured(self) -> None:
        websocket = FakeWebsocket([])
        with self._transport(websocket, auth=(None, None)) as (_, _, connected, _):
            with self.assertRaises(ProviderError) as missing:
                ChatGptUpstreamProvider().call_model(self._call())
        self.assertEqual(missing.exception.status_code, 401)
        self.assertEqual(missing.exception.phase, "auth")
        self.assertTrue(missing.exception.replay_safe)
        connected.assert_not_called()

        quota_socket = FakeWebsocket(
            [
                {
                    "type": "error",
                    "status_code": 429,
                    "error": {"code": "usage_limit_reached"},
                }
            ]
        )
        with self._transport(quota_socket) as (_, _, _, exhausted):
            with self.assertRaises(ProviderError) as quota:
                ChatGptUpstreamProvider().call_model(self._call())
        self.assertEqual(quota.exception.status_code, 429)
        self.assertTrue(quota.exception.replay_safe)
        exhausted.assert_called_once_with(
            "selected-account", reason="the upstream account returned HTTP 429"
        )

    def test_router_records_structured_transport_metadata(self) -> None:
        telemetry = tempfile.TemporaryDirectory()
        self.addCleanup(telemetry.cleanup)

        class FailingUpstream:
            def call_model(self, _call):
                raise ProviderError(
                    "safe failure",
                    status_code=504,
                    phase="receive",
                    partial_output=True,
                    code="idle_timeout",
                    elapsed_seconds=901.455,
                )

        call = self._call(request_id="req-transport")
        with (
            patch.dict(
                os.environ,
                {
                    "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(
                        telemetry.name, "model-routing.jsonl"
                    )
                },
            ),
            patch("chatmock.providers.router.provider_health.note_failure", return_value=None),
        ):
            with self.assertRaises(ProviderError):
                ProviderRouter(CouncilConfig(), upstream=FailingUpstream()).call_model(call)

        attempt = call.model_attempts_out[0]
        self.assertEqual(attempt["statusCode"], 504)
        self.assertEqual(attempt["failurePhase"], "receive")
        self.assertTrue(attempt["partialOutput"])
        self.assertFalse(attempt["replaySafe"])
        self.assertEqual(attempt["errorCode"], "idle_timeout")
        self.assertEqual(attempt["elapsedSeconds"], 901.455)

    def test_model_telemetry_escapes_lone_surrogates_without_throwing(self) -> None:
        telemetry = tempfile.TemporaryDirectory()
        self.addCleanup(telemetry.cleanup)
        path = os.path.join(telemetry.name, "model-routing.jsonl")

        with patch.dict(
            os.environ,
            {"CHATMOCK_MODEL_TELEMETRY_FILE": path},
        ):
            entry = record_model_attempt(
                request_id="req-unicode",
                endpoint="council",
                requested_model="bad\ud800model",
                resolved_model="gpt-5.6-sol",
                upstream_model="gpt-5.6-sol",
                provider="chatgpt",
                outcome="succeeded",
                fallback=False,
            )

        self.assertEqual(entry["requestedModel"], "bad\ud800model")
        with open(path, encoding="utf-8") as handle:
            persisted = json.loads(handle.read())
        self.assertEqual(persisted["requestedModel"], "bad\ud800model")

    def test_router_telemetry_failure_cannot_replace_a_model_result(self) -> None:
        class SuccessfulUpstream:
            def call_model(self, _call):
                return "valid answer"

        call = self._call(request_id="req-observer-failure")
        with (
            patch(
                "chatmock.providers.router.record_model_attempt",
                side_effect=UnicodeEncodeError("utf-8", "\ud800", 0, 1, "surrogate"),
            ),
            patch("chatmock.providers.router.provider_health.note_success"),
            patch("chatmock.providers.router.dispatch.clear_recovered_model"),
        ):
            result = ProviderRouter(
                CouncilConfig(),
                upstream=SuccessfulUpstream(),
            ).call_model(call)

        self.assertEqual(result, "valid answer")
        self.assertEqual(call.model_attempts_out, [])

    def test_router_success_observers_cannot_replace_a_model_result(self) -> None:
        class SuccessfulUpstream:
            def call_model(self, _call):
                return "valid answer"

        observer_targets = (
            "chatmock.providers.router.provider_health.note_success",
            "chatmock.providers.router.dispatch.clear_recovered_model",
        )
        for target in observer_targets:
            with (
                self.subTest(target=target),
                patch(
                    "chatmock.providers.router.record_model_attempt",
                    return_value={"outcome": "succeeded"},
                ),
                patch(
                    "chatmock.providers.router.provider_health.note_success"
                ) as note_success,
                patch(
                    "chatmock.providers.router.dispatch.clear_recovered_model"
                ) as clear_recovered,
            ):
                failing = (
                    note_success
                    if target.endswith("note_success")
                    else clear_recovered
                )
                failing.side_effect = RuntimeError("observer failed")
                result = ProviderRouter(
                    CouncilConfig(),
                    upstream=SuccessfulUpstream(),
                ).call_model(self._call(request_id=f"req-{target.rsplit('.', 1)[-1]}"))

            self.assertEqual(result, "valid answer")

    def test_router_error_observers_preserve_the_exact_provider_error(self) -> None:
        original = ProviderError(
            "authoritative transport failure",
            status_code=502,
            phase="receive",
            code="connection_closed",
        )

        class FailingUpstream:
            def call_model(self, _call):
                raise original

        observer_targets = (
            "chatmock.providers.router.record_model_attempt",
            "chatmock.providers.router.provider_health.note_failure",
            "chatmock.providers.router.failover.is_quota_error",
        )
        for target in observer_targets:
            with (
                self.subTest(target=target),
                patch(
                    "chatmock.providers.router.record_model_attempt",
                    return_value={"outcome": "failed"},
                ) as telemetry,
                patch(
                    "chatmock.providers.router.provider_health.note_failure",
                    return_value=None,
                ) as note_failure,
                patch(
                    "chatmock.providers.router.failover.is_quota_error",
                    return_value=False,
                ) as quota_classifier,
            ):
                failing = {
                    observer_targets[0]: telemetry,
                    observer_targets[1]: note_failure,
                    observer_targets[2]: quota_classifier,
                }[target]
                failing.side_effect = RuntimeError("observer failed")
                with self.assertRaises(ProviderError) as raised:
                    ProviderRouter(
                        CouncilConfig(),
                        upstream=FailingUpstream(),
                    ).call_model(self._call(request_id="req-exact-error"))

            self.assertIs(raised.exception, original)

    def test_quota_cooldown_observer_failure_still_serves_safe_fallback(self) -> None:
        original = ProviderError(
            "usage limit reached",
            status_code=429,
            phase="upstream",
            replay_safe=True,
            code="response_failed",
        )

        class SequencedUpstream:
            def __init__(self) -> None:
                self.calls = 0

            def call_model(self, _call):
                self.calls += 1
                if self.calls == 1:
                    raise original
                return "fallback answer"

        upstream = SequencedUpstream()
        with (
            patch(
                "chatmock.providers.router.record_model_attempt",
                return_value={"outcome": "observed"},
            ),
            patch(
                "chatmock.providers.router.failover.note_exhausted",
                side_effect=RuntimeError("cooldown observer failed"),
            ),
            patch(
                "chatmock.providers.router.registry.healthy_fallbacks",
                return_value=["gpt-5.5"],
            ),
            patch("chatmock.providers.router.provider_health.note_success"),
            patch("chatmock.providers.router.dispatch.clear_recovered_model"),
        ):
            result = ProviderRouter(
                CouncilConfig(),
                upstream=upstream,
            ).call_model(self._call(request_id="req-quota-observer"))

        self.assertEqual(result, "fallback answer")
        self.assertEqual(upstream.calls, 2)

    def test_route_health_observer_failure_defaults_to_the_requested_route(self) -> None:
        class SuccessfulUpstream:
            def call_model(self, _call):
                return "requested answer"

        with (
            patch(
                "chatmock.providers.router.provider_health.is_unhealthy",
                side_effect=RuntimeError("health observer failed"),
            ),
            patch(
                "chatmock.providers.router.record_model_attempt",
                return_value={"outcome": "succeeded"},
            ),
            patch("chatmock.providers.router.provider_health.note_success"),
            patch("chatmock.providers.router.dispatch.clear_recovered_model"),
        ):
            result = ProviderRouter(
                CouncilConfig(),
                upstream=SuccessfulUpstream(),
            ).call_model(self._call(request_id="req-health-read"))

        self.assertEqual(result, "requested answer")

    def test_router_persists_real_request_bound_quota_handoff_receipt(self) -> None:
        telemetry = tempfile.TemporaryDirectory()
        self.addCleanup(telemetry.cleanup)
        replacement = ChatGptAccount(
            key="replacement-account",
            path="replacement-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email="replacement@example.test",
            plan="pro",
            primary=False,
        )
        limited = FakeWebsocket(
            [
                {
                    "type": "error",
                    "status_code": 429,
                    "error": {"code": "usage_limit_reached"},
                }
            ]
        )
        served = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "fresh answer"},
                {"type": "response.completed", "response": {"id": "replacement"}},
            ]
        )

        def auth_for(selection):
            auth, _path = selection
            if auth is self.account.auth:
                return "first-token", "first-id"
            return "second-token", "second-id"

        call = self._call(
            request_id="req-quota-handoff",
            client_requested_model="default",
        )
        telemetry_path = os.path.join(telemetry.name, "model-routing.jsonl")
        with (
            patch.dict(
                os.environ,
                {"CHATMOCK_MODEL_TELEMETRY_FILE": telemetry_path},
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                side_effect=auth_for,
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=[limited, served],
            ),
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
            patch("chatmock.providers.router.provider_health.note_success"),
            patch("chatmock.providers.router.dispatch.clear_recovered_model"),
        ):
            text = ProviderRouter(
                CouncilConfig(),
                upstream=ChatGptUpstreamProvider(),
            ).call_model(call)

        self.assertEqual(text, "fresh answer")
        attempt = call.model_attempts_out[0]
        self.assertEqual(attempt["requestId"], "req-quota-handoff")
        receipt = attempt["transportRecovery"]
        self.assertTrue(receipt["recovered"])
        self.assertEqual(receipt["count"], 1)
        self.assertEqual(receipt["types"], ["quota_account_handoff"])
        handoff = receipt["quotaAccountHandoffs"][0]
        self.assertEqual(handoff["type"], "quota_account_handoff")
        self.assertEqual(
            handoff["evidence"],
            "explicit_terminal_quota_rejection",
        )
        self.assertFalse(handoff["accepted"])
        self.assertTrue(handoff["replaySafe"])
        self.assertFalse(handoff["partialOutput"])
        self.assertNotIn("_authTag", handoff)
        self.assertEqual(handoff["terminalEvent"], "error")
        self.assertEqual(handoff["terminalStatus"], 429)
        self.assertEqual(handoff["terminalCode"], "usage_limit_reached")
        self.assertEqual(
            handoff["requestHash"],
            secret_free_audit_hash("model-request", "req-quota-handoff"),
        )
        self.assertEqual(
            handoff["fromAccountHash"],
            secret_free_audit_hash("chatgpt-account", self.account.key),
        )
        self.assertEqual(
            handoff["toAccountHash"],
            secret_free_audit_hash("chatgpt-account", replacement.key),
        )
        self.assertNotEqual(
            handoff["fromAccountHash"],
            handoff["toAccountHash"],
        )

        with open(telemetry_path, encoding="utf-8") as handle:
            persisted = [
                json.loads(line)
                for line in handle.read().splitlines()
                if line.strip()
            ]
        self.assertEqual(persisted[-1]["transportRecovery"], receipt)
        serialized = json.dumps(receipt)
        for secret in (
            self.account.key,
            self.account.path,
            self.account.email,
            "stored-token",
            replacement.key,
            replacement.path,
            replacement.email,
            "replacement-token",
            "first-token",
            "second-token",
            "fresh answer",
        ):
            self.assertNotIn(secret, serialized)

    def test_real_quota_handoff_receipt_reaches_council_model_routing(self) -> None:
        telemetry = tempfile.TemporaryDirectory()
        self.addCleanup(telemetry.cleanup)
        replacement = ChatGptAccount(
            key="replacement-council-account",
            path="replacement-council-auth.json",
            auth={"tokens": {"access_token": "replacement-token"}},
            email=None,
            plan="pro",
            primary=False,
        )
        limited = FakeWebsocket(
            [
                {
                    "type": "response.failed",
                    "response": {
                        "error": {
                            "status_code": 429,
                            "code": "usage_limit_reached",
                        }
                    },
                }
            ]
        )
        served = FakeWebsocket(
            [
                {"type": "response.output_text.delta", "delta": "council answer"},
                {"type": "response.completed", "response": {"id": "served"}},
            ]
        )

        def auth_for(selection):
            auth, _path = selection
            return (
                ("primary-token", "primary-id")
                if auth is self.account.auth
                else ("replacement-token", "replacement-id")
            )

        config = CouncilConfig()
        runtime = CouncilRuntime(
            config=config,
            router=ProviderRouter(
                config,
                upstream=ChatGptUpstreamProvider(),
            ),
            ledger=object(),
        )
        messages = [{"role": "user", "content": "hello"}]
        council_input = CouncilInput(
            messages=messages,
            requested_model="gpt-5.4",
            requested_model_alias="default",
        )
        run = CouncilRun(
            id="crun-receipt-wiring",
            user_prompt="hello",
            messages=messages,
            council_mode="direct_council",
        )
        telemetry_path = os.path.join(telemetry.name, "model-routing.jsonl")
        with (
            patch.dict(
                os.environ,
                {"CHATMOCK_MODEL_TELEMETRY_FILE": telemetry_path},
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.select_account",
                side_effect=[self.account, replacement],
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.get_effective_chatgpt_auth",
                side_effect=auth_for,
            ),
            patch(
                "chatmock.providers.chatgpt_upstream.connect_upstream_websocket",
                side_effect=[limited, served],
            ),
            patch("chatmock.providers.chatgpt_upstream.note_account_exhausted"),
            patch(
                "chatmock.providers.router.provider_health.is_unhealthy",
                return_value=False,
            ),
            patch("chatmock.providers.router.provider_health.note_success"),
            patch("chatmock.providers.router.dispatch.clear_recovered_model"),
        ):
            text, _reasoning = runtime._call_with_reasoning(
                "gpt-5.4",
                "system",
                messages,
                council_input,
                run,
            )

        self.assertEqual(text, "council answer")
        routing = run.to_dict()["modelRouting"]
        self.assertEqual(len(routing), 1)
        receipt = routing[0]["transportRecovery"]
        self.assertTrue(receipt["recovered"])
        self.assertEqual(receipt["count"], 1)
        self.assertNotIn("_authTag", json.dumps(receipt))
        with open(telemetry_path, encoding="utf-8") as handle:
            persisted = json.loads(handle.read().strip())
        self.assertEqual(persisted["transportRecovery"], receipt)

    def test_council_run_observers_cannot_replace_model_success_or_error(self) -> None:
        class ObservedRouter:
            def __init__(self, outcome):
                self.outcome = outcome

            def effective_model(self, model):
                return model

            def call_model(self, call):
                call.model_attempts_out.append({"outcome": "observed"})
                call.usage_out = ModelTokenUsage(1, 1, 2)
                if isinstance(self.outcome, BaseException):
                    raise self.outcome
                return self.outcome

        messages = [{"role": "user", "content": "hello"}]
        council_input = CouncilInput(messages=messages, requested_model="gpt-5.4")

        def run_with(outcome):
            runtime = CouncilRuntime(
                config=CouncilConfig(),
                router=ObservedRouter(outcome),
                ledger=object(),
            )
            run = CouncilRun(
                id="crun-observer",
                user_prompt="hello",
                messages=messages,
                council_mode="direct_council",
            )
            return runtime, run

        runtime, run = run_with("exact success")
        with (
            patch.object(
                run,
                "record_model_attempts",
                side_effect=RuntimeError("routing observer failed"),
            ),
            patch.object(
                run,
                "record_model_call_usage",
                side_effect=RuntimeError("usage observer failed"),
            ),
        ):
            text, _reasoning = runtime._call_with_reasoning(
                "gpt-5.4",
                "system",
                messages,
                council_input,
                run,
            )
        self.assertEqual(text, "exact success")

        original = ProviderError("exact provider error", phase="receive")
        runtime, run = run_with(original)
        with (
            patch.object(
                run,
                "record_model_attempts",
                side_effect=RuntimeError("routing observer failed"),
            ),
            patch.object(
                run,
                "record_model_call_usage",
                side_effect=RuntimeError("usage observer failed"),
            ),
        ):
            with self.assertRaises(ProviderError) as raised:
                runtime._call_with_reasoning(
                    "gpt-5.4",
                    "system",
                    messages,
                    council_input,
                    run,
                )
        self.assertIs(raised.exception, original)

    def test_model_telemetry_rejects_request_bound_fabricated_handoff(self) -> None:
        telemetry = tempfile.TemporaryDirectory()
        self.addCleanup(telemetry.cleanup)
        request_id = "req-authoritative"
        base_handoff = {
            "type": "quota_account_handoff",
            "evidence": "explicit_terminal_quota_rejection",
            "accepted": False,
            "replaySafe": True,
            "partialOutput": False,
            "terminalEvent": "error",
            "terminalStatus": 429,
            "terminalCode": "usage_limit_reached",
            # Every public field is plausible and correctly request-bound. Only
            # production's process-private authenticator is absent or wrong.
            "requestHash": secret_free_audit_hash("model-request", request_id),
            "fromAccountHash": "b" * 64,
            "toAccountHash": "c" * 64,
        }
        for label, auth_tag in (("missing", None), ("wrong", "d" * 64)):
            with self.subTest(label=label):
                handoff = dict(base_handoff)
                if auth_tag is not None:
                    handoff["_authTag"] = auth_tag
                with patch.dict(
                    os.environ,
                    {
                        "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(
                            telemetry.name,
                            f"model-routing-{label}.jsonl",
                        )
                    },
                ):
                    entry = record_model_attempt(
                        request_id=request_id,
                        endpoint="council",
                        requested_model="gpt-5.6-sol",
                        resolved_model="gpt-5.6-sol",
                        upstream_model="gpt-5.6-sol",
                        provider="chatgpt",
                        outcome="succeeded",
                        fallback=False,
                        transport_recoveries=[handoff],
                        transport_recovered=True,
                    )

                self.assertNotIn("transportRecovery", entry)

    def test_router_never_replays_after_primary_partial_output(self) -> None:
        class PartialUpstream:
            def __init__(self) -> None:
                self.calls = 0

            def call_model(self, _call):
                self.calls += 1
                raise ProviderError(
                    "partial stream failed",
                    status_code=502,
                    phase="receive",
                    partial_output=True,
                    code="connection_closed",
                )

        upstream = PartialUpstream()
        call = self._call()
        with (
            patch("chatmock.providers.router.provider_health.note_failure", return_value=object()),
            patch("chatmock.providers.router.registry.healthy_fallbacks") as fallbacks,
        ):
            with self.assertRaises(ProviderError):
                ProviderRouter(CouncilConfig(), upstream=upstream).call_model(call)

        self.assertEqual(upstream.calls, 1)
        fallbacks.assert_not_called()

    def test_router_never_replays_zero_output_receive_close(self) -> None:
        class ClosedUpstream:
            def __init__(self) -> None:
                self.calls = 0

            def call_model(self, _call):
                self.calls += 1
                raise ProviderError(
                    "socket closed after response.create",
                    status_code=502,
                    phase="receive",
                    partial_output=False,
                    replay_safe=True,
                    code="connection_closed",
                )

        upstream = ClosedUpstream()
        with (
            patch("chatmock.providers.router.provider_health.note_failure", return_value=object()),
            patch("chatmock.providers.router.registry.healthy_fallbacks") as fallbacks,
        ):
            with self.assertRaises(ProviderError) as raised:
                ProviderRouter(CouncilConfig(), upstream=upstream).call_model(self._call())

        self.assertFalse(raised.exception.replay_safe)
        self.assertEqual(upstream.calls, 1)
        fallbacks.assert_not_called()

    def test_router_never_replays_zero_output_receive_timeout(self) -> None:
        class TimedOutUpstream:
            def __init__(self) -> None:
                self.calls = 0

            def call_model(self, _call):
                self.calls += 1
                raise ProviderError(
                    "receive timed out after response.create",
                    status_code=504,
                    phase="receive",
                    partial_output=False,
                    code="idle_timeout",
                )

        upstream = TimedOutUpstream()
        with (
            patch("chatmock.providers.router.provider_health.note_failure", return_value=object()),
            patch("chatmock.providers.router.registry.healthy_fallbacks") as fallbacks,
        ):
            with self.assertRaises(ProviderError) as raised:
                ProviderRouter(CouncilConfig(), upstream=upstream).call_model(self._call())

        self.assertFalse(raised.exception.replay_safe)
        self.assertEqual(upstream.calls, 1)
        fallbacks.assert_not_called()

    def test_router_stops_when_a_fallback_emits_partial_output(self) -> None:
        class SequencedUpstream:
            def __init__(self) -> None:
                self.calls = 0

            def call_model(self, _call):
                self.calls += 1
                if self.calls == 1:
                    raise ProviderError(
                        "initial failure",
                        status_code=502,
                        phase="connect",
                        replay_safe=True,
                        code="connection_failed",
                    )
                raise ProviderError(
                    "fallback partial failure",
                    status_code=502,
                    phase="receive",
                    partial_output=True,
                    code="connection_closed",
                )

        upstream = SequencedUpstream()
        call = self._call()
        with (
            patch("chatmock.providers.router.provider_health.note_failure", return_value=object()),
            patch(
                "chatmock.providers.router.registry.healthy_fallbacks",
                return_value=["gpt-5.5", "gpt-5.4"],
            ),
        ):
            with self.assertRaises(ProviderError) as raised:
                ProviderRouter(CouncilConfig(), upstream=upstream).call_model(call)

        self.assertTrue(raised.exception.partial_output)
        self.assertEqual(upstream.calls, 2)


if __name__ == "__main__":
    unittest.main()
