"""Deterministic, host-normalized evidence for OMH-owned memory fixtures."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
import math
import os
import platform
import random
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..paths import OmhPaths
from ..plugin_bundle.omh.memory_governance import canonical_payload_digest, evaluate_memory_replay, stable_artifact_identity
from ..version import __version__
from .memory_store import prune_expired_memory_evidence

EVALUATION_SCHEMA_VERSION = "omh_memory_evaluation/v1"
CORPUS_GENERATOR_VERSION = "omh-memory-evaluation-generator/v1"
FROZEN_TIME = datetime(2031, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
PROFILE_SPECS: dict[str, dict[str, int]] = {
    "small": {"seed": 101, "records": 6, "scopes": 2, "blocks": 3, "revision_chains": 1, "batch_plans": 1, "journal_entries": 4, "journal_limit": 4, "evidence_entries": 4, "evidence_limit": 4, "persisted_byte_ceiling": 20_000},
    "medium": {"seed": 202, "records": 48, "scopes": 24, "blocks": 12, "revision_chains": 5, "batch_plans": 4, "journal_entries": 24, "journal_limit": 12, "evidence_entries": 20, "evidence_limit": 10, "persisted_byte_ceiling": 128_000},
    "stress": {"seed": 303, "records": 180, "scopes": 90, "blocks": 45, "revision_chains": 12, "batch_plans": 8, "journal_entries": 120, "journal_limit": 24, "evidence_entries": 96, "evidence_limit": 16, "persisted_byte_ceiling": 512_000},
}
PROFILE_CONTRACTS = {"small": "every artifact type, retention class, admission state, correction, archive, and linked/unlinked lifecycle fixture", "medium": "ordering, omission accounting, revision chains, and concurrent batch-planning fixtures", "stress": "bounded journal/evidence fixture compaction and full-store scan on a modest host"}
_BASELINE_SPEC = {"records": 6, "scopes": 2, "blocks": 3, "revision_chains": 1, "batch_plans": 1, "journal_entries": 4, "journal_limit": 4, "evidence_entries": 4, "evidence_limit": 4, "persisted_byte_ceiling": 20_000}


def run_memory_evaluation(profile: str, *, repetitions: int = 3, seed: int | None = None, frozen_at: datetime = FROZEN_TIME) -> dict[str, object]:
    """Run a profile and an unchanged baseline in isolated temporary stores."""
    if profile not in PROFILE_SPECS:
        raise ValueError(f"unsupported evaluation profile: {profile}")
    if isinstance(repetitions, bool) or repetitions < 1:
        raise ValueError("repetitions must be at least 1")
    now = _utc(frozen_at)
    selected_seed = PROFILE_SPECS[profile]["seed"] if seed is None else seed
    if isinstance(selected_seed, bool) or not isinstance(selected_seed, int):
        raise ValueError("seed must be an integer")
    corpus = build_evaluation_corpus(profile, seed=selected_seed, frozen_at=now)
    baseline = _baseline_corpus(now)
    target_runs = [_measure(corpus, now) for _ in range(repetitions)]
    baseline_runs = [_measure(baseline, now) for _ in range(repetitions)]
    logical = target_runs[0][0]
    if any(result != logical for result, _elapsed in target_runs[1:]):
        raise RuntimeError("evaluation logical results were not deterministic")
    samples = [elapsed for _result, elapsed in target_runs]
    baseline_samples = [elapsed for _result, elapsed in baseline_runs]
    return {
        "schema_version": EVALUATION_SCHEMA_VERSION,
        "profile": profile,
        "seed": selected_seed,
        "generator_version": CORPUS_GENERATOR_VERSION,
        "corpus_digest": corpus_digest(corpus),
        "profile_counts": dict(PROFILE_SPECS[profile]),
        "profile_contract": PROFILE_CONTRACTS[profile],
        "frozen_at": _stamp(now),
        "host": _host_metadata(),
        "command": {"name": "omh memory evaluate", "version": __version__, "arguments": {"profile": profile, "repetitions": repetitions, "seed": selected_seed}},
        "raw_elapsed_ns": samples,
        "elapsed_summary_ns": _summary(samples),
        "repetitions": [{"elapsed_ns": elapsed, "logical_result": result} for result, elapsed in target_runs],
        "logical_result": logical,
        "baseline": {"corpus_digest": corpus_digest(baseline), "raw_elapsed_ns": baseline_samples, "elapsed_summary_ns": _summary(baseline_samples)},
        "same_host_normalization": {"method": "pairwise target/baseline elapsed ratios from this invocation only", "target_to_baseline_sample_ratios": derive_same_host_ratios(samples, baseline_samples)},
        "vps_artifact": {"recorded": False, "claim": "No VPS result is claimed; a VPS result exists only when an actual VPS artifact is produced."},
        "claim_boundary": "OMH-owned synthetic fixture evidence only. Correctness gates are exact ids, reason-code counts, and persisted bytes, never elapsed time. No fixed latency threshold or cross-host absolute comparison is asserted; ratios are same-host only. LongMemEval, LoCoMo, MemoryAgentBench, and vendor scores are not pass criteria. No VPS result is claimed without an actual VPS artifact.",
    }


def build_evaluation_corpus(profile: str, *, seed: int | None = None, frozen_at: datetime = FROZEN_TIME) -> dict[str, object]:
    if profile not in PROFILE_SPECS:
        raise ValueError(f"unsupported evaluation profile: {profile}")
    spec, now = PROFILE_SPECS[profile], _utc(frozen_at)
    chosen_seed = spec["seed"] if seed is None else seed
    if isinstance(chosen_seed, bool) or not isinstance(chosen_seed, int):
        raise ValueError("seed must be an integer")
    return _corpus(profile, dict(spec), chosen_seed, now)


def corpus_digest(corpus: dict[str, object]) -> str:
    return hashlib.sha256(json.dumps(corpus, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def derive_same_host_ratios(target: list[int], baseline: list[int]) -> list[float | None]:
    return [round(value / reference, 12) if reference else None for value, reference in zip(target, baseline)]


def _corpus(name: str, spec: dict[str, int], seed: int, now: datetime) -> dict[str, object]:
    artifacts: list[dict[str, object]] = [
        _artifact(name, "record", 1, "standard", "approved_manual", "eligible", now),
        _artifact(name, "scope", 1, "durable", "approved_auto_safe", "eligible", now),
        _artifact(name, "block", 1, "volatile", "approved_auto_safe", "eligible", now),
        _artifact(name, "record", 2, "standard", "pending_review", "review_required", now),
        _artifact(name, "scope", 2, "standard", "blocked", "admission_blocked", now),
        _artifact(name, "block", 2, "standard", "rejected", "admission_rejected", now),
        _artifact(name, "record", 3, "volatile", "approved_manual", "expired_volatile", now),
        _artifact(name, "record", 4, "standard", "approved_manual", "superseded", now),
        _artifact(name, "record", 5, "standard", "approved_manual", "archived", now, lifecycle="archived"),
        _artifact(name, "record", 6, "durable", "approved_auto_safe", "eligible", now, lifecycle="linked"),
        _artifact(name, "block", 3, "standard", "approved_manual", "eligible", now, lifecycle="unlinked"),
    ]
    next_number = {"record": 7, "scope": 3, "block": 4}
    for chain in range(2, spec["revision_chains"] + 1):
        number = next_number["record"]
        artifacts.append(_artifact(name, "record", number, "standard", "approved_manual", "superseded", now, revision=chain))
        next_number["record"] += 1
    for kind, count in (("record", spec["records"]), ("scope", spec["scopes"]), ("block", spec["blocks"])):
        existing = sum(artifact["artifact_kind"] == kind for artifact in artifacts)
        for _index in range(existing, count):
            number = next_number[kind]
            artifacts.append(_artifact(name, kind, number, ("standard", "durable", "volatile")[(number + seed) % 3], "approved_auto_safe", "eligible", now))
            next_number[kind] += 1
    random.Random(seed).shuffle(artifacts)
    plans = [{"batch_id": f"{name}-batch-{index:03d}", "planned_scopes": [f"scope-{index:03d}", f"scope-{index + 1:03d}"], "planning": "concurrent_batch_fixture"} for index in range(spec["batch_plans"])]
    return {"profile": name, "seed": seed, "generator_version": CORPUS_GENERATOR_VERSION, "frozen_at": _stamp(now), "counts": spec, "artifacts": artifacts, "batch_plans": plans}


def _artifact(name: str, kind: str, number: int, retention_class: str, state: str, expected: str, now: datetime, *, lifecycle: str = "active", revision: int = 1) -> dict[str, object]:
    schema, id_key = {"record": ("project_memory_record/v2", "record_id"), "scope": ("omh_memory_scope/v2", "item_id"), "block": ("omh_memory_block/v2", "block_id")}[kind]
    identifier = f"{name}-{kind}-{number:04d}"
    retention: dict[str, object] = {"class": retention_class, "admitted_at": _stamp(now - timedelta(days=1))}
    if retention_class == "volatile":
        retention["expires_at"] = _stamp(now if expected == "expired_volatile" else now + timedelta(days=6))
    artifact: dict[str, object] = {"schema_version": schema, id_key: identifier, "revision": revision, "summary": f"{kind} evaluation fixture {number:04d}", "scope": {"kind": "project", "ref": "evaluation"}, "retention": retention, "source_class": "omh_local", "artifact_kind": kind, "lifecycle": lifecycle, "expected_reason": expected}
    if kind == "record":
        artifact["record_type"] = "fact"
    elif kind == "block":
        artifact["label"] = identifier
        artifact["value"] = f"bounded fixture {number:04d}"
    if expected == "superseded":
        artifact["superseded_by"] = f"{identifier}-next"
    admission: dict[str, object] = {"state": state}
    if state.startswith("approved_"):
        admission["review_id"] = f"review-{identifier}-{revision}"
        admission["payload_digest"] = canonical_payload_digest(artifact)
    artifact["admission"] = admission
    return artifact


def _baseline_corpus(now: datetime) -> dict[str, object]:
    return _corpus("baseline", dict(_BASELINE_SPEC), 0, now)


def _measure(corpus: dict[str, object], now: datetime) -> tuple[dict[str, object], int]:
    with tempfile.TemporaryDirectory(prefix="omh-memory-evaluation-") as temporary:
        started = time.perf_counter_ns()
        result = _persist_and_evaluate(corpus, OmhPaths(Path(temporary) / "omh", Path(temporary) / "hermes"), now)
        return result, time.perf_counter_ns() - started


def _persist_and_evaluate(corpus: dict[str, object], paths: OmhPaths, now: datetime) -> dict[str, object]:
    artifacts = [dict(value) for value in corpus["artifacts"] if isinstance(value, dict)]
    expected_ids = sorted(_identifier(value) for value in artifacts if value["expected_reason"] == "eligible")
    expected_reasons = _reason_counts(str(value["expected_reason"]) for value in artifacts)
    expected_bytes = 0
    reviews: dict[str, dict[str, object]] = {}
    for artifact in artifacts:
        expected_bytes += _write(_artifact_path(paths, artifact), artifact)
        admission = artifact.get("admission")
        if isinstance(admission, dict) and isinstance(admission.get("review_id"), str):
            reviews[str(admission["review_id"])] = {"artifact_identity": stable_artifact_identity(artifact), "payload_digest": canonical_payload_digest(artifact)}
    for plan in corpus["batch_plans"] if isinstance(corpus["batch_plans"], list) else []:
        if isinstance(plan, dict):
            expected_bytes += _write(paths.memory_dir / "staging" / f"{plan['batch_id']}.json", plan)
    counts = corpus["counts"] if isinstance(corpus["counts"], dict) else {}
    journal, evidence = _bounded_lines("journal", int(counts.get("journal_entries", 0)), int(counts.get("journal_limit", 0))), _bounded_lines("evidence", int(counts.get("evidence_entries", 0)), int(counts.get("evidence_limit", 0)))
    expected_bytes += _write_lines(paths.memory_dir / "journal" / "events.jsonl", journal)
    expected_bytes += _write_lines(paths.memory_dir / "operations" / "evidence.jsonl", evidence)
    # Write valid aged operation and tombstone that will be pruned (removed).
    # These records have schema_version so _prune_dir can recognize and remove them.
    # They are not included in expected_bytes since they are expired and will be removed by prune_expired_memory_evidence.
    aged_op_timestamp = _stamp(now - timedelta(days=31))
    _write(paths.memory_operations_dir / "aged-operation.json", {"schema_version": "memory_operation/v1", "operation_id": "aged-operation", "operation_type": "test", "state": "completed", "created_at": aged_op_timestamp, "updated_at": aged_op_timestamp, "recovery_count": 0, "steps": [{"name": "test", "action": "move", "state": "completed", "source": "records/test.json", "target": "archive/test.json"}], "receipt": {"schema_version": "memory_receipt/v1", "operation_id": "aged-operation", "operation_type": "test", "state": "completed", "created_at": aged_op_timestamp, "completed_at": aged_op_timestamp, "step_count": 1, "recovery_count": 0, "outcome": "ok"}})
    aged_ts_timestamp = _stamp(now - timedelta(days=31))
    _write(paths.memory_tombstones_dir / "aged-tombstone.json", {"schema_version": "memory_tombstone/v1", "tombstone_id": "aged-tombstone", "record_id": "test-record", "revision": 1, "scope": {"kind": "project", "ref": "test"}, "operation_id": "aged-operation", "reason_code": "pruned", "actor_class": "omh_local", "tombstoned_at": aged_ts_timestamp, "expires_at": aged_ts_timestamp})
    pruned = prune_expired_memory_evidence(paths, now=now, retention_days=30)
    observed: list[tuple[str, str]] = []
    for artifact in artifacts:
        reason = "archived" if artifact.get("lifecycle") == "archived" else str(evaluate_memory_replay(artifact, now=now, requested_scope={"kind": "project", "ref": "evaluation"}, review_resolver=reviews)["reason_code"])
        if reason == "eligible":
            observed.append((_identifier(artifact), reason))
        else:
            observed.append((_identifier(artifact), reason))
    observed_ids = sorted(identifier for identifier, reason in observed if reason == "eligible")
    observed_reasons = _reason_counts(reason for _identifier, reason in observed)
    persisted_bytes = sum(path.stat().st_size for path in paths.memory_dir.rglob("*") if path.is_file())
    byte_ceiling = int(counts.get("persisted_byte_ceiling", expected_bytes))
    gates = {"exact_included_ids": expected_ids == observed_ids, "exact_reason_code_counts": expected_reasons == observed_reasons, "exact_persisted_bytes": expected_bytes == persisted_bytes, "within_declared_byte_ceiling": persisted_bytes <= byte_ceiling}
    return {"expected": {"included_ids": expected_ids, "reason_code_counts": expected_reasons, "persisted_bytes": expected_bytes, "persisted_byte_ceiling": byte_ceiling}, "observed": {"included_ids": observed_ids, "reason_code_counts": observed_reasons, "persisted_bytes": persisted_bytes}, "correctness_gates": {**gates, "passed": all(gates.values())}, "compaction": {"journal": {"input_count": int(counts.get("journal_entries", 0)), "retained_count": len(journal)}, "evidence": {"input_count": int(counts.get("evidence_entries", 0)), "retained_count": len(evidence)}, "expired_store_evidence": {"removed_operations": pruned["removed_operations"], "removed_tombstones": pruned["removed_tombstones"]}}, "scan_file_count": sum(1 for path in paths.memory_dir.rglob("*") if path.is_file()), "store_measurement_boundary": "The available store hook prunes expired operation/tombstone evidence. No store API exposes journal compaction, so journal retention is measured as a deterministic fixture layout rather than attributed to an unavailable store compactor."}


def _artifact_path(paths: OmhPaths, artifact: dict[str, object]) -> Path:
    directory = "archive" if artifact.get("lifecycle") == "archived" else {"record": "records", "scope": "scopes", "block": "blocks"}[str(artifact["artifact_kind"])]
    return paths.memory_dir / directory / f"{_identifier(artifact)}.json"


def _identifier(artifact: dict[str, object]) -> str:
    return str(artifact.get("record_id") or artifact.get("item_id") or artifact.get("block_id") or "")


def _bounded_lines(kind: str, count: int, limit: int) -> list[str]:
    return [json.dumps({"schema_version": "omh_memory_evaluation_event/v1", "kind": kind, "id": f"{kind}-{index:04d}"}, sort_keys=True, separators=(",", ":")) for index in range(max(count, 0))][-max(limit, 0):]


def _write(path: Path, value: dict[str, object]) -> int:
    text = json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline="" keeps disk bytes equal to the returned byte count; the
    # exact_persisted_bytes correctness gate compares the two.
    path.write_text(text, encoding="utf-8", newline="")
    return len(text.encode("utf-8"))


def _write_lines(path: Path, lines: list[str]) -> int:
    text = "".join(f"{line}\n" for line in lines)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="")
    return len(text.encode("utf-8"))


def _reason_counts(reasons: Iterable[object]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for reason in reasons:
        key = str(reason)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def _summary(samples: list[int]) -> dict[str, int]:
    ordered = sorted(samples)
    return {"sample_count": len(samples), "p50": ordered[math.ceil(len(ordered) * 0.50) - 1], "p95": ordered[math.ceil(len(ordered) * 0.95) - 1], "max": ordered[-1]}


def _host_metadata() -> dict[str, object]:
    return {"python": {"implementation": platform.python_implementation(), "version": sys.version.split()[0]}, "platform": {"system": platform.system(), "release": platform.release(), "version": platform.version()}, "machine": platform.machine(), "cpu_count": os.cpu_count(), "filesystem_type": _filesystem_type(Path(tempfile.gettempdir()))}


def _filesystem_type(path: Path) -> str | None:
    # Stdlib-only Darwin/macOS filesystem type capture via os.statvfs.
    # On macOS, f_fstypename is available in statvfs result; on Linux, parse /proc/self/mountinfo.
    try:
        stat = os.statvfs(path)
        native = getattr(stat, "f_fstypename", None)
        if isinstance(native, str) and native:
            return native
    except (OSError, AttributeError):
        # statvfs may fail on some paths; fall through to mountinfo parsing.
        pass
    # Linux-only: parse /proc/self/mountinfo if available.
    mountinfo = Path("/proc/self/mountinfo")
    if not mountinfo.is_file():
        # Not on Linux or /proc is not available; filesystem type cannot be determined.
        return None
    try:
        target, matches = str(path.resolve()), []
        for line in mountinfo.read_text(encoding="utf-8", errors="replace").splitlines():
            left, separator, right = line.partition(" - ")
            fields, tail = left.split(), right.split()
            if separator and len(fields) > 4 and tail and (target == fields[4] or target.startswith(fields[4].rstrip("/") + "/")):
                matches.append((fields[4], tail[0]))
        return max(matches, key=lambda item: len(item[0]))[1] if matches else None
    except (OSError, ValueError):
        # Parsing failed; filesystem type could not be determined.
        return None


def _stamp(value: datetime) -> str:
    return _utc(value).isoformat().replace("+00:00", "Z")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
