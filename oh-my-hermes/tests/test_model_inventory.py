from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest import mock

from _local_package import load_local_package

load_local_package()

from _cli_harness import run_cli  # noqa: E402
from omh.coding.model_inventory import (  # noqa: E402
    CLI_PRESENCE_COMMANDS,
    LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
    MODEL_DOMAIN_AFFINITIES,
    MODEL_DOMAIN_AFFINITY_CLAIM_BOUNDARY,
    MODEL_INVENTORY_CATALOG_PROFILE,
    MODEL_INVENTORY_SCHEMA_VERSION,
    OMO_CATEGORY_ROLE_SOURCES,
    catalog_fingerprint_note,
    inventory_model_catalog,
    local_model_inventory,
)

_SECRET = "sk-SECRET-VALUE-12345"


def _write_home(
    tmp: str,
    *,
    omo_config: object | None = None,
    omo_raw: str | None = None,
    opencode_config: object | None = None,
    auth: object | None = None,
) -> Path:
    home = Path(tmp)
    config_dir = home / ".config" / "opencode"
    config_dir.mkdir(parents=True, exist_ok=True)
    if omo_raw is not None:
        (config_dir / "oh-my-openagent.json").write_text(omo_raw, encoding="utf-8")
    elif omo_config is not None:
        (config_dir / "oh-my-openagent.json").write_text(json.dumps(omo_config), encoding="utf-8")
    if opencode_config is not None:
        (config_dir / "opencode.json").write_text(json.dumps(opencode_config), encoding="utf-8")
    if auth is not None:
        auth_dir = home / ".local" / "share" / "opencode"
        auth_dir.mkdir(parents=True, exist_ok=True)
        (auth_dir / "auth.json").write_text(json.dumps(auth), encoding="utf-8")
    return home


_OMO_FIXTURE = {
    "$schema": "https://example.invalid/schema.json",
    "agents": {
        "planner": {
            "model": "openai/gpt-5.6-sol",
            "variant": "xhigh",
            "fallback_models": [
                {"model": "opencode/kimi-k3", "variant": "high"},
                {"model": "opencode/glm-5"},
            ],
        },
    },
    "categories": {
        "visual-engineering": {
            "model": "opencode/gemini-3.1-pro",
            "variant": "high",
            "fallback_models": [{"model": "anthropic/claude-opus-5", "variant": "max"}],
        },
    },
}


