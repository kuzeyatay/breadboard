"""Retention policy tests for memory governance.

Tests volatile, standard, and durable retention classes with their respective
default and explicit TTL/revalidation deadline behavior.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from _local_package import load_local_package

load_local_package()
from omh.plugin_bundle.omh import memory_governance as governance


NOW = datetime(2026, 7, 30, 12, 0, 0, tzinfo=timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _approved_artifact(
    *,
    schema_version: str = governance.PROJECT_MEMORY_RECORD_SCHEMA_VERSION,
    retention_class: str = "standard",
    record_type: str = "procedure",
    summary: str = "Run deterministic release checks before deployment.",
    admission_state: str = "approved_manual",
    revalidation: dict[str, object] | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    id_key = {
        governance.PROJECT_MEMORY_RECORD_SCHEMA_VERSION: "record_id",
        governance.MEMORY_SCOPE_SCHEMA_VERSION: "item_id",
        governance.MEMORY_BLOCK_SCHEMA_VERSION: "block_id",
    }[schema_version]
    artifact: dict[str, object] = {
        "schema_version": schema_version,
        id_key: "mem_fixture",
        "revision": 1,
        "record_type": record_type,
        "summary": summary,
        "scope": {"kind": "project", "ref": "default"},
        "source_class": "omh_local",
        "retention": governance.build_retention(
            retention_class,
            record_type=record_type,
            admitted_at=NOW,
        ),
    }
    if schema_version == governance.MEMORY_SCOPE_SCHEMA_VERSION:
        artifact["value"] = "release-check-policy"
    if schema_version == governance.MEMORY_BLOCK_SCHEMA_VERSION:
        artifact["value"] = "release-check-policy"
        artifact["label"] = "release-policy"
    if revalidation is not None:
        artifact["revalidation"] = revalidation
    identity = governance.stable_artifact_identity(artifact)
    payload_digest = governance.canonical_payload_digest(artifact)
    review = {
        "schema_version": governance.PROJECT_MEMORY_REVIEW_RECORD_SCHEMA_VERSION,
        "review_id": "review_fixture",
        "artifact_identity": identity,
        "decision": admission_state,
        "payload_digest": payload_digest,
        "policy_version": governance.MEMORY_GOVERNANCE_POLICY_VERSION,
        "classifier_version": governance.MEMORY_CLASSIFIER_VERSION,
    }
    artifact["admission"] = {
        "state": admission_state,
        "admitted_at": _iso(NOW),
        "review_id": "review_fixture",
        "artifact_identity": identity,
        "payload_digest": payload_digest,
        "policy_version": governance.MEMORY_GOVERNANCE_POLICY_VERSION,
        "classifier_version": governance.MEMORY_CLASSIFIER_VERSION,
    }
    return artifact, review


def _evaluate(
    artifact: dict[str, object],
    review: dict[str, object],
    *,
    now: datetime = NOW,
    **kwargs: object,
) -> dict[str, object]:
    return governance.evaluate_memory_replay(
        artifact,
        now=now,
        requested_scope={"kind": "project", "ref": "default"},
        review_resolver={"review_fixture": review},
        **kwargs,
    )


class RetentionPolicyTests(unittest.TestCase):
    def test_volatile_is_explicit_and_expires_at_the_exact_admission_boundary(self) -> None:
        retention = governance.build_retention("volatile", record_type="fact", admitted_at=NOW)
        artifact, review = _approved_artifact(retention_class="volatile", record_type="fact")

        self.assertEqual(retention["class"], "volatile")
        self.assertEqual(retention["admitted_at"], _iso(NOW))
        self.assertEqual(retention["ttl_days"], 7)
        self.assertEqual(retention["expires_at"], _iso(NOW + timedelta(days=7)))
        self.assertTrue(_evaluate(artifact, review, now=NOW + timedelta(days=7) - timedelta(microseconds=1))["eligible"])
        boundary = _evaluate(artifact, review, now=NOW + timedelta(days=7))
        self.assertFalse(boundary["eligible"])
        self.assertEqual(boundary["reason_code"], "expired_volatile")

    def test_volatile_allows_only_explicit_shorter_one_to_seven_day_ttl(self) -> None:
        retention = governance.build_retention("volatile", record_type="fact", admitted_at=NOW, ttl_days=3)
        artifact, review = _approved_artifact(retention_class="volatile", record_type="fact")
        artifact["retention"] = retention
        digest = governance.canonical_payload_digest(artifact)
        artifact["admission"]["payload_digest"] = digest
        review["payload_digest"] = digest

        self.assertEqual(retention["expires_at"], _iso(NOW + timedelta(days=3)))
        self.assertEqual(_evaluate(artifact, review, now=NOW + timedelta(days=3) - timedelta(microseconds=1))["reason_code"], "eligible")
        self.assertEqual(_evaluate(artifact, review, now=NOW + timedelta(days=3))["reason_code"], "expired_volatile")
        for invalid_ttl in (0, 8, True, "3"):
            with self.subTest(invalid_ttl=invalid_ttl):
                with self.assertRaises(ValueError):
                    governance.build_retention("volatile", record_type="fact", admitted_at=NOW, ttl_days=invalid_ttl)  # type: ignore[arg-type]

    def test_standard_episode_keeps_its_thirty_day_default(self) -> None:
        retention = governance.build_retention("standard", record_type="episode", admitted_at=NOW)
        artifact, review = _approved_artifact(record_type="episode")

        self.assertEqual(retention["ttl_days"], 30)
        self.assertEqual(retention["expires_at"], _iso(NOW + timedelta(days=30)))
        result = _evaluate(artifact, review, now=NOW + timedelta(days=30))
        self.assertEqual(result["reason_code"], "expired_standard")

    def test_durable_has_no_default_deadline_but_honors_explicit_revalidation(self) -> None:
        artifact, review = _approved_artifact(retention_class="durable", record_type="fact")
        self.assertNotIn("expires_at", artifact["retention"])
        self.assertEqual(_evaluate(artifact, review, now=NOW + timedelta(days=3650))["reason_code"], "eligible")

        artifact, review = _approved_artifact(
            retention_class="durable",
            record_type="fact",
            revalidation={"deadline": _iso(NOW)},
        )
        self.assertEqual(_evaluate(artifact, review)["reason_code"], "stale_review_required")


if __name__ == "__main__":
    unittest.main()
