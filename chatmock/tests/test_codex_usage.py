from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import requests

os.environ.setdefault("CHATMOCK_MODEL_DISCOVERY", "0")

from chatmock import codex_usage
from chatmock.app import create_app


def _window(used: float, seconds: int, resets: int) -> dict:
    return {
        "used_percent": used,
        "limit_window_seconds": seconds,
        "reset_after_seconds": resets,
        "reset_at": 1789805444,
    }


def _report(*, spent: bool, banner: bool = True, reserve_used: float = 26) -> dict:
    """A `wham/usage` payload shaped like OpenAI's, for a Pro plan."""
    return {
        "email": "pro@example.com",
        "plan_type": "pro",
        "rate_limit": {
            "allowed": not spent,
            "limit_reached": spent,
            "primary_window": _window(100 if spent else 41, 604800, 442123),
            "secondary_window": None,
        },
        "additional_rate_limits": [
            {
                "limit_name": "GPT-5.3-Codex-Spark",
                "metered_feature": "codex_bengalfox",
                "rate_limit": {
                    "allowed": True,
                    "limit_reached": False,
                    "primary_window": _window(0, 18000, 18000),
                    "secondary_window": _window(0, 604800, 604800),
                },
                "normal_model_slug": None,
            },
            {
                "limit_name": "gpt-reserve",
                "metered_feature": "base_model_inference",
                "rate_limit": {
                    "allowed": reserve_used < 100,
                    "limit_reached": reserve_used >= 100,
                    "primary_window": _window(reserve_used, 604800, 257851),
                    "secondary_window": None,
                },
                "normal_model_slug": "gpt-5.6-luna",
            },
        ],
        "credits": {"has_credits": False, "unlimited": False, "balance": "0"},
        "rate_limit_upsell": (
            {
                "banner_type": "luna_reserve",
                "title": "You’re now using Luna, a faster model for simpler tasks.",
                "description": "Add credits to continue using the most advanced models.",
            }
            if spent and banner
            else None
        ),
    }


class NormalizeCodexUsageTests(unittest.TestCase):
    def test_spent_plan_with_banner_reports_an_active_luna_reserve(self) -> None:
        usage = codex_usage.normalize_codex_usage(
            _report(spent=True), datetime(2026, 9, 14, 8, 0, tzinfo=timezone.utc)
        )
        self.assertEqual(usage["captured_at"], "2026-09-14T08:00:00+00:00")
        self.assertEqual(usage["plan"], "pro")
        self.assertTrue(usage["limit_reached"])
        self.assertEqual(usage["primary"]["used_percent"], 100)
        self.assertEqual(usage["primary"]["window_minutes"], 10080)
        self.assertEqual(usage["primary"]["resets_in_seconds"], 442123)
        self.assertIsNone(usage["secondary"])

        reserve = usage["reserve"]
        self.assertEqual(reserve["model"], "gpt-5.6-luna")
        self.assertTrue(reserve["active"])
        self.assertEqual(reserve["primary"]["used_percent"], 26)
        self.assertEqual(reserve["primary"]["window_minutes"], 10080)
        self.assertEqual(usage["banner"]["type"], "luna_reserve")
        self.assertIn("Luna", usage["banner"]["title"])
        self.assertFalse(usage["credits"]["has_credits"])

    def test_reserve_is_present_but_idle_while_the_plan_has_room(self) -> None:
        usage = codex_usage.normalize_codex_usage(_report(spent=False))
        self.assertFalse(usage["limit_reached"])
        self.assertFalse(usage["reserve"]["active"])
        self.assertEqual(usage["reserve"]["model"], "gpt-5.6-luna")
        self.assertIsNone(usage["banner"])

    def test_spent_plan_without_banner_still_counts_as_on_reserve(self) -> None:
        usage = codex_usage.normalize_codex_usage(_report(spent=True, banner=False))
        self.assertTrue(usage["reserve"]["active"])

    def test_spent_reserve_is_not_active(self) -> None:
        usage = codex_usage.normalize_codex_usage(_report(spent=True, reserve_used=100))
        self.assertFalse(usage["reserve"]["active"])
        self.assertTrue(usage["reserve"]["limit_reached"])

    def test_accounts_without_a_reserve_pool_report_none(self) -> None:
        report = _report(spent=False)
        report["additional_rate_limits"] = []
        usage = codex_usage.normalize_codex_usage(report)
        self.assertIsNone(usage["reserve"])

    def test_non_object_payload_is_an_error(self) -> None:
        with self.assertRaises(codex_usage.CodexUsageError):
            codex_usage.normalize_codex_usage(["nope"])