class ModelInventoryTests(unittest.TestCase):
    def test_models_are_aggregated_with_families_and_variants(self) -> None:
        with TemporaryDirectory() as tmp:
            home = _write_home(tmp, omo_config=_OMO_FIXTURE)
            inventory = local_model_inventory(home)
        self.assertEqual(inventory["schema_version"], MODEL_INVENTORY_SCHEMA_VERSION)
        models = {f"{entry['provider']}/{entry['model_id']}": entry for entry in inventory["available_models"]}
        self.assertEqual(models["opencode/kimi-k3"]["family"], "kimi")
        self.assertEqual(models["opencode/kimi-k3"]["variants"], ["high"])
        self.assertEqual(models["opencode/glm-5"]["family"], "glm")
        self.assertEqual(models["opencode/gemini-3.1-pro"]["family"], "gemini")
        self.assertEqual(models["anthropic/claude-opus-5"]["variants"], ["max"])
        self.assertEqual(
            inventory["families_present"], ["claude", "gemini", "glm", "gpt", "kimi"]
        )
        self.assertEqual(inventory["sources"]["omo_agent_config"]["status"], "present")
        self.assertEqual(inventory["sources"]["omo_agent_config"]["model_count"], 5)
        self.assertEqual(inventory["sources"]["omo_agent_config"]["rejected"], 0)

    def test_no_secret_value_ever_reaches_the_payload(self) -> None:
        # Precedent: tests/test_executor_auth_signals.py — plant a secret in
        # every source file and assert the serialized payload never echoes it.
        omo = json.loads(json.dumps(_OMO_FIXTURE))
        omo["agents"]["planner"]["api_key"] = _SECRET
        with TemporaryDirectory() as tmp:
            home = _write_home(
                tmp,
                omo_config=omo,
                opencode_config={"provider": {"openai": {"apiKey": _SECRET}}},
                auth={"anthropic": {"type": "oauth", "access": _SECRET}},
            )
            inventory = local_model_inventory(home)
        serialized = json.dumps(inventory)
        self.assertNotIn(_SECRET, serialized)
        # Provider key NAMES are the only thing read from auth/config tables.
        self.assertEqual(inventory["sources"]["opencode_config_providers"]["providers"], ["openai"])
        self.assertEqual(inventory["sources"]["opencode_auth_providers"]["providers"], ["anthropic"])

    def test_absent_and_malformed_sources_report_status_without_paths(self) -> None:
        with TemporaryDirectory() as tmp:
            inventory = local_model_inventory(Path(tmp))
            self.assertEqual(inventory["sources"]["omo_agent_config"]["status"], "absent")
            self.assertEqual(inventory["sources"]["opencode_auth_providers"]["status"], "absent")
            self.assertEqual(inventory["available_models"], [])
            self.assertNotIn(tmp, json.dumps(inventory))
        with TemporaryDirectory() as tmp:
            home = _write_home(tmp, omo_raw="{not json", opencode_config={"provider": []})
            inventory = local_model_inventory(home)
            self.assertEqual(inventory["sources"]["omo_agent_config"]["status"], "unreadable")
            # A present file whose section has the wrong shape is not a crash.
            self.assertEqual(inventory["sources"]["opencode_config_providers"]["providers"], [])
            self.assertNotIn(tmp, json.dumps(inventory))

    def test_shape_gate_rejects_hostile_identifiers_without_echoing(self) -> None:
        hostile = {
            "agents": {
                "bad": {
                    "model": "--rm -rf /",
                    "fallback_models": [
                        {"model": "openai/gpt-5.6-sol", "variant": "high"},
                        {"model": "x" * 200},
                        {"model": "openai/api_key=leak"},
                    ],
                },
            },
        }
        with TemporaryDirectory() as tmp:
            inventory = local_model_inventory(_write_home(tmp, omo_config=hostile))
        source = inventory["sources"]["omo_agent_config"]
        self.assertEqual(source["rejected"], 3)
        self.assertEqual(source["model_count"], 1)
        serialized = json.dumps(inventory)
        self.assertNotIn("--rm", serialized)
        self.assertNotIn("x" * 200, serialized)
        self.assertNotIn("api_key", serialized)
        models = [f"{entry['provider']}/{entry['model_id']}" for entry in inventory["available_models"]]
        self.assertEqual(models, ["openai/gpt-5.6-sol"])

    def test_inventory_is_deterministic_modulo_observed_at(self) -> None:
        with TemporaryDirectory() as tmp:
            home = _write_home(tmp, omo_config=_OMO_FIXTURE)
            first = local_model_inventory(home)
            second = local_model_inventory(home)
        for payload in (first, second):
            payload.pop("observed_at")
            payload["sources"]["executor_auth_signals"].pop("observed_at", None)
        self.assertEqual(first, second)

    def test_domain_affinity_notes_are_report_only_static_vocabulary(self) -> None:
        self.assertEqual(MODEL_DOMAIN_AFFINITIES["x_platform_data"], ("grok",))
        with TemporaryDirectory() as tmp:
            inventory = local_model_inventory(_write_home(tmp, omo_config=_OMO_FIXTURE))
        notes = {note["domain"]: note for note in inventory["domain_affinity_notes"]}
        self.assertEqual(notes["x_platform_data"]["locally_present"], [])
        self.assertEqual(notes["multimodal_vision"]["locally_present"], ["claude", "gemini", "gpt"])
        # The affinity table is an editorial default, not a capability claim:
        # its own boundary rides the payload (critic-mandated condition).
        self.assertEqual(inventory["domain_affinity_claim_boundary"], MODEL_DOMAIN_AFFINITY_CLAIM_BOUNDARY)
        self.assertIn("never a veto", MODEL_DOMAIN_AFFINITY_CLAIM_BOUNDARY)
        self.assertIn("explicit model choice", MODEL_DOMAIN_AFFINITY_CLAIM_BOUNDARY)

    def test_affinity_vocabulary_reaches_routing_only_as_catalog_data(self) -> None:
        """Routing consumes domain affinities exclusively via the local
        catalog payload: the vocabulary constants and domain literals never
        appear in routing, dispatch, or contract module SOURCE, so built-in
        chains cannot grow a hidden affinity dependency."""
        src = Path(__file__).resolve().parent.parent / "src" / "coding"
        for module in ("model_routing.py", "fanout_dispatch.py", "fanout.py", "fanout_contracts.py"):
            source = (src / module).read_text(encoding="utf-8")
            self.assertNotIn("MODEL_DOMAIN_AFFINITIES", source, module)
            self.assertNotIn("x_platform_data", source, module)

    def test_routing_never_imports_the_inventory(self) -> None:
        """Reporting-only is a structural property: the route resolver must not
        read the inventory (or any file), so the import direction is pinned."""
        routing_source = (
            Path(__file__).resolve().parent.parent / "src" / "coding" / "model_routing.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("model_inventory", routing_source)

    def test_cli_presence_table_is_fixed_vocabulary(self) -> None:
        self.assertEqual(
            CLI_PRESENCE_COMMANDS,
            ("codex", "claude", "opencode", "pi", "senpi", "gemini", "grok", "qwen"),
        )

    def test_senpi_auth_provider_names_are_presence_only(self) -> None:
        with TemporaryDirectory() as tmp:
            home = Path(tmp)
            senpi_dir = home / ".senpi" / "agent"
            senpi_dir.mkdir(parents=True)
            (senpi_dir / "auth.json").write_text(
                json.dumps({"kimi-coding": {"type": "api", "key": _SECRET}}), encoding="utf-8"
            )
            inventory = local_model_inventory(home)
        source = inventory["sources"]["senpi_auth_providers"]
        self.assertEqual(source["status"], "present")
        self.assertEqual(source["providers"], ["kimi-coding"])
        self.assertNotIn(_SECRET, json.dumps(inventory))


class InventoryModelCatalogTests(unittest.TestCase):
    def _catalog(self) -> dict:
        with TemporaryDirectory() as tmp:
            inventory = local_model_inventory(_write_home(tmp, omo_config=_OMO_FIXTURE))
        catalog = inventory_model_catalog(inventory)
        assert catalog is not None
        return catalog

    def test_catalog_targets_the_omo_runtime_profile(self) -> None:
        catalog = self._catalog()
        self.assertEqual(catalog["schema_version"], LOCAL_MODEL_CATALOG_SCHEMA_VERSION)
        self.assertEqual(catalog["executor_profile"], MODEL_INVENTORY_CATALOG_PROFILE)
        self.assertEqual(catalog["catalog_kind"], "local_inventory")
        # The affinity vocabulary rides the catalog so routing consumes it as
        # data, never as an import.
        self.assertEqual(catalog["domain_affinities"], MODEL_DOMAIN_AFFINITIES)

    def test_chains_derive_from_category_role_sources_in_config_order(self) -> None:
        catalog = self._catalog()
        chains = catalog["chains"]
        # The fixture declares only visual-engineering; only roles sourcing it
        # gain a chain, in the config's own primary-then-fallback order.
        self.assertEqual(
            [entry["model_id"] for entry in chains["design_visual"]],
            ["opencode/gemini-3.1-pro", "anthropic/claude-opus-5"],
        )
        self.assertEqual(chains["design_visual"][0]["reasoning_effort"], "high")
        self.assertNotIn("brain", chains)
        self.assertIn("design_visual", OMO_CATEGORY_ROLE_SOURCES)

    def test_options_never_carry_effort_authority(self) -> None:
        catalog = self._catalog()
        for option in catalog["options"]:
            self.assertEqual(option["reasoning_efforts"], ())

    def test_fingerprint_is_deterministic_for_an_unchanged_config(self) -> None:
        first = self._catalog()
        second = self._catalog()
        self.assertEqual(first["fingerprint"]["digest"], second["fingerprint"]["digest"])
        self.assertIn("omo_agent_config", first["fingerprint"]["sources"])

    def test_fingerprint_changes_when_chains_move_across_the_same_models(self) -> None:
        """The digest anchors the derived artifact: reassigning a category to
        an already-present model must change the digest even though the model
        SET is identical — that reassignment is exactly the drift the
        fingerprint exists to make visible."""
        base = {
            "categories": {
                "ultrabrain": {"model": "opencode/glm-5"},
                "quick": {"model": "opencode/gemini-3-flash"},
            }
        }
        swapped = {
            "categories": {
                "ultrabrain": {"model": "opencode/gemini-3-flash"},
                "quick": {"model": "opencode/glm-5"},
            }
        }
        digests = []
        for config in (base, swapped):
            with TemporaryDirectory() as tmp:
                inventory = local_model_inventory(_write_home(tmp, omo_config=config))
            catalog = inventory_model_catalog(inventory)
            assert catalog is not None
            digests.append(catalog["fingerprint"]["digest"])
        self.assertNotEqual(digests[0], digests[1])

    def test_empty_inventory_yields_no_catalog(self) -> None:
        with TemporaryDirectory() as tmp:
            inventory = local_model_inventory(Path(tmp))
        self.assertIsNone(inventory_model_catalog(inventory))

    def test_fingerprint_note_reports_skew_advisorily(self) -> None:
        route = {"catalog_fingerprint": {"digest": "abc123"}}
        note = catalog_fingerprint_note(route, "abc123")
        self.assertEqual(note, {"frozen_digest": "abc123", "current_digest": "abc123", "match": True})
        drifted = catalog_fingerprint_note(route, "def456")
        self.assertFalse(drifted["match"])
        self.assertIsNone(catalog_fingerprint_note({"selected_model": "x"}, "abc123"))
        self.assertIsNone(catalog_fingerprint_note(None, "abc123"))


class ModelInventoryCliTests(unittest.TestCase):
    def test_fanout_prepare_freezes_local_route_with_fingerprint(self) -> None:
        """A unit owned by the OMO runtime with a declared role freezes a
        route resolved from the user's own config — catalog_kind plus the
        inventory fingerprint land in the contract so the basis is named."""
        units = json.dumps(
            [
                {
                    "unit_id": "visual",
                    "title": "Visual work",
                    "owner": "omo-runtime",
                    "file_scope": ["src/ui/"],
                    "role": "design_visual",
                    "domain": "multimodal_vision",
                },
                {
                    "unit_id": "aux",
                    "title": "Aux",
                    "owner": "codex",
                    "file_scope": ["docs/"],
                },
            ]
        )
        with TemporaryDirectory() as tmp:
            home = _write_home(tmp, omo_config=_OMO_FIXTURE)
            with mock.patch.dict("os.environ", {"HOME": str(home), "USERPROFILE": str(home)}):
                status, stdout, _stderr = run_cli(
                    ["coding", "fanout", "prepare", "--goal", "ship", "the", "feature", "--units", "-"],
                    stdin_text=units,
                )
        self.assertEqual(status, 0)
        contract = json.loads(stdout)
        by_id = {unit["unit_id"]: unit for unit in contract["units"]}
        route = by_id["visual"]["handoff"]["model_route"]
        self.assertEqual(route["catalog_kind"], "local_inventory")
        self.assertEqual(route["selected_model"], "opencode/gemini-3.1-pro")
        self.assertTrue(route["catalog_fingerprint"]["digest"])
        # The declared domain rides the frozen route with its attempted trail.
        self.assertEqual(route["domain"], "multimodal_vision")
        self.assertIn("domain_affinity", [entry["stage"] for entry in route["attempted"]])
        # Built-in-catalog owners stay on built-in resolution, untouched.
        self.assertNotIn("model_route", by_id["aux"]["handoff"])

    def test_prepare_without_catalogless_owners_is_home_independent(self) -> None:
        """A codex/claude-only contract must stay byte-identical across
        machines: prepare consults the inventory only when a unit names a
        profile without a built-in catalog, so whatever local config exists
        must not leak into the contract."""
        units = json.dumps(
            [
                {"unit_id": "core", "title": "Core", "owner": "codex", "file_scope": ["src/a/"], "role": "brain"},
                {"unit_id": "aux", "title": "Aux", "owner": "claude-code", "file_scope": ["docs/"], "role": "docs"},
            ]
        )
        outputs = []
        for config in (_OMO_FIXTURE, None):
            with TemporaryDirectory() as tmp:
                home = _write_home(tmp, omo_config=config) if config else Path(tmp)
                with mock.patch.dict("os.environ", {"HOME": str(home), "USERPROFILE": str(home)}):
                    status, stdout, _stderr = run_cli(
                        ["coding", "fanout", "prepare", "--goal", "ship", "it", "--units", "-"],
                        stdin_text=units,
                    )
            self.assertEqual(status, 0)
            outputs.append(stdout)
        self.assertEqual(outputs[0], outputs[1])

    def test_model_route_cli_from_inventory_flag(self) -> None:
        with TemporaryDirectory() as tmp:
            home = _write_home(tmp, omo_config=_OMO_FIXTURE)
            with mock.patch.dict("os.environ", {"HOME": str(home), "USERPROFILE": str(home)}):
                status, stdout, _stderr = run_cli(
                    [
                        "coding",
                        "model-route",
                        "--executor",
                        "omo-runtime",
                        "--role",
                        "design_visual",
                        "--from-inventory",
                        "--json",
                    ]
                )
        self.assertEqual(status, 0)
        route = json.loads(stdout)
        self.assertEqual(route["status"], "routed")
        self.assertEqual(route["catalog_kind"], "local_inventory")
        self.assertEqual(route["selected_model"], "opencode/gemini-3.1-pro")

    def test_cli_plain_text_default_and_json_optin(self) -> None:
        with TemporaryDirectory() as tmp:
            home = _write_home(tmp, omo_config=_OMO_FIXTURE)
            with mock.patch.dict("os.environ", {"HOME": str(home), "USERPROFILE": str(home)}):
                status, stdout, _stderr = run_cli(
                    ["coding", "model-inventory"], output_json=False
                )
                self.assertEqual(status, 0)
                self.assertIn("Local model inventory", stdout)
                self.assertIn("opencode/kimi-k3 [kimi]", stdout)
                self.assertIn("x_platform_data work favors grok", stdout)
                status, stdout, _stderr = run_cli(["coding", "model-inventory", "--json"])
                self.assertEqual(status, 0)
                payload = json.loads(stdout)
        self.assertEqual(payload["schema_version"], MODEL_INVENTORY_SCHEMA_VERSION)
        self.assertTrue(payload["available_models"])


if __name__ == "__main__":
    unittest.main()
