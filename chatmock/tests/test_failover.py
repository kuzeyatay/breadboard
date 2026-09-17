from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from chatmock import accounts, failover
from chatmock.providers import store
from chatmock.providers.registry import (
    active_failover,
    chat_model,
    default_model,
    drives_a_browser,
    external_model_ids,
    healthy_fallbacks,
    resolve_model,
)


def _auth(account_id: str, email: str | None = None) -> dict:
    """An auth.json-shaped bundle. No id_token, so identity falls to account_id."""
    tokens = {
        "access_token": "secret-access-token",
        "refresh_token": "secret-refresh-token",
        "account_id": account_id,
    }
    return {"tokens": tokens, "last_refresh": "2026-07-31T00:00:00Z", "email": email}


def _auth_on_plan(account_id: str, plan: str) -> dict:
    """An auth bundle whose id token names the plan, the way a real login does."""
    import base64

    claims = {"https://api.openai.com/auth": {"chatgpt_plan_type": plan, "chatgpt_account_id": account_id}}
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    auth = _auth(account_id)
    auth["tokens"]["id_token"] = f"e30.{payload}.sig"
    return auth


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

    def test_the_chat_pick_is_kept_apart_from_the_background_model(self) -> None:
        # Picking Gemini in the composer used to move `default` too, so every
        # Learn revision and council followed one conversation's model choice.
        store.set_default_model("gpt-5.6-sol")
        store.set_chat_model("cliproxy/claude-opus-5")
        self.assertEqual(resolve_model("chat").public_model, "cliproxy/claude-opus-5")
        self.assertEqual(resolve_model("default").upstream_model, "gpt-5.6-sol")
        self.assertEqual(chat_model(), "cliproxy/claude-opus-5")
        self.assertEqual(default_model(), "gpt-5.6-sol")

    def test_the_chat_sentinel_follows_the_background_model_until_picked(self) -> None:
        store.set_default_model("cliproxy/claude-opus-5")
        self.assertEqual(resolve_model("chat").public_model, "cliproxy/claude-opus-5")
        # A sentinel stored as the chat model is discarded, never chased.
        store.set_chat_model("default")
        self.assertIsNone(store.read_settings().chat_model)
        self.assertEqual(chat_model(), "cliproxy/claude-opus-5")

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

    def test_chatgpt_is_the_last_layer_of_the_fallback_order(self) -> None:
        # The built-in default is the build's, not the person's, and a paid
        # weekly window: every other configured model stands in before it.
        fallbacks = healthy_fallbacks("cliproxy/claude-opus-5")
        self.assertEqual(fallbacks[-1], "gpt-5.6-sol")
        self.assertNotIn("gpt-5.6-sol", fallbacks[:-1])
        # With another external model configured it comes before ChatGPT.
        store.upsert_provider("openrouter", api_key="or-key", models=["stealth/union-alpha"])
        fallbacks = healthy_fallbacks("cliproxy/claude-opus-5")
        self.assertIn("openrouter/stealth/union-alpha", fallbacks)
        self.assertEqual(fallbacks[-1], "gpt-5.6-sol")

    def sign_in_the_browser_provider(self) -> None:
        """The "OpenAI (web)" provider, signed in and offering one model."""
        from chatmock.providers import chatgpt_web

        chatgpt_web.reset_for_tests()
        self.addCleanup(chatgpt_web.reset_for_tests)
        chatgpt_web._write_state(
            signedIn=True,
            email="person@example.com",
            checkedAt="2026-09-14T00:00:00Z",
            models=[{"slug": "gpt-5-5", "title": "GPT-5.5", "description": "", "tags": []}],
        )

    def test_the_browser_provider_is_never_a_stand_in(self) -> None:
        # It is one page holding one conversation at a time. Handing it an
        # exhausted model's background work takes the page away from the chat
        # the person is sitting in front of - measured 2026-09-14 as a council
        # stand-in holding it for two and a half minutes while three turns of
        # the person's own Pro chat were refused.
        self.sign_in_the_browser_provider()
        # It is a model on offer, and the only way to reach it is to name it.
        self.assertIn("openaiweb/gpt-5-5", external_model_ids())
        self.assertTrue(drives_a_browser("openaiweb/gpt-5-5"))
        failover.note_exhausted("gpt-5.6-sol", reason="plan window spent", seconds=3600)
        fallbacks = healthy_fallbacks("gpt-5.6-sol")
        self.assertNotIn("openaiweb/gpt-5-5", fallbacks)
        self.assertFalse([model for model in fallbacks if drives_a_browser(model)])
        self.assertFalse(drives_a_browser(default_model()))

    def test_the_browser_provider_is_not_where_an_exhausted_default_lands(self) -> None:
        # Even with every other model spent, the answer is the error that names
        # the model they picked - not their browser quietly being typed into.
        self.sign_in_the_browser_provider()
        for model in [c for c in external_model_ids() if not drives_a_browser(c)]:
            failover.note_exhausted(model, seconds=3600)
        failover.note_exhausted("gpt-5.6-sol", seconds=3600)
        self.assertEqual(default_model(), "gpt-5.6-sol")
        self.assertEqual(healthy_fallbacks("gpt-5.6-sol"), [])

    def test_a_model_the_person_asks_for_by_name_is_untouched(self) -> None:
        self.sign_in_the_browser_provider()
        self.assertEqual(resolve_model("openaiweb/gpt-5-5").upstream_model, "gpt-5-5")

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

    def _write_primary(self, account_id: str, *, connected_at: str | None = None) -> None:
        with open(os.path.join(self.home.name, "auth.json"), "w", encoding="utf-8") as fp:
            auth = _auth(account_id)
            if connected_at:
                auth["connected_at"] = connected_at
            json.dump(auth, fp)

    def _write_additional(
        self, name: str, account_id: str, *, connected_at: str | None = None
    ) -> None:
        os.makedirs(accounts.accounts_dir(), exist_ok=True)
        with open(os.path.join(accounts.accounts_dir(), f"{name}.json"), "w", encoding="utf-8") as fp:
            auth = _auth(account_id)
            if connected_at:
                auth["connected_at"] = connected_at
            json.dump(auth, fp)

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

    def test_a_free_account_never_stands_in_for_a_spent_paid_one(self) -> None:
        # The Codex backend refuses free plans outright, so handing one the
        # request would answer "model not supported" instead of the truthful
        # "weekly limit spent" — the error that sent a user chasing the wrong
        # meter for an afternoon.
        with open(os.path.join(self.home.name, "auth.json"), "w", encoding="utf-8") as fp:
            json.dump(_auth_on_plan("acct-plus", "plus"), fp)
        os.makedirs(accounts.accounts_dir(), exist_ok=True)
        with open(os.path.join(accounts.accounts_dir(), "free.json"), "w", encoding="utf-8") as fp:
            json.dump(_auth_on_plan("acct-free", "free"), fp)
        with open(os.path.join(accounts.accounts_dir(), "pro.json"), "w", encoding="utf-8") as fp:
            json.dump(_auth_on_plan("acct-pro", "pro"), fp)

        accounts.note_account_exhausted("acct-plus", reason="weekly window spent")
        self.assertEqual(accounts.select_account().key, "acct-pro")
        self.assertEqual([a.key for a in accounts.healthy_accounts()], ["acct-pro"])

        accounts.note_account_exhausted("acct-pro", reason="weekly window spent")
        # Every paid account resting: the spent primary is still the one that
        # produces the actionable 429, and the settings screen names no stand-in.
        self.assertEqual(accounts.select_account().key, "acct-plus")
        rows = {row["key"]: row for row in accounts.account_state()}
        self.assertIsNone(rows["acct-plus"]["standIn"])
        self.assertFalse(rows["acct-free"]["serving"])

    def test_a_free_account_alone_is_still_used(self) -> None:
        # With nothing else signed in, its refusal is the only honest answer.
        with open(os.path.join(self.home.name, "auth.json"), "w", encoding="utf-8") as fp:
            json.dump(_auth_on_plan("acct-free", "free"), fp)
        self.assertEqual(accounts.select_account().key, "acct-free")

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

    def test_account_state_is_chronological_without_changing_routing_order(self) -> None:
        self._write_primary("acct-newer", connected_at="2026-02-01T00:00:00Z")
        self._write_additional(
            "older", "acct-older", connected_at="2026-01-01T00:00:00Z"
        )

        self.assertEqual(accounts.select_account().key, "acct-newer")
        state = accounts.account_state()
        self.assertEqual([row["key"] for row in state], ["acct-older", "acct-newer"])
        self.assertLess(state[0]["connectedAt"], state[1]["connectedAt"])

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

    def test_activating_swaps_which_account_is_primary(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")

        self.assertTrue(accounts.activate_account("acct-second"))
        listed = accounts.list_accounts()
        self.assertEqual([(a.key, a.primary) for a in listed], [("acct-second", True), ("acct-primary", False)])
        self.assertEqual(accounts.select_account().key, "acct-second")
        # One file per account: the old primary was kept, the new one's copy went.
        stored = sorted(os.listdir(accounts.accounts_dir()))
        self.assertEqual(stored, ["acct-primary.json"])

        # And back again, without duplicating the account that is already kept.
        self.assertTrue(accounts.activate_account("acct-primary"))
        self.assertEqual(accounts.select_account().key, "acct-primary")
        self.assertEqual(sorted(os.listdir(accounts.accounts_dir())), ["acct-second.json"])

    def test_activating_the_primary_or_an_unknown_account(self) -> None:
        self._write_primary("acct-primary")
        self.assertTrue(accounts.activate_account("acct-primary"))
        self.assertFalse(accounts.activate_account("acct-missing"))

    def test_activating_a_resting_account_puts_it_back_in_service(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")
        accounts.note_account_exhausted("acct-primary", reason="usage limit reached", seconds=3600)
        self.assertEqual(accounts.select_account().key, "acct-second")

        # The user picks the resting primary back on purpose.
        self.assertTrue(accounts.activate_account("acct-primary"))
        self.assertEqual(accounts.select_account().key, "acct-primary")
        by_key = {row["key"]: row for row in accounts.account_state()}
        self.assertTrue(by_key["acct-primary"]["active"])
        self.assertTrue(by_key["acct-primary"]["available"])
        self.assertIsNone(by_key["acct-primary"]["standIn"])

        # And a resting sibling likewise, becoming primary on the way.
        accounts.note_account_exhausted("acct-second", seconds=3600)
        self.assertTrue(accounts.activate_account("acct-second"))
        self.assertEqual(accounts.select_account().key, "acct-second")

    def test_account_state_marks_the_serving_account_active(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")

        by_key = {row["key"]: row for row in accounts.account_state()}
        self.assertTrue(by_key["acct-primary"]["active"])
        self.assertTrue(by_key["acct-primary"]["serving"])
        self.assertFalse(by_key["acct-second"]["active"])

    def test_a_resting_choice_stays_chosen_with_a_stand_in(self) -> None:
        # Choosing an account is not undone by its plan window being spent:
        # it stays the active one, a sibling serves for it, and it resumes by
        # itself when the window resets.
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")
        accounts.note_account_exhausted(
            "acct-primary", reason="The usage limit has been reached", seconds=382846
        )

        by_key = {row["key"]: row for row in accounts.account_state()}
        self.assertTrue(by_key["acct-primary"]["active"])
        self.assertFalse(by_key["acct-primary"]["serving"])
        self.assertFalse(by_key["acct-primary"]["available"])
        self.assertEqual(by_key["acct-primary"]["standIn"], "acct-second")
        self.assertFalse(by_key["acct-second"]["active"])
        self.assertTrue(by_key["acct-second"]["serving"])
        self.assertIsNone(by_key["acct-second"]["standIn"])


if __name__ == "__main__":
    unittest.main()


class ActivateRouteTests(AccountRotationTests):
    """Switching to a resting account reports the rest it cleared."""

    def setUp(self) -> None:
        super().setUp()
        from flask import Flask

        from chatmock.routes_providers import providers_bp

        app = Flask(__name__)
        app.register_blueprint(providers_bp)
        self.client = app.test_client()

    def test_activate_names_the_cleared_rest(self) -> None:
        self._write_primary("acct-primary")
        self._write_additional("second", "acct-second")
        accounts.note_account_exhausted(
            "acct-primary", reason="The usage limit has been reached", seconds=382846
        )

        response = self.client.post("/v1/accounts/acct-primary/activate")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["wasResting"]["reason"], "The usage limit has been reached")
        self.assertGreater(payload["wasResting"]["remainingSeconds"], 380000)
        by_key = {row["key"]: row for row in payload["accounts"]}
        self.assertTrue(by_key["acct-primary"]["active"])

        # Picking an account that was not resting says so.
        response = self.client.post("/v1/accounts/acct-second/activate")
        self.assertIsNone(response.get_json()["wasResting"])
