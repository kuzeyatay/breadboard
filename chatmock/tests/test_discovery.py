from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

from chatmock.providers import claude_code, discovery, store
from chatmock.providers.catalog import provider_spec
from chatmock.providers.registry import external_model_ids


OPENROUTER_ROWS = [
    {"id": "anthropic/claude-fable-5.1", "created": 1788285838},
    {"id": "anthropic/claude-fable-5.1:batch", "created": 1788285838},
    {"id": "~anthropic/claude-fable-latest", "created": 1781029944},
    {"id": "anthropic/claude-opus-5", "created": 1785000000},
    {"id": "anthropic/claude-sonnet-4.5", "created": 1760000000},
    {"id": "anthropic/claude-3-haiku", "created": 1700000000},
    {"id": "google/gemini-3.8-flash", "created": 1788000000},
    {"id": "google/gemini-2.5-flash-image", "created": 1750000000},
    {"id": "meta-llama/llama-4-maverick", "created": 1770000000},
    {"id": "openai/text-embedding-3-large", "created": 1700000000},
    {"id": "openrouter/auto", "created": 1700000000},
] + [{"id": f"vendor{i}/model-{i}", "created": 1600000000 + i} for i in range(80)]


class DiscoveryShapingTests(unittest.TestCase):
    def test_marketplace_catalogs_narrow_to_the_namespaces_in_use(self) -> None:
        shaped = discovery.shape_provider_models(
            OPENROUTER_ROWS,
            configured=["anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro"],
        )
        self.assertEqual(shaped[0], "anthropic/claude-fable-5.1", "newest first")
        self.assertIn("google/gemini-3.8-flash", shaped)
        self.assertNotIn("anthropic/claude-fable-5.1:batch", shaped)
        self.assertNotIn("~anthropic/claude-fable-latest", shaped)
        self.assertNotIn("google/gemini-2.5-flash-image", shaped)
        self.assertNotIn("meta-llama/llama-4-maverick", shaped, "a namespace nobody uses")
        self.assertFalse(any(model.startswith("vendor") for model in shaped))

    def test_marketplace_without_any_configured_namespace_offers_nothing(self) -> None:
        self.assertEqual(discovery.shape_provider_models(OPENROUTER_ROWS, configured=[]), [])

    def test_small_catalogs_are_taken_whole_minus_non_chat_models(self) -> None:
        rows = [
            {"id": "claude-fable-5-1", "created": 3},
            {"id": "claude-sonnet-4-5", "created": 2},
            {"id": "text-embedding-3", "created": 1},
        ]
        self.assertEqual(
            discovery.shape_provider_models(rows, configured=[]),
            ["claude-fable-5-1", "claude-sonnet-4-5"],
        )

    def test_claude_code_ids_are_derived_from_the_public_catalog(self) -> None:
        self.assertEqual(
            discovery.claude_code_id_from_openrouter("anthropic/claude-fable-5.1"),
            "claude-fable-5-1",
        )
        self.assertIsNone(discovery.claude_code_id_from_openrouter("anthropic/claude-fable-5.1:batch"))
        self.assertIsNone(discovery.claude_code_id_from_openrouter("anthropic/claude-3-haiku"))
        self.assertIsNone(discovery.claude_code_id_from_openrouter("google/gemini-3.8-flash"))
        shaped = discovery.shape_claude_code_models(OPENROUTER_ROWS)
        self.assertEqual(shaped[:2], ["claude-fable-5-1", "claude-opus-5"])


class DiscoveryCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = patch.dict(
            os.environ,
            {
                "CHATMOCK_PROVIDERS_FILE": os.path.join(self.tmp.name, "providers.json"),
                "CHATMOCK_DISCOVERY_FILE": os.path.join(self.tmp.name, "discovered.json"),
                "CHATMOCK_MODEL_DISCOVERY": "1",
                "CHATMOCK_ALLOW_ENV_PROVIDER_KEYS": "0",
            },
            clear=False,
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY"):
            os.environ.pop(name, None)
        self.calls = 0

        def fake_rows(spec, credentials):
            self.calls += 1
            return list(OPENROUTER_ROWS)

        rows_patch = patch.object(discovery, "_fetch_provider_rows", fake_rows)
        rows_patch.start()
        self.addCleanup(rows_patch.stop)
        public_patch = patch.object(
            discovery, "_fetch_public_openrouter_rows", lambda: list(OPENROUTER_ROWS)
        )
        public_patch.start()
        self.addCleanup(public_patch.stop)
        inline_patch = patch.object(discovery, "background_refresh", False)
        inline_patch.start()
        self.addCleanup(inline_patch.stop)

    def test_configured_providers_gain_the_models_they_report(self) -> None:
        store.upsert_provider("openrouter", api_key="sk-or-test")
        listed = external_model_ids()
        self.assertIn("openrouter/anthropic/claude-sonnet-4.5", listed, "the suggestion stays")
        self.assertIn("openrouter/anthropic/claude-fable-5.1", listed, "the live catalog adds Fable 5.1")
        self.assertNotIn("openrouter/anthropic/claude-fable-5.1:batch", listed)
        self.assertEqual(self.calls, 1)

        # The second read is answered from the cache, not the network.
        external_model_ids()
        self.assertEqual(self.calls, 1)
        with open(os.environ["CHATMOCK_DISCOVERY_FILE"], "r", encoding="utf-8") as handle:
            cached = json.load(handle)
        self.assertIn("provider:openrouter", cached["entries"])

    def test_a_stale_cache_is_still_served_and_refreshed_later(self) -> None:
        store.upsert_provider("openrouter", api_key="sk-or-test")
        external_model_ids()
        path = os.environ["CHATMOCK_DISCOVERY_FILE"]
        with open(path, "r", encoding="utf-8") as handle:
            cached = json.load(handle)
        cached["entries"]["provider:openrouter"]["fetched_at"] = time.time() - 2 * discovery.REFRESH_INTERVAL_SECONDS
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(cached, handle)
        listed = external_model_ids()
        self.assertIn("openrouter/anthropic/claude-fable-5.1", listed)
        self.assertEqual(self.calls, 2, "a stale entry is served and refreshed")

    def test_a_provider_that_cannot_be_reached_contributes_nothing(self) -> None:
        def failing(spec, credentials):
            raise RuntimeError("offline")

        with patch.object(discovery, "_fetch_provider_rows", failing):
            store.upsert_provider("openrouter", api_key="sk-or-test")
            listed = external_model_ids()
        self.assertIn("openrouter/anthropic/claude-sonnet-4.5", listed)
        self.assertNotIn("openrouter/anthropic/claude-fable-5.1", listed)

    def test_claude_code_bridge_ids_follow_the_public_catalog_once_signed_in(self) -> None:
        spec = provider_spec("cliproxy")
        store.upsert_provider("cliproxy", base_url="http://127.0.0.1:8317/v1", models=["gemini-3.8-flash-high"])
        self.assertNotIn("cliproxy/claude-fable-5-1", external_model_ids(), "no Claude sign-in, no Claude ids")
        store.upsert_provider("cliproxy", models=["gemini-3.8-flash-high", "claude-fable-5"])
        listed = external_model_ids()
        self.assertIn("cliproxy/claude-fable-5-1", listed)
        self.assertIn("cliproxy/claude-fable-5", listed, "the synced id stays")
        self.assertTrue(claude_code.is_claude_model("cliproxy/claude-fable-5-1"))
        self.assertEqual(spec.id, "cliproxy")

    def test_discovery_can_be_switched_off(self) -> None:
        store.upsert_provider("openrouter", api_key="sk-or-test")
        with patch.dict(os.environ, {"CHATMOCK_MODEL_DISCOVERY": "0"}):
            listed = external_model_ids()
        self.assertNotIn("openrouter/anthropic/claude-fable-5.1", listed)
        self.assertEqual(self.calls, 0)


class ClaudeExecutableTests(unittest.TestCase):
    def test_probe_covers_managed_windows_homes_and_the_configured_path(self) -> None:
        env = {
            "CLAUDE_CLI_PATH": r"D:\tools\claude.exe",
            "USERPROFILE": r"C:\Users\person",
            "HOME": r"C:\Users\person\AppData\Roaming\SPB_Data",
            "APPDATA": r"C:\Users\person\AppData\Roaming",
            "LOCALAPPDATA": r"C:\Users\person\AppData\Local",
        }
        rendered = [str(path).replace("\\", "/") for path in claude_code.claude_executable_candidates(env)]
        self.assertEqual(rendered[0], "D:/tools/claude.exe")
        if os.name == "nt":
            self.assertIn("C:/Users/person/.local/bin/claude.exe", rendered)
            self.assertIn("C:/Users/person/AppData/Roaming/SPB_Data/.local/bin/claude.exe", rendered)
            self.assertIn("C:/Users/person/AppData/Roaming/npm/claude.cmd", rendered)
            self.assertIn("C:/Users/person/AppData/Local/Programs/claude/claude.exe", rendered)
        self.assertEqual(len(rendered), len(set(rendered)), "no duplicate probes")


if __name__ == "__main__":
    unittest.main()
