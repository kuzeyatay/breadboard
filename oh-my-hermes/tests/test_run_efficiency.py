from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from _cli_harness import run_cli
from _local_package import load_local_package


load_local_package()
from omh.local_store import atomic_write_json
from omh.paths import resolve_paths
from omh.runtime.run_efficiency import build_run_efficiency_report, parse_run_efficiency_input, write_run_efficiency_report


def _input_payload() -> dict[str, object]:
    return {
        "schema_version": "run_efficiency_input/v1",
        "run_id": "run-123",
        "context_budget": {
            "schema_version": "omh_run_context_budget/v1",
            "run_id": "run-123",
            "budget_bytes": 1000,
            "emitted_bytes": 250,
            "remaining_bytes": 750,
            "surfaces": {"runtime_show": 3, "progress_status": 1},
        },
        "observations": [
            {"metric": "wall_clock_duration_ms", "value": 24, "source_ref": "local-run-timer"},
            {"metric": "context_bytes", "value": 250, "source_ref": "context-budget"},
        ],
    }


class RunEfficiencyReportTests(unittest.TestCase):
    def test_report_projects_only_supplied_local_metrics_and_fixed_unobserved_domains(self) -> None:
        report = build_run_efficiency_report(parse_run_efficiency_input(_input_payload()))

        self.assertEqual(report["schema_version"], "run_efficiency_report/v1")
        self.assertEqual(report["run_id"], "run-123")
        self.assertEqual(report["context_utilization_ratio"], "0.250000")
        self.assertEqual(report["surface_counts"], {"progress_status": 1, "runtime_show": 3})
        self.assertEqual(len(report["observations"]), 2)
        self.assertEqual(
            report["not_observed"],
            {
                "provider": {"status": "not_observed"},
                "billing": {"status": "not_observed"},
                "cron": {"status": "not_observed"},
                "host": {"status": "not_observed"},
            },
        )
        self.assertIn("not provider, billing, cron, or host evidence", report["claim_boundary"])

    def test_parser_rejects_inconsistent_budget_and_unknown_metric(self) -> None:
        inconsistent = _input_payload()
        budget = inconsistent["context_budget"]
        self.assertIsInstance(budget, dict)
        budget["remaining_bytes"] = 749
        with self.assertRaisesRegex(ValueError, "remaining_bytes"):
            parse_run_efficiency_input(inconsistent)

        unknown_metric = _input_payload()
        observations = unknown_metric["observations"]
        self.assertIsInstance(observations, list)
        observations[0]["metric"] = "provider_cost"
        with self.assertRaisesRegex(ValueError, "metric"):
            parse_run_efficiency_input(unknown_metric)

        for secret_source_value in (
            "AKIAIOSFODNN7EXAMPLE",
            "AIzaSyDUMMYABCDEFGHIJKLMNOPQRSTUVWX123",
            "npm_12345678901234567890",
            "gho_12345678901234567890",
            "whsec_12345678901234567890",
        ):
            with self.subTest(source_ref=secret_source_value):
                secret_source = _input_payload()
                observations = secret_source["observations"]
                self.assertIsInstance(observations, list)
                observations[0]["source_ref"] = secret_source_value
                with self.assertRaisesRegex(ValueError, "safe opaque metadata reference"):
                    parse_run_efficiency_input(secret_source)

        secret_run_id = _input_payload()
        secret_run_id["run_id"] = "npm_12345678901234567890"
        budget = secret_run_id["context_budget"]
        self.assertIsInstance(budget, dict)
        budget["run_id"] = secret_run_id["run_id"]
        with self.assertRaisesRegex(ValueError, "safe opaque metadata reference"):
            parse_run_efficiency_input(secret_run_id)

        too_many_surfaces = _input_payload()
        budget = too_many_surfaces["context_budget"]
        self.assertIsInstance(budget, dict)
        budget["surfaces"] = {f"surface-{index}": index for index in range(33)}
        with self.assertRaisesRegex(ValueError, "at most 32"):
            parse_run_efficiency_input(too_many_surfaces)

    def test_write_uses_a_deterministic_hash_id_under_the_runtime_efficiency_store(self) -> None:
        with TemporaryDirectory() as tmp:
            paths = resolve_paths(Path(tmp) / ".omh", Path(tmp) / ".hermes")
            report = build_run_efficiency_report(parse_run_efficiency_input(_input_payload()))

            written = write_run_efficiency_report(paths, report)

            self.assertTrue(written["written"])
            self.assertTrue(written["path"].startswith(str(paths.runtime_efficiency_reports_dir)))
            self.assertTrue(Path(written["path"]).exists())
            self.assertTrue(written["report_id"].startswith("efficiency_"))

    def test_write_rejects_storage_resolving_outside_omh_home(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = resolve_paths(root / ".omh", root / ".hermes")
            paths.omh_home.mkdir()
            outside = root / "outside"
            outside.mkdir()
            paths.runtime_dir.symlink_to(outside, target_is_directory=True)
            report = build_run_efficiency_report(parse_run_efficiency_input(_input_payload()))

            with self.assertRaisesRegex(ValueError, "resolve under OMH home"):
                write_run_efficiency_report(paths, report)

    def test_cli_writes_only_when_requested(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            omh_home = root / ".omh"
            input_path = root / "input.json"
            atomic_write_json(input_path, _input_payload())

            status, stdout, stderr = run_cli(
                [
                    "--omh-home",
                    str(omh_home),
                    "runtime",
                    "efficiency-report",
                    "--input",
                    str(input_path),
                    "--write",
                ]
            )

            self.assertEqual(status, 0, stderr)
            self.assertEqual(stderr, "")
            payload = json.loads(stdout)
            self.assertEqual(payload["schema_version"], "run_efficiency_report/v1")
            self.assertTrue(payload["artifact"]["written"])
            self.assertTrue(Path(payload["artifact"]["path"]).exists())


if __name__ == "__main__":
    unittest.main()
