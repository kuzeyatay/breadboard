from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from chatmock import chatgpt_models as discovery
from chatmock.accounts import ChatGptAccount
from chatmock.model_registry import allowed_efforts_for_model, list_public_models, normalize_model_name
from chatmock.providers.registry import model_entries, resolve_model
from chatmock.reasoning import build_reasoning_param
from chatmock.fast_mode import supports_priority_service_tier


def catalog(slug="gpt-9.9-sol", efforts=("low", "high", "max")):
    return {"models": [{
        "slug": slug, "display_name": "GPT-9.9 Sol", "visibility": "list",
        "supported_reasoning_levels": [{"effort": effort} for effort in efforts],
        "service_tiers": [{"id": "priority"}],
    }]}


class ChatgptDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "models.json"
        self.account = ChatGptAccount("account-a", str(Path(self.tmp.name) / "auth.json"),
                                      {"tokens": {"access_token": "private-token"}}, None, "pro", True)
        for patcher in (
            patch.dict(os.environ, {
                "CHATMOCK_MODEL_DISCOVERY": "1", "CHATMOCK_CHATGPT_MODELS_FILE": str(self.path),
                "CHATGPT_LOCAL_HOME": self.tmp.name, "CHATMOCK_PROVIDERS_FILE": str(Path(self.tmp.name) / "providers.json"),
            }),
            patch.object(discovery, "select_account", return_value=self.account),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        fetch_patcher = patch.object(discovery, "fetch_models", return_value=discovery.shape_models(catalog()))
        self.fetch = fetch_patcher.start()
        self.addCleanup(fetch_patcher.stop)

    def test_catalog_reaches_listing_resolution_and_reasoning_without_static_registration(self):
        self.assertIn("gpt-9.9-sol", list_public_models())
        self.assertIn("gpt-9.9-sol-max", list_public_models(True))
        self.assertEqual(normalize_model_name("gpt-9.9-sol:max"), "gpt-9.9-sol")
        self.assertEqual(resolve_model("gpt-9.9-sol").upstream_model, "gpt-9.9-sol")
        self.assertEqual(allowed_efforts_for_model("gpt-9.9-sol"), frozenset({"low", "high", "max"}))
        self.assertTrue(supports_priority_service_tier("gpt-9.9-sol"))
        with patch("chatmock.providers.registry.external_model_ids", return_value=[]):
            self.assertEqual(model_entries(["gpt-9.9-sol"]), [{
                "id": "gpt-9.9-sol", "object": "model", "owned_by": "chatgpt",
                "reasoning_efforts": ["low", "high", "max"], "name": "GPT-9.9 Sol",
            }])
        self.fetch.assert_called_once_with(self.account)
        self.assertNotIn("private-token", self.path.read_text())
        self.assertNotIn("account-a", self.path.read_text())

    def test_gateway_models_and_provider_settings_include_discovery(self):
        from chatmock.app import create_app

        client = create_app().test_client()
        with patch("chatmock.providers.registry.external_model_ids", return_value=[]), \
             patch("chatmock.routes_providers.external_model_ids", return_value=[]):
            response = client.get("/v1/models")
            self.assertEqual(response.status_code, 200)
            rows = {row["id"]: row for row in response.get_json()["data"]}
            self.assertEqual(rows["gpt-9.9-sol"]["reasoning_efforts"], ["low", "high", "max"])
            self.assertIn("gpt-9.9-sol", client.get("/v1/providers").get_json()["chatgptModels"])

    def test_live_metadata_overrides_builtin_efforts_without_losing_aliases(self):
        self.fetch.return_value = discovery.shape_models(catalog("gpt-6.2-sol", ("high",)))
        list_public_models()
        self.assertEqual(allowed_efforts_for_model("gpt6.2-sol"), frozenset({"high"}))
        self.assertEqual(normalize_model_name("gpt6.2-sol"), "gpt-6.2-sol")
        self.assertEqual(build_reasoning_param(allowed_efforts=frozenset({"high"}))["effort"], "high")
        self.assertEqual(build_reasoning_param(allowed_efforts=frozenset()), {})

    def test_exact_discovered_id_is_not_mistaken_for_an_effort_suffix(self):
        self.fetch.return_value = discovery.shape_models(catalog("gpt-9.9-high"))
        list_public_models()
        self.assertEqual(normalize_model_name("gpt-9.9-high"), "gpt-9.9-high")

    def test_only_visible_well_formed_models_are_discovered(self):
        rows = catalog()["models"]
        for slug, visibility in [("gpt-hidden", "hide"), ("chat", "list"), ("evil/model", "list"), ("gpt-unknown", None)]:
            rows.append({**rows[0], "slug": slug, "visibility": visibility})
        rows.append({"slug": "gpt-incomplete", "visibility": "list"})
        self.assertEqual([row["id"] for row in discovery.shape_models({"models": rows})], ["gpt-9.9-sol"])
        with self.assertRaises(ValueError):
            discovery.shape_models({"error": "unavailable"})

    def test_account_changes_and_signout_do_not_reuse_another_accounts_models(self):
        list_public_models()
        other = ChatGptAccount("account-b", self.account.path, {}, None, "plus", True)
        with patch.object(discovery, "select_account", return_value=other):
            self.assertEqual(discovery.discovered_models(), [])
            self.fetch.return_value = discovery.shape_models(catalog("gpt-9.9-terra"))
            self.assertIn("gpt-9.9-terra", list_public_models())
            self.assertNotIn("gpt-9.9-sol", list_public_models())
        self.assertIn("gpt-9.9-sol", list_public_models())
        with patch.object(discovery, "select_account", return_value=None):
            self.assertNotIn("gpt-9.9-sol", list_public_models())

    def test_persisted_cache_survives_refresh_failure_and_retries_are_throttled(self):
        list_public_models()
        cached = json.loads(self.path.read_text())
        next(iter(cached["accounts"].values()))["fetched_at"] = time.time() - discovery.REFRESH_SECONDS - 1
        self.path.write_text(json.dumps(cached))
        self.fetch.side_effect = requests.ConnectionError("offline")
        # Run the background job inline to make cache/failure assertions deterministic.
        def inline_thread(*, target, **_kwargs):
            return Mock(start=target)
        with patch.object(discovery.threading, "Thread", side_effect=inline_thread):
            self.assertIn("gpt-9.9-sol", list_public_models())
            self.assertIn("gpt-9.9-sol", list_public_models())
        self.assertEqual(self.fetch.call_count, 2)
        self.assertEqual(json.loads(self.path.read_text()), cached)

    def test_stale_cache_refresh_adds_new_models_without_restart(self):
        list_public_models()
        cached = json.loads(self.path.read_text())
        next(iter(cached["accounts"].values()))["fetched_at"] = time.time() - discovery.REFRESH_SECONDS - 1
        self.path.write_text(json.dumps(cached))
        self.fetch.return_value = discovery.shape_models(catalog("gpt-10-sol"))
        with patch.object(discovery.threading, "Thread", side_effect=lambda *, target, **_: Mock(start=target)):
            list_public_models()
        self.assertIn("gpt-10-sol", list_public_models())
        self.assertNotIn("gpt-9.9-sol", list_public_models())

    def test_first_failure_keeps_builtins_and_does_not_retry_each_read(self):
        self.fetch.side_effect = requests.Timeout("offline")
        self.assertIn("gpt-6.2-sol", list_public_models())
        self.assertIn("gpt-6.2-sol", list_public_models())
        self.fetch.assert_called_once()

    def test_unwritable_cache_keeps_discovery_in_memory(self):
        with patch.object(discovery, "_write_entry", side_effect=PermissionError("read-only")):
            self.assertIn("gpt-9.9-sol", list_public_models())
            self.assertEqual(allowed_efforts_for_model("gpt-9.9-sol"), frozenset({"low", "high", "max"}))
            list_public_models()
        self.fetch.assert_called_once()

    def test_concurrent_reads_share_a_cold_refresh(self):
        entered, release = threading.Event(), threading.Event()
        def slow_fetch(_account):
            entered.set()
            release.wait(2)
            return discovery.shape_models(catalog())
        self.fetch.side_effect = slow_fetch
        worker = threading.Thread(target=list_public_models)
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            list_public_models()
            self.fetch.assert_called_once()
        finally:
            release.set()
            worker.join(2)
        self.assertIn("gpt-9.9-sol", list_public_models())


class ChatgptCatalogTransportTests(unittest.TestCase):
    def test_discovery_uses_installed_client_version_or_explicit_override(self):
        with patch.dict(os.environ, {"CHATMOCK_CODEX_CLIENT_VERSION": "1.2.3"}), \
             patch.object(discovery.shutil, "which") as which:
            self.assertEqual(discovery.client_version(), "1.2.3")
            which.assert_not_called()
        with patch.dict(os.environ, {"CHATMOCK_CODEX_CLIENT_VERSION": ""}), \
             patch.object(discovery.shutil, "which", return_value=__file__), \
             patch.object(discovery, "_installed_client_version", return_value="0.170.0"):
            self.assertEqual(discovery.client_version(), "0.170.0")

    def test_signed_in_account_headers_and_one_token_refresh_on_401(self):
        account = ChatGptAccount("id", "unused.json", {}, None, "pro", True)
        rejected = Mock(status_code=401)
        success = Mock(status_code=200)
        success.json.return_value = catalog()
        with patch.object(discovery, "client_version", return_value="0.170.0"), \
             patch.object(discovery, "load_chatgpt_tokens", side_effect=[("old", "id", None), ("new", "id", None)]) as auth, \
             patch.object(discovery.requests, "get", side_effect=[rejected, success]) as get:
            self.assertEqual(discovery.fetch_models(account)[0]["id"], "gpt-9.9-sol")
        self.assertEqual([call.kwargs["force_refresh"] for call in auth.call_args_list], [False, True])
        self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer new")
        self.assertEqual(get.call_args.kwargs["headers"]["ChatGPT-Account-Id"], "id")
        self.assertEqual(get.call_args.kwargs["params"], {"client_version": "0.170.0"})
        rejected.close.assert_called_once()
        success.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
