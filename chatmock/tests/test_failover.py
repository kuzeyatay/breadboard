from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from chatmock import accounts, failover
from chatmock.providers import store
from chatmock.providers.registry import active_failover, default_model, healthy_fallbacks


def _auth(account_id: str, email: str | None = None) -> dict:
    """An auth.json-shaped bundle. No id_token, so identity falls to account_id."""
    tokens = {
        "access_token": "secret-access-token",
        "refresh_token": "secret-refresh-token",
        "account_id": account_id,
    }
    return {"tokens": tokens, "last_refresh": "2026-07-31T00:00:00Z", "email": email}


class QuotaDetectionTests(unittest.TestCase):
    def test_429_is_always_exhaustion(self) -> None:
        self.assertTrue(failover.is_quota_error(429, ""))
        self.assertTrue(failover.is_quota_error(429, "anything"))

    def test_prose_exhaustion_on_a_400_is_recognised(self) -> None:
        # Some upstreams report a spent plan as a 400 with an explanation.
        self.assertTrue(
            failover.is_quota_error(400, "Third-party apps now draw from your extra usage")
        )
        self.assertTrue(failover.is_quota_error(400, "You exceeded your current quota"))
        self.assertTrue(failover.is_quota_error(None, "usage limit reached"))

    def test_ordinary_failures_are_not_exhaustion(self) -> None:
        # Misreading these as "out of quota" would bench a healthy model.
        self.assertFalse(failover.is_quota_error(400, "tools.0.input_schema: Field required"))
        self.assertFalse(failover.is_quota_error(500, "internal error"))
        self.assertFalse(failover.is_quota_error(401, "Invalid API key"))

    def test_retry_hint_is_read_from_prose(self) -> None:
        self.assertEqual(failover.retry_after_seconds("try again in 3 hours"), 3 * 3600)
        self.assertEqual(failover.retry_after_seconds("resets in 45 minutes"), 45 * 60)
        self.assertIsNone(failover.retry_after_seconds("no numbers here"))


class CooldownStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {"CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json")},
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_model_can_be_benched_and_recovers_on_expiry(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", reason="out of quota", seconds=60)
        self.assertTrue(failover.is_cooling("gpt-5.6-sol"))

        cooldown = failover.cooldown_for("gpt-5.6-sol")
        self.assertEqual(cooldown.reason, "out of quota")
        self.assertGreater(cooldown.remaining_seconds, 0)

        # Expiry is read from the clock, so recovery needs no sweeper process.
        with patch("time.time", return_value=time.time() + 120):
            self.assertFalse(failover.is_cooling("gpt-5.6-sol"))

    def test_the_longer_window_wins(self) -> None:
        # A weekly plan window must not be shortened by a later generic retry.
        failover.note_exhausted("gpt-5.6-sol", seconds=7 * 24 * 3600)
        long_until = failover.cooldown_for("gpt-5.6-sol").until
        failover.note_exhausted("gpt-5.6-sol", seconds=60)
        self.assertEqual(failover.cooldown_for("gpt-5.6-sol").until, long_until)

    def test_a_cooldown_survives_a_restart(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", seconds=3600)
        # A fresh read of the same file is what a restarted process would do.
        self.assertTrue(failover.is_cooling("gpt-5.6-sol"))
        self.assertEqual([c.model for c in failover.active_cooldowns()], ["gpt-5.6-sol"])

    def test_clearing_restores_the_model(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", seconds=3600)
        failover.clear("gpt-5.6-sol")
        self.assertFalse(failover.is_cooling("gpt-5.6-sol"))


class DefaultModelFailoverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("CHATMOCK_DEFAULT_MODEL", None)
        store.upsert_provider("cliproxy", api_key="k", models=["claude-opus-5"])

    def test_the_chosen_model_is_used_while_healthy(self) -> None:
        self.assertEqual(default_model(), "gpt-5.6-sol")
        self.assertIsNone(active_failover())

    def test_an_exhausted_model_is_stepped_over(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", reason="plan window spent", seconds=3600)
        self.assertEqual(default_model(), "cliproxy/claude-opus-5")

    def test_the_users_choice_is_not_overwritten(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", seconds=3600)
        default_model()
        # The stored preference still names what they picked, so it returns on
        # its own once the window resets.
        self.assertEqual(store.get_default_model("gpt-5.6-sol"), "gpt-5.6-sol")

    def test_the_failover_is_reportable(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", reason="plan window spent", seconds=3600)
        notice = active_failover()
        self.assertEqual(notice["preferredModel"], "gpt-5.6-sol")
        self.assertEqual(notice["servingModel"], "cliproxy/claude-opus-5")
        self.assertTrue(notice["usingFallback"])
        self.assertEqual(notice["reason"], "plan window spent")
        self.assertGreater(notice["resetsInSeconds"], 0)

    def test_chatgpt_leads_the_fallback_order(self) -> None:
        # Returning to the configured default is the least surprising outcome.
        self.assertEqual(healthy_fallbacks("cliproxy/claude-opus-5")[0], "gpt-5.6-sol")

    def test_a_cooling_fallback_is_skipped(self) -> None:
        failover.note_exhausted("gpt-5.6-sol", seconds=3600)
        failover.note_exhausted("cliproxy/claude-opus-5", seconds=3600)
        # Nothing is healthy: keep the user's choice so the error names it.
        self.assertEqual(default_model(), "gpt-5.6-sol")


class AccountRotationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATGPT_LOCAL_HOME": self.home.name,
                "CHATMOCK_FAILOVER_FILE": os.path.join(self.tmp.name, "failover.json"),
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("CODEX_HOME", None)

    def _write_primary(self, account_id: str) -> None:
        with open(os.path.join(self.home.name, "auth.json"), "w", encoding="utf-8") as fp:
            json.dump(_auth(account_id), fp)

    def _write_additional(self, name: str, account_id: str) -> None:
        os.makedirs(accounts.accounts_dir(), exist_ok=True)
        with open(os.path.join(accounts.accounts_dir(), f"{name}.json"), "w", encoding="utf-8") as fp:
            json.dump(_auth(account_id), fp)

    def test_no_accounts_selects_nothing(self) -> None:
        self.assertIsNone(accounts.select_account())

    def test_the_primary_is_preferred_and_selection_is_sticky(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")

        # Sticky: repeated calls keep the same account so prompt caching holds.
        self.assertEqual(accounts.select_account().key, "acct-primary")
        self.assertEqual(accounts.select_account().key, "acct-primary")

    def test_an_exhausted_account_hands_over_to_the_next(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")

        accounts.note_account_exhausted("acct-primary", reason="weekly window spent")
        self.assertEqual(accounts.select_account().key, "acct-second")

    def test_all_exhausted_still_returns_credentials(self) -> None:
        # The caller needs a token to produce a meaningful upstream error; the
        # model-level failover is what moves traffic off ChatGPT entirely.
        self._write_primary("acct-primary")
        accounts.note_account_exhausted("acct-primary")
        self.assertEqual(accounts.select_account().key, "acct-primary")

    def test_account_state_reports_availability_without_tokens(self) -> None:
        self._write_primary("acct-primary")
        accounts.note_account_exhausted("acct-primary", reason="weekly window spent", seconds=3600)

        state = accounts.account_state()
        self.assertEqual(len(state), 1)
        self.assertFalse(state[0]["available"])
        self.assertGreater(state[0]["cooldownSeconds"], 0)
        self.assertEqual(state[0]["cooldownReason"], "weekly window spent")
        serialized = json.dumps(state)
        self.assertNotIn("secret-access-token", serialized)
        self.assertNotIn("secret-refresh-token", serialized)

    def test_preserving_turns_switch_account_into_add_account(self) -> None:
        self._write_primary("acct-primary")
        preserved = accounts.preserve_current_account()
        self.assertIsNotNone(preserved)

        # The login flow then overwrites auth.json with the new account.
        self._write_primary("acct-new")
        keys = {account.key for account in accounts.list_accounts()}
        self.assertEqual(keys, {"acct-primary", "acct-new"})

    def test_preserving_twice_does_not_duplicate(self) -> None:
        self._write_primary("acct-primary")
        self.assertIsNotNone(accounts.preserve_current_account())
        self.assertIsNone(accounts.preserve_current_account())
        self.assertEqual(len(accounts.list_accounts()), 1)

    def test_forgetting_removes_only_additional_accounts(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")

        self.assertFalse(accounts.forget_account("acct-primary"))
        self.assertTrue(accounts.forget_account("acct-second"))
        self.assertEqual([a.key for a in accounts.list_accounts()], ["acct-primary"])


if __name__ == "__main__":
    unittest.main()