class _FakeResponse:
    def __init__(self, status: int, payload: object) -> None:
        self.status_code = status
        self._payload = payload

    def json(self) -> object:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FetchCodexUsageTests(unittest.TestCase):
    def test_sends_bearer_and_account_headers(self) -> None:
        seen: dict = {}

        def fake_get(url, headers=None, timeout=None):
            seen.update({"url": url, "headers": headers})
            return _FakeResponse(200, _report(spent=True))

        with patch.object(
            codex_usage, "load_chatgpt_tokens", return_value=("tok", "acct-1", None)
        ), patch.object(codex_usage.requests, "get", fake_get):
            usage = codex_usage.fetch_codex_usage({"tokens": {}}, "/auth.json")
        self.assertEqual(seen["url"], codex_usage.USAGE_URL)
        self.assertEqual(seen["headers"]["Authorization"], "Bearer tok")
        self.assertEqual(seen["headers"]["ChatGPT-Account-Id"], "acct-1")
        self.assertTrue(usage["reserve"]["active"])

    def test_missing_token_is_an_error(self) -> None:
        with patch.object(
            codex_usage, "load_chatgpt_tokens", return_value=(None, None, None)
        ):
            with self.assertRaises(codex_usage.CodexUsageError):
                codex_usage.fetch_codex_usage({"tokens": {}}, "/auth.json")

    def test_upstream_failures_are_errors(self) -> None:
        with patch.object(
            codex_usage, "load_chatgpt_tokens", return_value=("tok", "acct-1", None)
        ):
            with patch.object(
                codex_usage.requests, "get", return_value=_FakeResponse(401, {})
            ):
                with self.assertRaises(codex_usage.CodexUsageError):
                    codex_usage.fetch_codex_usage({"tokens": {}}, "/auth.json")
            with patch.object(
                codex_usage.requests,
                "get",
                side_effect=requests.ConnectionError("offline"),
            ):
                with self.assertRaises(codex_usage.CodexUsageError):
                    codex_usage.fetch_codex_usage({"tokens": {}}, "/auth.json")


def _id_token(email: str, plan: str) -> str:
    """An unsigned JWT carrying the claims ChatMock reads an identity from."""
    import base64

    def segment(payload: dict) -> str:
        raw = json.dumps(payload).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    claims = {"email": email, "https://api.openai.com/auth": {"chatgpt_plan_type": plan}}
    return f"{segment({'alg': 'none'})}.{segment(claims)}."


def _auth(account_id: str, email: str, plan: str = "pro") -> dict:
    return {
        "tokens": {
            "access_token": "secret-access-token",
            "refresh_token": "secret-refresh-token",
            "id_token": _id_token(email, plan),
            "account_id": account_id,
        },
        "last_refresh": "2026-07-31T00:00:00Z",
    }


class UsageRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = self.tmp.name
        with open(os.path.join(home, "auth.json"), "w", encoding="utf-8") as handle:
            json.dump(_auth("acct-pro", "pro@example.com"), handle)
        os.makedirs(os.path.join(home, "accounts"))
        with open(
            os.path.join(home, "accounts", "plus.json"), "w", encoding="utf-8"
        ) as handle:
            json.dump(_auth("acct-plus", "plus@example.com", "plus"), handle)
        patcher = patch.dict(
            os.environ,
            {
                "CHATGPT_LOCAL_HOME": home,
                "CHATMOCK_PROVIDERS_FILE": os.path.join(home, "providers.json"),
                "CHATMOCK_MODEL_TELEMETRY_FILE": os.path.join(home, "model-routing.jsonl"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = create_app().test_client()

    def test_defaults_to_the_primary_account(self) -> None:
        with patch.object(
            codex_usage, "fetch_codex_usage", return_value=codex_usage.normalize_codex_usage(_report(spent=True))
        ) as fetch:
            response = self.client.get("/v1/settings/usage")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch.call_args.args[0]["tokens"]["account_id"], "acct-pro")
        payload = response.get_json()
        self.assertEqual(payload["account"], "pro@example.com")
        self.assertTrue(payload["primary_account"])
        self.assertTrue(payload["reserve"]["active"])
        self.assertNotIn("secret-access-token", response.get_data(as_text=True))

    def test_picks_an_account_by_email(self) -> None:
        with patch.object(
            codex_usage, "fetch_codex_usage", return_value=codex_usage.normalize_codex_usage(_report(spent=False))
        ) as fetch:
            response = self.client.get("/v1/settings/usage?account=plus@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch.call_args.args[0]["tokens"]["account_id"], "acct-plus")
        self.assertFalse(response.get_json()["primary_account"])

    def test_unknown_account_is_404(self) -> None:
        self.assertEqual(
            self.client.get("/v1/settings/usage?account=nobody@example.com").status_code, 404
        )

    def test_upstream_error_is_502_with_the_message(self) -> None:
        with patch.object(
            codex_usage, "fetch_codex_usage", side_effect=codex_usage.CodexUsageError("nope")
        ):
            response = self.client.get("/v1/settings/usage")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"]["message"], "nope")


if __name__ == "__main__":
    unittest.main()
