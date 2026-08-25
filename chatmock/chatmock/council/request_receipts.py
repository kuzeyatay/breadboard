from __future__ import annotations

"""Strict, prompt-free persistence for recoverable Council requests.

The normal Council ledger is deliberately best-effort.  Recoverable requests
need the opposite contract: a request receipt must be durable before any
provider call is allowed to start, and a malformed/conflicting receipt must
fail closed.  This module therefore does not use ``CouncilLedger`` and never
swallows persistence errors.
"""

import hashlib
import hmac
import json
import math
import os
import re
import struct
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from .ledger import default_ledger_dir
from .types import CouncilInput, CouncilRun


CANONICAL_REQUEST_SCHEMA_VERSION = 1
RECEIPT_SCHEMA_VERSION = 1
REDISPATCH_CLAIM_SCHEMA_VERSION = 1
DISPATCH_EVIDENCE_VERSION = 1
REDISPATCHABLE_FAILURE_CODE = "council_no_final_answer"
_REQUEST_ID_RE = re.compile(r"^lrq_[A-Za-z0-9_-]{8,120}$")
_REQUEST_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_ROUTING_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,240}$")
_JS_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_MAX_FINAL_ANSWER_CHARS = 16 * 1024 * 1024
_MAX_ROUTING_ENTRIES = 64
_MAX_DIAGNOSTIC_CHARS = 16 * 1024
_COUNCIL_MODES = frozenset(
    ("direct_council", "lite_council", "full_council", "evolution_council")
)
_USAGE_KEYS = (
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedInputTokens",
    "reasoningTokens",
    "callCount",
    "reportedCallCount",
)
_ROUTING_KEYS = (
    "schemaVersion",
    "at",
    "requestId",
    "endpoint",
    "requestedModel",
    "resolvedModel",
    "upstreamModel",
    "provider",
    "outcome",
    "fallback",
    "statusCode",
    "errorCode",
    "failurePhase",
    "partialOutput",
    "replaySafe",
)
_LEGACY_CANONICAL_TAIL_BYTES = 512
_LEGACY_CANONICAL_TAIL_RE = re.compile(
    rb'(?:^|\r?\n)  "createdAt": "([^"\\\r\n]+)",\r?\n'
    rb'  "updatedAt": "[^"\\\r\n]+"\r?\n}\r?\n?\Z'
)


class CouncilReceiptError(RuntimeError):
    """Base class for fail-closed receipt failures."""


class CouncilReceiptConflict(CouncilReceiptError):
    """The client id is already bound or the supplied hash is not exact."""


class CouncilReceiptCorrupt(CouncilReceiptError):
    """A durable receipt exists but cannot be trusted."""


class CouncilReceiptNotFound(CouncilReceiptError):
    """No durable receipt exists for the requested id."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def valid_request_id(value: Any) -> bool:
    return isinstance(value, str) and bool(_REQUEST_ID_RE.fullmatch(value))


def valid_request_hash(value: Any) -> bool:
    return isinstance(value, str) and bool(_REQUEST_HASH_RE.fullmatch(value))


def _utf16_sort_key(value: str) -> bytes:
    # ECMAScript's default key ordering compares UTF-16 code units.  Using the
    # same order here keeps the Python and TypeScript canonicalizers identical.
    return value.encode("utf-16-be", errors="strict")


def _normalized_number(value: int | float) -> Dict[str, str]:
    if isinstance(value, bool):  # bool is an int subclass in Python.
        raise TypeError("boolean is not a canonical number")
    if isinstance(value, int):
        if abs(value) > _JS_MAX_SAFE_INTEGER:
            raise ValueError("canonical request integers must be JavaScript-safe")
        return {"$number": f"i:{value}"}
    if not math.isfinite(value):
        raise ValueError("canonical request numbers must be finite")
    if value.is_integer():
        if abs(value) > _JS_MAX_SAFE_INTEGER:
            raise ValueError("canonical request integers must be JavaScript-safe")
        # Mirror Number.isInteger and template-string rendering, including
        # normalizing negative zero to the integer text "0".
        return {"$number": f"i:{int(value)}"}
    return {"$number": f"f64:{struct.pack('>d', float(value)).hex()}"}


def canonical_value_v1(value: Any) -> Any:
    """Return the version-1 JSON-safe canonical projection.

    Numeric leaves are tagged by exact integer text or IEEE-754 bits.  This
    avoids the incompatible float rendering rules of Python and JavaScript.
    """

    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, float)):
        return _normalized_number(value)
    if isinstance(value, (list, tuple)):
        return [canonical_value_v1(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("canonical request object keys must be strings")
        return {
            key: canonical_value_v1(value[key])
            for key in sorted(value, key=_utf16_sort_key)
        }
    raise TypeError(f"unsupported canonical request value: {type(value).__name__}")


def canonical_json_v1(value: Any) -> str:
    return json.dumps(
        canonical_value_v1(value),
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def council_request_envelope_v1(
    council_input: CouncilInput,
    *,
    effective_mode: str,
) -> Dict[str, Any]:
    requested_model = (
        council_input.requested_model_alias or council_input.requested_model
    )
    resolved_model = council_input.resolved_model or council_input.requested_model
    return {
        "schemaVersion": CANONICAL_REQUEST_SCHEMA_VERSION,
        "messages": council_input.messages,
        "taskType": council_input.task_type,
        "gardenId": council_input.garden_id,
        "pageId": council_input.page_id,
        "sourceContext": council_input.source_context,
        "councilMode": effective_mode,
        "requestedModel": requested_model,
        "resolvedModel": resolved_model,
        "reasoning": {
            "effort": council_input.reasoning_effort,
            "summary": council_input.reasoning_summary,
        },
        "temperature": council_input.temperature,
        "maxTokens": council_input.max_tokens,
    }


def council_request_hash_v1(
    council_input: CouncilInput,
    *,
    effective_mode: str,
) -> str:
    payload = canonical_json_v1(
        council_request_envelope_v1(council_input, effective_mode=effective_mode)
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def legacy_run_hash_v1(
    run: Dict[str, Any],
    *,
    reasoning_effort: str,
    reasoning_summary: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """Canonical hash for pre-receipt snapshots.

    Old Council snapshots contain the effective transformed messages/model/mode
    but not request reasoning.  Callers may supply reasoning only after their
    own durable policy ledger proves it; the legacy resolver never treats this
    hash alone as policy evidence.
    """

    envelope = {
        "schemaVersion": CANONICAL_REQUEST_SCHEMA_VERSION,
        "messages": run.get("messages"),
        "taskType": run.get("taskType"),
        "gardenId": run.get("gardenId"),
        "pageId": run.get("pageId"),
        "sourceContext": run.get("sourceContext"),
        "councilMode": run.get("councilMode"),
        "requestedModel": run.get("requestedModel"),
        "resolvedModel": run.get("resolvedModel"),
        "reasoning": {
            "effort": reasoning_effort,
            "summary": reasoning_summary,
        },
        "temperature": temperature,
        "maxTokens": max_tokens,
    }
    return hashlib.sha256(canonical_json_v1(envelope).encode("utf-8")).hexdigest()


def _safe_model_routing(value: Any) -> list[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        projected: Dict[str, Any] = {}
        for key in _ROUTING_KEYS:
            if key not in item:
                continue
            candidate = item[key]
            if key in ("schemaVersion", "statusCode"):
                if type(candidate) is int and 0 <= candidate <= 9999:
                    projected[key] = candidate
            elif key in ("fallback", "partialOutput", "replaySafe"):
                if type(candidate) is bool:
                    projected[key] = candidate
            elif key == "at":
                if isinstance(candidate, str) and 0 < len(candidate) <= 80:
                    projected[key] = candidate
            elif isinstance(candidate, str) and _ROUTING_TOKEN_RE.fullmatch(candidate):
                projected[key] = candidate
        result.append(projected)
    return result


def _project_recovery_routing(value: Any) -> list[Dict[str, Any]]:
    """Drop raw/unknown fields while rejecting malformed allowlisted evidence."""

    if not isinstance(value, list) or len(value) > _MAX_ROUTING_ENTRIES:
        raise CouncilReceiptCorrupt("Council recovery routing is invalid")
    projected = _safe_model_routing(value)
    if len(projected) != len(value):
        raise CouncilReceiptCorrupt("Council recovery routing entry is invalid")
    for raw, safe in zip(value, projected):
        if not isinstance(raw, dict) or any(
            key in raw and key not in safe for key in _ROUTING_KEYS
        ):
            raise CouncilReceiptCorrupt("Council recovery routing field is invalid")
    return projected


def safe_result_from_run(run: CouncilRun) -> Dict[str, Any]:
    usage = run.token_usage_snapshot()
    final_answer = run.final_answer or ""
    return {
        "councilRunId": run.id,
        "councilMode": run.council_mode,
        "requestedModel": run.requested_model,
        "resolvedModel": run.resolved_model,
        "finalAnswer": final_answer,
        "usage": {
            "inputTokens": usage.input_tokens,
            "outputTokens": usage.output_tokens,
            "totalTokens": usage.total_tokens,
            "cachedInputTokens": usage.cached_input_tokens,
            "reasoningTokens": usage.reasoning_tokens,
            "callCount": usage.call_count,
            "reportedCallCount": usage.reported_call_count,
        },
        "modelRouting": _project_recovery_routing(run.model_attempts_snapshot()),
        "responseHash": hashlib.sha256(final_answer.encode("utf-8")).hexdigest(),
        "createdAt": run.created_at,
        "updatedAt": run.updated_at,
    }


def safe_result_from_legacy_run(run: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    final_answer = run.get("finalAnswer")
    if final_answer is None or (isinstance(final_answer, str) and not final_answer.strip()):
        return None
    if not isinstance(final_answer, str):
        raise CouncilReceiptCorrupt("legacy Council completion answer is invalid")
    usage = run.get("usage")
    if not isinstance(usage, dict):
        raise CouncilReceiptCorrupt("legacy Council completion usage is invalid")
    candidate = {
        "councilRunId": run.get("id"),
        "councilMode": run.get("councilMode"),
        "requestedModel": run.get("requestedModel"),
        "resolvedModel": run.get("resolvedModel"),
        "finalAnswer": final_answer,
        "usage": {key: usage.get(key) for key in _USAGE_KEYS},
        "usageEstimated": usage.get("reportedCallCount") != usage.get("callCount"),
        "modelRouting": _project_recovery_routing(run.get("modelRouting")),
        "responseHash": hashlib.sha256(final_answer.encode("utf-8")).hexdigest(),
        "createdAt": run.get("createdAt"),
        "updatedAt": run.get("updatedAt"),
    }
    return strict_completed_result(candidate)


def _strict_json_bytes(value: Dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def _nonnegative_int(value: Any) -> bool:
    return type(value) is int and 0 <= value <= _JS_MAX_SAFE_INTEGER


def _safe_attempt_usage(value: Any) -> Optional[Dict[str, int]]:
    if not isinstance(value, dict):
        return None
    if set(value) != set(_USAGE_KEYS):
        return None
    if any(not _nonnegative_int(value.get(key)) for key in _USAGE_KEYS):
        return None
    input_tokens = value["inputTokens"]
    output_tokens = value["outputTokens"]
    token_sum = input_tokens + output_tokens
    if (
        token_sum > _JS_MAX_SAFE_INTEGER
        or value["totalTokens"] < token_sum
        or value["cachedInputTokens"] > input_tokens
        or value["reasoningTokens"] > output_tokens
        or value["reportedCallCount"] > value["callCount"]
    ):
        return None
    return {key: value[key] for key in _USAGE_KEYS}


def _bounded_token(value: Any) -> bool:
    return isinstance(value, str) and bool(_ROUTING_TOKEN_RE.fullmatch(value))


def _strict_iso(value: Any, *, label: str) -> tuple[str, datetime]:
    if not isinstance(value, str) or not value or len(value) > 80:
        raise CouncilReceiptCorrupt(f"{label} timestamp is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timezone offset is required")
        parsed = parsed.astimezone(timezone.utc)
    except Exception as exc:
        raise CouncilReceiptCorrupt(f"{label} timestamp is invalid") from exc
    return value, parsed


def _strict_time_pair(
    created_value: Any,
    updated_value: Any,
    *,
    label: str,
) -> tuple[str, str, datetime, datetime]:
    created_raw, created = _strict_iso(created_value, label=f"{label} creation")
    updated_raw, updated = _strict_iso(updated_value, label=f"{label} update")
    if updated < created:
        raise CouncilReceiptCorrupt(f"{label} update predates creation")
    return created_raw, updated_raw, created, updated


def _strict_routing(
    value: Any,
    *,
    run_id: str,
    requested_model: str,
    resolved_model: str,
    require_success: bool = False,
) -> list[Dict[str, Any]]:
    if (
        not isinstance(value, list)
        or len(value) > _MAX_ROUTING_ENTRIES
        or _safe_model_routing(value) != value
    ):
        raise CouncilReceiptCorrupt("Council recovery routing is invalid")
    required = {
        "schemaVersion",
        "at",
        "requestId",
        "endpoint",
        "requestedModel",
        "resolvedModel",
        "upstreamModel",
        "provider",
        "outcome",
        "fallback",
    }
    succeeded = False
    for route in value:
        if not required.issubset(route):
            raise CouncilReceiptCorrupt("Council recovery routing proof is incomplete")
        _strict_iso(route.get("at"), label="Council routing")
        if (
            route.get("schemaVersion") != 1
            or route.get("requestId") != run_id
            or route.get("endpoint") != "council"
            or route.get("requestedModel") != requested_model
            or route.get("resolvedModel") != resolved_model
            or not _bounded_token(route.get("upstreamModel"))
            or not _bounded_token(route.get("provider"))
            or route.get("outcome") not in ("succeeded", "failed")
            or type(route.get("fallback")) is not bool
        ):
            raise CouncilReceiptCorrupt("Council recovery routing binding is invalid")
        succeeded = succeeded or route.get("outcome") == "succeeded"
    if require_success and not succeeded:
        raise CouncilReceiptCorrupt("Council completion has no successful model route")
    return [dict(route) for route in value]


def strict_completed_result(value: Any) -> Dict[str, Any]:
    """Validate and project a prompt-free reusable Council answer.

    ``reasoningSummary`` is accepted only for backward reads of receipts written
    before recovery stopped persisting it. It is deliberately omitted from the
    returned projection. Every other unknown field is rejected so an edited
    receipt cannot turn this allowlist into a prompt/raw-output exfiltration path.
    """

    if not isinstance(value, dict):
        raise CouncilReceiptCorrupt("completed Council result is invalid")
    required = {
        "councilRunId",
        "councilMode",
        "requestedModel",
        "resolvedModel",
        "finalAnswer",
        "usage",
        "usageEstimated",
        "modelRouting",
        "responseHash",
        "createdAt",
        "updatedAt",
    }
    if not required.issubset(value) or set(value) - (required | {"reasoningSummary"}):
        raise CouncilReceiptCorrupt("completed Council result schema is invalid")
    run_id = value.get("councilRunId")
    council_mode = value.get("councilMode")
    requested_model = value.get("requestedModel")
    resolved_model = value.get("resolvedModel")
    answer = value.get("finalAnswer")
    response_hash = value.get("responseHash")
    if (
        not _bounded_token(run_id)
        or council_mode not in _COUNCIL_MODES
        or not _bounded_token(requested_model)
        or not _bounded_token(resolved_model)
        or not isinstance(answer, str)
        or not answer.strip()
        or len(answer) > _MAX_FINAL_ANSWER_CHARS
        or not valid_request_hash(response_hash)
        or hashlib.sha256(answer.encode("utf-8")).hexdigest() != response_hash
    ):
        raise CouncilReceiptCorrupt("completed Council result binding is invalid")
    usage = _safe_attempt_usage(value.get("usage"))
    usage_estimated = value.get("usageEstimated")
    if (
        usage is None
        or usage["callCount"] < 1
        or type(usage_estimated) is not bool
        or usage_estimated != (usage["reportedCallCount"] != usage["callCount"])
    ):
        raise CouncilReceiptCorrupt("completed Council result usage is invalid")
    created_raw, updated_raw, _, _ = _strict_time_pair(
        value.get("createdAt"),
        value.get("updatedAt"),
        label="completed Council result",
    )
    routing = _strict_routing(
        value.get("modelRouting"),
        run_id=run_id,
        requested_model=requested_model,
        resolved_model=resolved_model,
        require_success=bool(value.get("modelRouting")),
    )
    return {
        "councilRunId": run_id,
        "councilMode": council_mode,
        "requestedModel": requested_model,
        "resolvedModel": resolved_model,
        "finalAnswer": answer,
        "usage": usage,
        "usageEstimated": usage_estimated,
        "modelRouting": routing,
        "responseHash": response_hash,
        "createdAt": created_raw,
        "updatedAt": updated_raw,
    }


def _attempt_from_accounting(
    accounting: Dict[str, Any],
    *,
    generation: int,
    outcome: str,
    failure_code: Optional[str] = None,
) -> Dict[str, Any]:
    """Project one prompt-free dispatch outcome into durable accounting.

    The caller may pass the safe result projection used by the resolver, but
    this function deliberately copies only identifiers, routing, and numeric
    usage.  Prompts, source context, raw provider errors, and answer text have
    no path into a receipt attempt record.
    """

    if not isinstance(accounting, dict):
        raise CouncilReceiptConflict("recoverable attempt accounting is invalid")
    run_id = accounting.get("councilRunId")
    requested_model = accounting.get("requestedModel")
    resolved_model = accounting.get("resolvedModel")
    if not _bounded_token(run_id):
        raise CouncilReceiptConflict("recoverable attempt run id is invalid")
    if not _bounded_token(requested_model) or not _bounded_token(resolved_model):
        raise CouncilReceiptConflict("recoverable attempt model binding is invalid")
    usage = _safe_attempt_usage(accounting.get("usage"))
    if usage is None:
        raise CouncilReceiptConflict("recoverable attempt usage is invalid")
    usage_estimated = accounting.get("usageEstimated")
    if (
        type(usage_estimated) is not bool
        or usage_estimated != (usage["reportedCallCount"] != usage["callCount"])
    ):
        raise CouncilReceiptConflict("recoverable attempt usage provenance is invalid")
    if outcome != "completed":
        final_answer = accounting.get("finalAnswer")
        response_hash = accounting.get("responseHash")
        if (
            not isinstance(final_answer, str)
            or final_answer.strip()
            or not valid_request_hash(response_hash)
            or hashlib.sha256(final_answer.encode("utf-8")).hexdigest()
            != response_hash
        ):
            raise CouncilReceiptConflict(
                "recoverable failure does not prove final-answer absence"
            )
    try:
        created_raw, updated_raw, _, _ = _strict_time_pair(
            accounting.get("createdAt"),
            accounting.get("updatedAt"),
            label="recoverable attempt",
        )
        routing = _strict_routing(
            accounting.get("modelRouting"),
            run_id=run_id,
            requested_model=requested_model,
            resolved_model=resolved_model,
            require_success=outcome == "completed" and bool(accounting.get("modelRouting")),
        )
    except CouncilReceiptCorrupt as exc:
        raise CouncilReceiptConflict(str(exc)) from exc

    attempt: Dict[str, Any] = {
        "dispatchGeneration": generation,
        "outcome": outcome,
        "councilRunId": run_id,
        "finalAnswerPresent": outcome == "completed",
        "usage": usage,
        "usageEstimated": usage_estimated,
        "modelRouting": routing,
        "requestedModel": requested_model,
        "resolvedModel": resolved_model,
        "createdAt": created_raw,
        "updatedAt": updated_raw,
    }
    if outcome == "completed":
        response_hash = accounting.get("responseHash")
        if not valid_request_hash(response_hash):
            raise CouncilReceiptConflict("recoverable completion hash is invalid")
        attempt["responseHash"] = response_hash
    else:
        if not _bounded_token(failure_code) or len(failure_code) > 120:
            raise CouncilReceiptConflict("recoverable failure code is invalid")
        attempt["failureCode"] = failure_code
    return attempt


def _validate_attempt(value: Any, *, expected_generation: int) -> None:
    if not isinstance(value, dict):
        raise CouncilReceiptCorrupt("recoverable receipt attempt is invalid")
    allowed = {
        "dispatchGeneration",
        "outcome",
        "councilRunId",
        "finalAnswerPresent",
        "usage",
        "usageEstimated",
        "modelRouting",
        "requestedModel",
        "resolvedModel",
        "createdAt",
        "updatedAt",
        "responseHash",
        "failureCode",
    }
    if set(value) - allowed:
        raise CouncilReceiptCorrupt("recoverable receipt attempt exposes unsafe fields")
    if (
        type(value.get("dispatchGeneration")) is not int
        or value.get("dispatchGeneration") != expected_generation
    ):
        raise CouncilReceiptCorrupt("recoverable receipt attempt generation is invalid")
    if not _bounded_token(value.get("councilRunId")):
        raise CouncilReceiptCorrupt("recoverable receipt attempt run id is invalid")
    usage = _safe_attempt_usage(value.get("usage"))
    if usage is None:
        raise CouncilReceiptCorrupt("recoverable receipt attempt usage is invalid")
    if (
        type(value.get("usageEstimated")) is not bool
        or value["usageEstimated"]
        != (usage["reportedCallCount"] != usage["callCount"])
    ):
        raise CouncilReceiptCorrupt("recoverable receipt attempt usage provenance is invalid")
    requested_model = value.get("requestedModel")
    resolved_model = value.get("resolvedModel")
    if not _bounded_token(requested_model) or not _bounded_token(resolved_model):
        raise CouncilReceiptCorrupt("recoverable receipt attempt model binding is invalid")
    _strict_time_pair(
        value.get("createdAt"),
        value.get("updatedAt"),
        label="recoverable receipt attempt",
    )
    routing = _strict_routing(
        value.get("modelRouting"),
        run_id=value["councilRunId"],
        requested_model=requested_model,
        resolved_model=resolved_model,
        require_success=(
            value.get("outcome") == "completed" and bool(value.get("modelRouting"))
        ),
    )

    outcome = value.get("outcome")
    if outcome == "completed":
        if value.get("finalAnswerPresent") is not True:
            raise CouncilReceiptCorrupt("recoverable completion proof is invalid")
        if not valid_request_hash(value.get("responseHash")) or "failureCode" in value:
            raise CouncilReceiptCorrupt("recoverable completion binding is invalid")
    elif outcome in ("failed_no_final_answer", "failed_terminal"):
        if value.get("finalAnswerPresent") is not False:
            raise CouncilReceiptCorrupt("recoverable no-answer proof is invalid")
        failure_code = value.get("failureCode")
        if not _bounded_token(failure_code) or "responseHash" in value:
            raise CouncilReceiptCorrupt("recoverable failure binding is invalid")
    else:
        raise CouncilReceiptCorrupt("recoverable receipt attempt outcome is invalid")


def _failed_attempt_proves_one_direct_call(
    receipt: Dict[str, Any],
    attempt: Dict[str, Any],
) -> bool:
    """Return true only for the new exact direct-call failure authority."""

    if (
        receipt.get("dispatchEvidenceVersion") != DISPATCH_EVIDENCE_VERSION
        or receipt.get("dispatchMode") != "direct_council"
        or attempt.get("outcome") != "failed_no_final_answer"
        or attempt.get("failureCode") != REDISPATCHABLE_FAILURE_CODE
        or attempt.get("finalAnswerPresent") is not False
    ):
        return False
    usage = _safe_attempt_usage(attempt.get("usage"))
    routing = attempt.get("modelRouting")
    if (
        usage is None
        or usage["callCount"] != 1
        or usage["reportedCallCount"] not in (0, 1)
        or not isinstance(routing, list)
        or len(routing) != 1
    ):
        return False
    route = routing[0]
    return bool(
        route.get("schemaVersion") == 1
        and route.get("endpoint") == "council"
        and route.get("requestId") == attempt.get("councilRunId")
        and route.get("requestedModel") == attempt.get("requestedModel")
        and route.get("resolvedModel") == attempt.get("resolvedModel")
        and _bounded_token(route.get("provider"))
        and _bounded_token(route.get("upstreamModel"))
        and route.get("outcome") == "failed"
        and route.get("fallback") is False
    )


def _validated_dispatch_fields(
    receipt: Dict[str, Any],
) -> Optional[tuple[int, int, list[Dict[str, Any]]]]:
    """Validate new dispatch evidence while retaining read compatibility.

    Pre-fence receipts did not carry these fields. They remain readable so old
    completed answers can still be recovered, but their missing evidence can
    never authorize a redispatch.
    """

    names = ("dispatchCount", "redispatchCount", "attempts")
    present = tuple(name in receipt for name in names)
    if not any(present):
        return None
    if not all(present):
        raise CouncilReceiptCorrupt("recoverable receipt dispatch evidence is incomplete")
    allowed_receipt_fields = {
        "schemaVersion",
        "requestId",
        "requestHash",
        "state",
        "dispatchCount",
        "redispatchCount",
        "attempts",
        "dispatchEvidenceVersion",
        "dispatchMode",
        "createdAt",
        "updatedAt",
        "failureCode",
        "redispatchClaimHash",
        "result",
    }
    if set(receipt) - allowed_receipt_fields:
        raise CouncilReceiptCorrupt("recoverable receipt exposes unexpected fields")
    _strict_time_pair(
        receipt.get("createdAt"),
        receipt.get("updatedAt"),
        label="recoverable receipt",
    )
    evidence_names = ("dispatchEvidenceVersion", "dispatchMode")
    evidence_present = tuple(name in receipt for name in evidence_names)
    if any(evidence_present) and not all(evidence_present):
        raise CouncilReceiptCorrupt("recoverable dispatch authority is incomplete")
    if all(evidence_present) and (
        type(receipt.get("dispatchEvidenceVersion")) is not int
        or receipt.get("dispatchEvidenceVersion") != DISPATCH_EVIDENCE_VERSION
        or receipt.get("dispatchMode") not in _COUNCIL_MODES
    ):
        raise CouncilReceiptCorrupt("recoverable dispatch authority is invalid")
    dispatch_count = receipt.get("dispatchCount")
    redispatch_count = receipt.get("redispatchCount")
    attempts = receipt.get("attempts")
    if type(dispatch_count) is not int or dispatch_count not in (1, 2):
        raise CouncilReceiptCorrupt("recoverable receipt dispatch count is invalid")
    if type(redispatch_count) is not int or redispatch_count != dispatch_count - 1:
        raise CouncilReceiptCorrupt("recoverable receipt redispatch count is invalid")
    claim_hash = receipt.get("redispatchClaimHash")
    if dispatch_count == 1 and "redispatchClaimHash" in receipt:
        raise CouncilReceiptCorrupt("initial receipt has unexpected redispatch evidence")
    if dispatch_count == 2 and not valid_request_hash(claim_hash):
        raise CouncilReceiptCorrupt("redispatched receipt claim binding is invalid")
    if not isinstance(attempts, list):
        raise CouncilReceiptCorrupt("recoverable receipt attempt history is invalid")
    for index, attempt in enumerate(attempts, start=1):
        _validate_attempt(attempt, expected_generation=index)

    state = receipt.get("state")
    if state == "started" and (
        "failureCode" in receipt or "result" in receipt
    ):
        raise CouncilReceiptCorrupt("started receipt contains a terminal outcome")
    if state == "failed" and "result" in receipt:
        raise CouncilReceiptCorrupt("failed receipt contains a reusable result")
    if state == "completed" and (
        "failureCode" in receipt or not isinstance(receipt.get("result"), dict)
    ):
        raise CouncilReceiptCorrupt("completed receipt terminal state is invalid")
    expected_attempts = dispatch_count - 1 if state == "started" else dispatch_count
    if len(attempts) != expected_attempts:
        raise CouncilReceiptCorrupt("recoverable receipt attempt history is incomplete")
    if state == "completed" and attempts[-1].get("outcome") != "completed":
        raise CouncilReceiptCorrupt("recoverable completed receipt has no completion proof")
    if state == "completed":
        result = strict_completed_result(receipt.get("result"))
        last = attempts[-1]
        result_to_attempt = {
            "councilRunId": "councilRunId",
            "responseHash": "responseHash",
            "usage": "usage",
            "usageEstimated": "usageEstimated",
            "modelRouting": "modelRouting",
            "requestedModel": "requestedModel",
            "resolvedModel": "resolvedModel",
            "createdAt": "createdAt",
            "updatedAt": "updatedAt",
        }
        if any(
            result[result_key] != last.get(attempt_key)
            for result_key, attempt_key in result_to_attempt.items()
        ):
            raise CouncilReceiptCorrupt(
                "recoverable completion result is not bound to its last attempt"
            )
        dispatch_mode = receipt.get("dispatchMode")
        if dispatch_mode is not None and result.get("councilMode") != dispatch_mode:
            raise CouncilReceiptCorrupt(
                "recoverable completion mode conflicts with its dispatch"
            )
    if state == "failed":
        last = attempts[-1]
        if last.get("outcome") not in ("failed_no_final_answer", "failed_terminal"):
            raise CouncilReceiptCorrupt("recoverable failed receipt has no failure proof")
        if receipt.get("failureCode") != last.get("failureCode"):
            raise CouncilReceiptCorrupt("recoverable failed receipt code is inconsistent")
    return dispatch_count, redispatch_count, attempts


class StrictCouncilReceiptStore:
    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)
        self._lock = threading.RLock()

    def _path(self, request_id: str) -> Path:
        if not valid_request_id(request_id):
            raise CouncilReceiptConflict("invalid recoverable request id")
        return self.base_dir / f"{request_id}.json"

    def _redispatch_claim_path(self, request_id: str) -> Path:
        if not valid_request_id(request_id):
            raise CouncilReceiptConflict("invalid recoverable request id")
        return self.base_dir / f"{request_id}.redispatch.json"

    def _ensure_dir(self) -> None:
        missing: list[Path] = []
        cursor = self.base_dir
        while not cursor.exists():
            missing.append(cursor)
            parent = cursor.parent
            if parent == cursor:
                break
            cursor = parent
        self.base_dir.mkdir(parents=True, exist_ok=True)
        # mkdir(parents=True) can create more than the receipt directory. Each
        # new name must be durable in its parent before provider dispatch; the
        # receipt-file fsync below only protects the final directory's contents.
        for created in reversed(missing):
            self._fsync_directory_path(created.parent)

    def _fsync_directory_path(self, directory: Path) -> None:
        if os.name == "nt":
            return
        dir_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

    def _fsync_dir(self) -> None:
        self._fsync_directory_path(self.base_dir)

    def _read_path(self, path: Path) -> Dict[str, Any]:
        try:
            raw = path.read_text(encoding="utf-8")
            value = json.loads(raw)
        except FileNotFoundError as exc:
            raise CouncilReceiptNotFound("recoverable request receipt not found") from exc
        except Exception as exc:
            raise CouncilReceiptCorrupt("recoverable request receipt is unreadable") from exc
        if not isinstance(value, dict):
            raise CouncilReceiptCorrupt("recoverable request receipt is not an object")
        if (
            type(value.get("schemaVersion")) is not int
            or value.get("schemaVersion") != RECEIPT_SCHEMA_VERSION
        ):
            raise CouncilReceiptCorrupt("recoverable request receipt schema is invalid")
        if not valid_request_id(value.get("requestId")):
            raise CouncilReceiptCorrupt("recoverable request receipt id is invalid")
        if not valid_request_hash(value.get("requestHash")):
            raise CouncilReceiptCorrupt("recoverable request receipt hash is invalid")
        if value.get("state") not in ("started", "completed", "failed"):
            raise CouncilReceiptCorrupt("recoverable request receipt state is invalid")
        _validated_dispatch_fields(value)
        return value

    def _read_redispatch_claim(self, path: Path) -> Dict[str, Any]:
        try:
            raw = path.read_text(encoding="utf-8")
            value = json.loads(raw)
        except FileNotFoundError as exc:
            raise CouncilReceiptNotFound("recoverable redispatch claim not found") from exc
        except Exception as exc:
            raise CouncilReceiptCorrupt("recoverable redispatch claim is unreadable") from exc
        if not isinstance(value, dict):
            raise CouncilReceiptCorrupt("recoverable redispatch claim is not an object")
        if set(value) != {
            "schemaVersion",
            "requestId",
            "requestHash",
            "dispatchGeneration",
            "priorReceiptHash",
            "createdAt",
        }:
            raise CouncilReceiptCorrupt("recoverable redispatch claim schema is invalid")
        if (
            type(value.get("schemaVersion")) is not int
            or value.get("schemaVersion") != REDISPATCH_CLAIM_SCHEMA_VERSION
        ):
            raise CouncilReceiptCorrupt("recoverable redispatch claim version is invalid")
        if not valid_request_id(value.get("requestId")):
            raise CouncilReceiptCorrupt("recoverable redispatch claim id is invalid")
        if not valid_request_hash(value.get("requestHash")):
            raise CouncilReceiptCorrupt("recoverable redispatch claim hash is invalid")
        if value.get("dispatchGeneration") != 2:
            raise CouncilReceiptCorrupt("recoverable redispatch generation is invalid")
        if not valid_request_hash(value.get("priorReceiptHash")):
            raise CouncilReceiptCorrupt("recoverable redispatch prior binding is invalid")
        _strict_iso(value.get("createdAt"), label="recoverable redispatch")
        return value

    def _bound_redispatch_claim(
        self,
        request_id: str,
        request_hash: str,
    ) -> Optional[Dict[str, Any]]:
        path = self._redispatch_claim_path(request_id)
        try:
            value = self._read_redispatch_claim(path)
        except CouncilReceiptNotFound:
            return None
        if value.get("requestId") != request_id or not hmac.compare_digest(
            str(value.get("requestHash")), request_hash
        ):
            raise CouncilReceiptConflict("recoverable redispatch binding conflicts")
        return value

    def _verified_claim_for_receipt(
        self,
        request_id: str,
        request_hash: str,
        receipt: Dict[str, Any],
        dispatch_count: int,
    ) -> Optional[Dict[str, Any]]:
        claim = self._bound_redispatch_claim(request_id, request_hash)
        if (
            dispatch_count == 1
            and claim is not None
            and receipt.get("state") != "failed"
        ):
            raise CouncilReceiptCorrupt(
                "initial receipt has an impossible redispatch claim"
            )
        if dispatch_count == 2 and (
            claim is None
            or not hmac.compare_digest(
                str(receipt.get("redispatchClaimHash")),
                hashlib.sha256(_strict_json_bytes(claim)).hexdigest(),
            )
        ):
            raise CouncilReceiptCorrupt(
                "recoverable redispatch receipt has no exact durable claim"
            )
        return claim

    def read(self, request_id: str, request_hash: str) -> Dict[str, Any]:
        if not valid_request_hash(request_hash):
            raise CouncilReceiptConflict("invalid recoverable request hash")
        with self._lock:
            value = self._read_path(self._path(request_id))
        if value.get("requestId") != request_id or not hmac.compare_digest(
            str(value.get("requestHash")), request_hash
        ):
            raise CouncilReceiptConflict("recoverable request id/hash binding conflicts")
        return value

    def reserve(
        self,
        request_id: str,
        request_hash: str,
        *,
        dispatch_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not valid_request_hash(request_hash):
            raise CouncilReceiptConflict("invalid recoverable request hash")
        if dispatch_mode is not None and dispatch_mode not in _COUNCIL_MODES:
            raise CouncilReceiptConflict("invalid recoverable dispatch mode")
        path = self._path(request_id)
        now = _now_iso()
        value = {
            "schemaVersion": RECEIPT_SCHEMA_VERSION,
            "requestId": request_id,
            "requestHash": request_hash,
            "state": "started",
            "dispatchCount": 1,
            "redispatchCount": 0,
            "attempts": [],
            "createdAt": now,
            "updatedAt": now,
        }
        if dispatch_mode is not None:
            value.update(
                {
                    "dispatchEvidenceVersion": DISPATCH_EVIDENCE_VERSION,
                    "dispatchMode": dispatch_mode,
                }
            )
        payload = _strict_json_bytes(value)
        with self._lock:
            self._ensure_dir()
            # A claim without its receipt can only be crash damage or external
            # mutation. It must not be reinterpreted as a brand-new identity.
            if self._bound_redispatch_claim(request_id, request_hash) is not None:
                raise CouncilReceiptConflict(
                    "recoverable request has a prior redispatch claim"
                )
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                existing = self._read_path(path)
                if existing.get("requestId") != request_id or not hmac.compare_digest(
                    str(existing.get("requestHash")), request_hash
                ):
                    raise CouncilReceiptConflict(
                        "recoverable request id is already bound to another hash"
                    )
                raise CouncilReceiptConflict(
                    f"recoverable request is already {existing.get('state')}"
                )
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                # The provider dispatch fence includes the directory entry, not
                # only the new file's bytes.
                self._fsync_dir()
            except Exception:
                # A torn exclusive-create is intentionally left in place.  A
                # later request sees corruption and fails closed; it must never
                # reinterpret an uncertain dispatch boundary as unused.
                raise
        return value

    def claim_failed_redispatch(
        self,
        request_id: str,
        request_hash: str,
    ) -> Dict[str, Any]:
        """Consume the one exact failed/no-answer redispatch authority.

        The adjacent claim is an O_EXCL cross-instance CAS fence. It is fsynced
        before the receipt can advance to generation two and is intentionally
        never removed. If the process dies anywhere in this transition, later
        callers fail closed rather than guessing whether generation two could
        have reached a provider.
        """

        if not valid_request_hash(request_hash):
            raise CouncilReceiptConflict("invalid recoverable request hash")
        path = self._path(request_id)
        claim_path = self._redispatch_claim_path(request_id)
        with self._lock:
            current = self.read(request_id, request_hash)
            dispatch = _validated_dispatch_fields(current)
            if current.get("state") != "failed":
                raise CouncilReceiptConflict(
                    f"recoverable request cannot redispatch from {current.get('state')}"
                )
            if dispatch is None:
                raise CouncilReceiptCorrupt(
                    "recoverable failed receipt predates exact redispatch evidence"
                )
            dispatch_count, redispatch_count, attempts = dispatch
            last = attempts[-1]
            if (
                dispatch_count != 1
                or redispatch_count != 0
                or current.get("failureCode") != REDISPATCHABLE_FAILURE_CODE
                or last.get("outcome") != "failed_no_final_answer"
                or last.get("failureCode") != REDISPATCHABLE_FAILURE_CODE
                or last.get("finalAnswerPresent") is not False
                or not _failed_attempt_proves_one_direct_call(current, last)
            ):
                raise CouncilReceiptConflict(
                    "recoverable failed receipt has no unused exact redispatch authority"
                )

            # Never overwrite or silently ignore a pre-existing claim. A valid
            # one means authority is consumed; a malformed/conflicting one is
            # ambiguity and therefore a hard stop.
            existing_claim = self._bound_redispatch_claim(request_id, request_hash)
            if existing_claim is not None:
                raise CouncilReceiptConflict(
                    "recoverable request redispatch authority is already consumed"
                )
            prior_receipt_hash = hashlib.sha256(
                _strict_json_bytes(current)
            ).hexdigest()
            now = _now_iso()
            claim = {
                "schemaVersion": REDISPATCH_CLAIM_SCHEMA_VERSION,
                "requestId": request_id,
                "requestHash": request_hash,
                "dispatchGeneration": 2,
                "priorReceiptHash": prior_receipt_hash,
                "createdAt": now,
            }
            payload = _strict_json_bytes(claim)
            self._ensure_dir()
            try:
                fd = os.open(
                    claim_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
            except FileExistsError:
                # Validate an existing claim before classifying it as consumed;
                # a torn or conflicting file is corruption, never permission.
                self._bound_redispatch_claim(request_id, request_hash)
                raise CouncilReceiptConflict(
                    "recoverable request redispatch authority is already consumed"
                )
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(payload)
                    handle.flush()
                    os.fsync(handle.fileno())
                self._fsync_dir()
            except Exception:
                # As with the initial receipt fence, a torn exclusive claim is
                # retained so uncertainty cannot become another dispatch.
                raise

            advanced = {
                key: value
                for key, value in current.items()
                if key not in ("failureCode", "result")
            }
            advanced.update(
                {
                    "state": "started",
                    "dispatchCount": 2,
                    "redispatchCount": 1,
                    "redispatchClaimHash": hashlib.sha256(payload).hexdigest(),
                    "updatedAt": _now_iso(),
                }
            )
            self._replace(path, advanced)
            return advanced

    def _replace(self, path: Path, value: Dict[str, Any]) -> None:
        self._ensure_dir()
        temp = self.base_dir / f".{path.name}.{uuid.uuid4().hex}.tmp"
        payload = _strict_json_bytes(value)
        try:
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
            self._fsync_dir()
        finally:
            try:
                temp.unlink(missing_ok=True)
            except Exception:
                pass

    def complete(
        self,
        request_id: str,
        request_hash: str,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        with self._lock:
            path = self._path(request_id)
            current = self.read(request_id, request_hash)
            if current.get("state") != "started":
                raise CouncilReceiptConflict(
                    f"recoverable request cannot complete from {current.get('state')}"
                )
            try:
                safe_result = strict_completed_result(result)
            except CouncilReceiptCorrupt as exc:
                raise CouncilReceiptConflict(str(exc)) from exc
            completed = {
                **current,
                "state": "completed",
                "updatedAt": _now_iso(),
                "result": safe_result,
            }
            dispatch = _validated_dispatch_fields(current)
            if dispatch is not None:
                dispatch_count, _, attempts = dispatch
                self._verified_claim_for_receipt(
                    request_id,
                    request_hash,
                    current,
                    dispatch_count,
                )
                completed["attempts"] = [
                    *attempts,
                    _attempt_from_accounting(
                        safe_result,
                        generation=dispatch_count,
                        outcome="completed",
                    ),
                ]
                _validated_dispatch_fields(completed)
            self._replace(path, completed)
            return completed

    def fail_no_final_answer(
        self,
        request_id: str,
        request_hash: str,
        accounting: Dict[str, Any],
    ) -> Dict[str, Any]:
        with self._lock:
            path = self._path(request_id)
            current = self.read(request_id, request_hash)
            if current.get("state") != "started":
                raise CouncilReceiptConflict(
                    f"recoverable request cannot fail from {current.get('state')}"
                )
            dispatch = _validated_dispatch_fields(current)
            if dispatch is None:
                raise CouncilReceiptCorrupt(
                    "recoverable started receipt has no dispatch evidence"
                )
            dispatch_count, _, attempts = dispatch
            dispatch_mode = current.get("dispatchMode")
            if dispatch_mode is not None and accounting.get("councilMode") != dispatch_mode:
                raise CouncilReceiptConflict(
                    "recoverable failure mode conflicts with its dispatch"
                )
            self._verified_claim_for_receipt(
                request_id,
                request_hash,
                current,
                dispatch_count,
            )
            failure = _attempt_from_accounting(
                accounting,
                generation=dispatch_count,
                outcome="failed_no_final_answer",
                failure_code=REDISPATCHABLE_FAILURE_CODE,
            )
            failed = {
                **current,
                "state": "failed",
                "updatedAt": _now_iso(),
                "failureCode": REDISPATCHABLE_FAILURE_CODE,
                "attempts": [*attempts, failure],
            }
            _validated_dispatch_fields(failed)
            self._replace(path, failed)
            return failed

    def promptless_metadata(
        self,
        request_id: str,
        request_hash: str,
        receipt: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Return safe dispatch/usage evidence without request or answer data."""

        with self._lock:
            current = receipt or self.read(request_id, request_hash)
            dispatch = _validated_dispatch_fields(current)
            if dispatch is None:
                return {"redispatchAllowed": False}
            dispatch_count, redispatch_count, attempts = dispatch
            claim = self._verified_claim_for_receipt(
                request_id,
                request_hash,
                current,
                dispatch_count,
            )
            last = attempts[-1] if attempts else None
            allowed = bool(
                current.get("state") == "failed"
                and dispatch_count == 1
                and redispatch_count == 0
                and claim is None
                and isinstance(last, dict)
                and last.get("outcome") == "failed_no_final_answer"
                and last.get("failureCode") == REDISPATCHABLE_FAILURE_CODE
                and last.get("finalAnswerPresent") is False
                and _failed_attempt_proves_one_direct_call(current, last)
            )
            metadata: Dict[str, Any] = {
                "dispatchGeneration": dispatch_count,
                "dispatchCount": dispatch_count,
                "redispatchCount": redispatch_count,
                "redispatchAllowed": allowed,
                "attempts": attempts,
            }
            if current.get("state") == "failed" and isinstance(
                current.get("failureCode"), str
            ):
                metadata["failureCode"] = current["failureCode"]
            return metadata


def resolved_receipt_dir() -> Path:
    configured = (os.environ.get("COUNCIL_REQUEST_RECEIPT_DIR") or "").strip()
    if configured:
        return Path(configured)
    ledger_configured = (os.environ.get("COUNCIL_LEDGER_DIR") or "").strip()
    ledger_dir = Path(ledger_configured) if ledger_configured else default_ledger_dir()
    return ledger_dir / "request-receipts"


_stores_lock = threading.Lock()
_stores: Dict[str, StrictCouncilReceiptStore] = {}


def default_receipt_store() -> StrictCouncilReceiptStore:
    path = resolved_receipt_dir().resolve()
    key = str(path)
    with _stores_lock:
        store = _stores.get(key)
        if store is None:
            store = StrictCouncilReceiptStore(path)
            _stores[key] = store
        return store


def parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _canonical_legacy_created_at_from_tail(
    path: Path,
    expected_stat: os.stat_result,
) -> Optional[datetime]:
    """Read the bounded canonical snapshot suffix without trusting ambiguity.

    ``JsonlCouncilLedger`` writes ``createdAt`` and ``updatedAt`` as the final
    two top-level fields.  Old snapshots can contain very large prompts and
    answers, so reading all of them merely to reject a distant time range makes
    a narrow legacy inventory depend on total ledger size.  This fast path is
    intentionally exact-to-document-end.  Anything noncanonical, changing
    while read, or not parseable falls back to the full JSON parser.
    """

    try:
        with path.open("rb") as handle:
            opened_stat = os.fstat(handle.fileno())
            if (
                opened_stat.st_dev != expected_stat.st_dev
                or opened_stat.st_ino != expected_stat.st_ino
                or opened_stat.st_size != expected_stat.st_size
                or opened_stat.st_mtime_ns != expected_stat.st_mtime_ns
            ):
                return None
            offset = max(0, opened_stat.st_size - _LEGACY_CANONICAL_TAIL_BYTES)
            handle.seek(offset)
            tail = handle.read(_LEGACY_CANONICAL_TAIL_BYTES)
            finished_stat = os.fstat(handle.fileno())
            if (
                finished_stat.st_size != opened_stat.st_size
                or finished_stat.st_mtime_ns != opened_stat.st_mtime_ns
            ):
                return None
    except Exception:
        return None
    match = _LEGACY_CANONICAL_TAIL_RE.search(tail)
    if match is None:
        return None
    try:
        created_at = parse_iso(match.group(1).decode("ascii", errors="strict"))
        # Recheck the directory entry only after all tail interpretation. An
        # atomic replacement can leave the opened file stable while changing
        # what a subsequent full read of ``path`` would observe. Only return a
        # trusted timestamp when the pathname still resolves to the exact file
        # that was inspected at the final decision boundary.
        current_stat = path.stat()
        if (
            current_stat.st_dev != opened_stat.st_dev
            or current_stat.st_ino != opened_stat.st_ino
            or current_stat.st_size != opened_stat.st_size
            or current_stat.st_mtime_ns != opened_stat.st_mtime_ns
        ):
            return None
        return created_at
    except Exception:
        return None


def _legacy_runs_inside_fence(
    *,
    created_after: datetime,
    created_before: datetime,
    ledger_dir: Optional[Path] = None,
    exact_request_hash: Optional[str] = None,
    reasoning_effort: str = "",
    reasoning_summary: str = "",
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> list[Dict[str, Any]]:
    if created_before <= created_after:
        raise CouncilReceiptConflict("legacy request time fence is invalid")
    if (created_before - created_after).total_seconds() > 172800:
        raise CouncilReceiptConflict("legacy request time fence is too broad")
    base = ledger_dir
    if base is None:
        configured = (os.environ.get("COUNCIL_LEDGER_DIR") or "").strip()
        base = Path(configured) if configured else default_ledger_dir()
    try:
        # This is intentionally a finite directory snapshot. A legacy writer
        # can publish a new exact file after enumeration, so an empty result is
        # only a read observation and MUST NOT authorize a new dispatch. The
        # migration client retains that fail-closed rule; this resolver only
        # removes already-enumerated, provably unrelated runs from the fence.
        paths: Iterable[Path] = list(base.glob("crun_*.json"))
    except Exception as exc:
        raise CouncilReceiptCorrupt("legacy Council ledger cannot be listed") from exc

    runs: list[Dict[str, Any]] = []
    for path in paths:
        path_stat: Optional[os.stat_result]
        try:
            path_stat = path.stat()
        except Exception:
            # Preserve the legacy parser's behavior: only an unreadable
            # candidate whose declared time is in-fence must fail closed.
            path_stat = None

        def modified_inside_fence() -> bool:
            try:
                modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            except Exception as exc:
                raise CouncilReceiptCorrupt(
                    "legacy Council snapshot metadata is unreadable"
                ) from exc
            return created_after <= modified <= created_before

        # A canonical writer snapshot with both its declared creation and its
        # filesystem publication outside the fence cannot be a candidate.  A
        # declared in-fence time (including a late/backdated file), an in-fence
        # mtime, or any suffix ambiguity always takes the full parser below.
        initial_modified = (
            datetime.fromtimestamp(path_stat.st_mtime, timezone.utc)
            if path_stat is not None
            else None
        )
        fast_created: Optional[datetime] = None
        if initial_modified is not None and not (
            created_after <= initial_modified <= created_before
        ):
            fast_created = _canonical_legacy_created_at_from_tail(path, path_stat)
            if fast_created is not None and not (
                created_after <= fast_created <= created_before
            ):
                continue

        try:
            run = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            # A torn candidate inside the exact window is ambiguity, not a file
            # that may be silently skipped.
            if modified_inside_fence() or (
                fast_created is not None
                and created_after <= fast_created <= created_before
            ):
                raise CouncilReceiptCorrupt("legacy Council snapshot is torn")
            continue
        if not isinstance(run, dict):
            if modified_inside_fence():
                raise CouncilReceiptCorrupt("legacy Council snapshot is not an object")
            continue
        created_raw = run.get("createdAt")
        if not isinstance(created_raw, str):
            if modified_inside_fence():
                raise CouncilReceiptCorrupt("legacy Council snapshot has no creation time")
            continue
        try:
            created = parse_iso(created_raw)
        except Exception:
            if modified_inside_fence():
                raise CouncilReceiptCorrupt(
                    "legacy Council snapshot has an invalid creation time"
                )
            continue
        created_inside = created_after <= created <= created_before
        if exact_request_hash is not None:
            try:
                candidate_hash = legacy_run_hash_v1(
                    run,
                    reasoning_effort=reasoning_effort,
                    reasoning_summary=reasoning_summary,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                if created_inside or modified_inside_fence():
                    raise CouncilReceiptCorrupt(
                        "legacy Council snapshot cannot be canonically bound"
                    ) from exc
                continue
            # Publication and terminal checks are authority for one exact
            # canonical request, not for every other Council task that happened
            # near it. In particular, an unrelated visualization written late
            # cannot poison recovery of a lesson-generation request.
            if not hmac.compare_digest(candidate_hash, exact_request_hash):
                continue
            modified_inside = modified_inside_fence()
            if created_inside != modified_inside and (
                created_inside or modified_inside
            ):
                raise CouncilReceiptCorrupt(
                    "legacy Council snapshot publication is outside the recovery fence"
                )
            if created_inside:
                runs.append(run)
            continue

        if created_inside:
            # A snapshot copied or rewritten after recovery can backdate its
            # declared createdAt. Treat filesystem publication outside the
            # same inclusive fence as ambiguity instead of silently adding it
            # to a previously sealed legacy epoch.
            if not modified_inside_fence():
                raise CouncilReceiptCorrupt(
                    "legacy Council snapshot publication is outside the recovery fence"
                )
            runs.append(run)
    return runs


def legacy_completed_matches(
    *,
    request_hash: str,
    created_after: datetime,
    created_before: datetime,
    reasoning_effort: str,
    reasoning_summary: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    ledger_dir: Optional[Path] = None,
) -> list[Dict[str, Any]]:
    if not valid_request_hash(request_hash):
        raise CouncilReceiptConflict("invalid legacy request hash")
    matches: list[Dict[str, Any]] = []
    for run in _legacy_runs_inside_fence(
        created_after=created_after,
        created_before=created_before,
        ledger_dir=ledger_dir,
        exact_request_hash=request_hash,
        reasoning_effort=reasoning_effort,
        reasoning_summary=reasoning_summary,
        temperature=temperature,
        max_tokens=max_tokens,
    ):
        _validated_legacy_terminal_times(run, created_before=created_before)
        result = safe_result_from_legacy_run(run)
        if result is None:
            continue
        candidate_hash = legacy_run_hash_v1(
            run,
            reasoning_effort=reasoning_effort,
            reasoning_summary=reasoning_summary,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if hmac.compare_digest(candidate_hash, request_hash):
            matches.append(result)
    return matches


def _validated_legacy_terminal_times(
    run: Dict[str, Any],
    *,
    created_before: datetime,
) -> tuple[str, str]:
    created_raw, updated_raw, _, updated = _strict_time_pair(
        run.get("createdAt"),
        run.get("updatedAt"),
        label="legacy Council outcome",
    )
    if updated > created_before:
        raise CouncilReceiptCorrupt("legacy Council outcome is not terminal in its fence")
    return created_raw, updated_raw


def _safe_legacy_failed_outcome(
    run: Dict[str, Any],
    *,
    created_before: datetime,
) -> Dict[str, Any]:
    final_answer = run.get("finalAnswer")
    run_id = run.get("id")
    diagnostics = run.get("diagnostics")
    candidates = run.get("candidates")
    routing_raw = run.get("modelRouting")
    if final_answer is not None and (
        not isinstance(final_answer, str)
        or final_answer.strip()
        or len(final_answer) > _MAX_FINAL_ANSWER_CHARS
    ):
        raise CouncilReceiptCorrupt("legacy Council failure answer state is invalid")
    if not _bounded_token(run_id):
        raise CouncilReceiptCorrupt("legacy Council failure run id is invalid")
    # A terminal Council failure is persisted in Runtime.run's exception path.
    # Requiring that marker and zero candidates prevents a synthesis failure
    # after a usable model result from being mislabeled as safe to dispatch.
    if (
        not isinstance(diagnostics, dict)
        or not isinstance(diagnostics.get("error"), str)
        or not diagnostics["error"].strip()
        or len(diagnostics["error"]) > _MAX_DIAGNOSTIC_CHARS
        or not isinstance(candidates, list)
        or candidates
    ):
        raise CouncilReceiptCorrupt(
            "legacy Council run does not prove a zero-candidate terminal failure"
        )
    if not isinstance(routing_raw, list):
        raise CouncilReceiptCorrupt("legacy Council failure routing is invalid")
    routing = _project_recovery_routing(routing_raw)
    usage = _safe_attempt_usage(run.get("usage"))
    usage_estimated = (
        usage is not None
        and usage["reportedCallCount"] != usage["callCount"]
    )
    if (
        usage is None
        or usage["callCount"] != 1
        or usage["reportedCallCount"] not in (0, 1)
    ):
        raise CouncilReceiptCorrupt("legacy Council failure usage is invalid")
    created_raw, updated_raw = _validated_legacy_terminal_times(
        run,
        created_before=created_before,
    )
    council_mode = run.get("councilMode")
    requested_model = run.get("requestedModel")
    resolved_model = run.get("resolvedModel")
    if (
        council_mode != "direct_council"
        or not _bounded_token(requested_model)
        or not _bounded_token(resolved_model)
    ):
        raise CouncilReceiptCorrupt("legacy Council failure model binding is invalid")
    routing = _strict_routing(
        routing,
        run_id=run_id,
        requested_model=requested_model,
        resolved_model=resolved_model,
    )
    if len(routing) != 1:
        raise CouncilReceiptCorrupt(
            "legacy Council failure does not prove exactly one model call"
        )
    failed_route = routing[0]
    error_code = failed_route.get("errorCode")
    failure_phase = failed_route.get("failurePhase")
    partial_output = failed_route.get("partialOutput")
    replay_safe = failed_route.get("replaySafe")
    if (
        failed_route.get("outcome") != "failed"
        or failed_route.get("fallback") is not False
        or not _bounded_token(error_code)
        or not _bounded_token(failure_phase)
        or type(partial_output) is not bool
        or type(replay_safe) is not bool
    ):
        raise CouncilReceiptCorrupt("legacy Council failure route is not exact")
    return {
        "outcome": "failed",
        "councilRunId": run_id,
        "finalAnswerPresent": False,
        "candidateCount": 0,
        "failureCode": error_code,
        "failurePhase": failure_phase,
        "partialOutput": partial_output,
        "replaySafe": replay_safe,
        "councilMode": council_mode,
        "requestedModel": requested_model,
        "resolvedModel": resolved_model,
        "usage": usage,
        "usageEstimated": usage_estimated,
        "modelRouting": routing,
        "createdAt": created_raw,
        "updatedAt": updated_raw,
    }


def legacy_outcome_matches(
    *,
    request_hash: str,
    created_after: datetime,
    created_before: datetime,
    reasoning_effort: str,
    reasoning_summary: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    ledger_dir: Optional[Path] = None,
) -> list[Dict[str, Any]]:
    """Return exact prompt-free completed or failed legacy outcomes.

    Zero matches is deliberately distinct from a failed outcome: callers may
    authorize migration only from the latter. Multiple matches remain
    ambiguity and are rejected by the HTTP resolver.
    """

    if not valid_request_hash(request_hash):
        raise CouncilReceiptConflict("invalid legacy request hash")
    matches: list[Dict[str, Any]] = []
    for run in _legacy_runs_inside_fence(
        created_after=created_after,
        created_before=created_before,
        ledger_dir=ledger_dir,
        exact_request_hash=request_hash,
        reasoning_effort=reasoning_effort,
        reasoning_summary=reasoning_summary,
        temperature=temperature,
        max_tokens=max_tokens,
    ):
        try:
            candidate_hash = legacy_run_hash_v1(
                run,
                reasoning_effort=reasoning_effort,
                reasoning_summary=reasoning_summary,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:
            raise CouncilReceiptCorrupt(
                "legacy Council outcome cannot be canonically bound"
            ) from exc
        if not hmac.compare_digest(candidate_hash, request_hash):
            continue

        completed = safe_result_from_legacy_run(run)
        if completed is not None:
            _validated_legacy_terminal_times(run, created_before=created_before)
            if _safe_attempt_usage(completed.get("usage")) is None:
                raise CouncilReceiptCorrupt("legacy Council completion usage is invalid")
            matches.append({"outcome": "completed", "result": completed})
        else:
            matches.append(
                _safe_legacy_failed_outcome(
                    run,
                    created_before=created_before,
                )
            )
    return matches


def _legacy_selection_binding_matches(
    run: Dict[str, Any],
    *,
    garden_id: str,
    source_set_hash: str,
    source_ids: list[str],
) -> bool:
    source_context = run.get("sourceContext")
    if not isinstance(source_context, dict):
        return False
    return (
        source_context.get("gardenId") == garden_id
        and source_context.get("sourceSetHash") == source_set_hash
        and source_context.get("sourceIds") == source_ids
    )


def _legacy_repair_links_previous(
    run: Dict[str, Any],
    previous: Dict[str, Any],
    *,
    garden_id: str,
) -> bool:
    """Prove an old repair snapshot is the next call in the prior result chain.

    Pre-receipt repair calls intentionally replaced their broad source context
    with compact stage metadata.  Their user payload still contains the exact
    rejected response, so it can bind the repair to the immediately preceding
    completed run without exposing either prompt through the inventory API.
    """

    source_context = run.get("sourceContext")
    if not isinstance(source_context, dict):
        return False
    repair_attempt = source_context.get("repairAttempt")
    if (
        source_context.get("gardenId") != garden_id
        or not isinstance(repair_attempt, int)
        or isinstance(repair_attempt, bool)
        or repair_attempt < 1
    ):
        return False
    messages = run.get("messages")
    if not isinstance(messages, list):
        return False
    user_content = next(
        (
            message.get("content")
            for message in reversed(messages)
            if isinstance(message, dict) and message.get("role") == "user"
        ),
        None,
    )
    if not isinstance(user_content, str):
        return False
    try:
        repair_payload = json.loads(user_content)
        previous_answer = json.loads(previous.get("finalAnswer", ""))
    except Exception:
        return False
    if not isinstance(repair_payload, dict):
        return False
    return (
        repair_payload.get("repairAttempt") == repair_attempt
        and canonical_json_v1(repair_payload.get("invalidResponse"))
        == canonical_json_v1(previous_answer)
    )


def legacy_completed_inventory(
    *,
    created_after: datetime,
    created_before: datetime,
    reasoning_effort: str,
    reasoning_summary: str,
    garden_id: str,
    requested_model: str,
    source_set_hash: str,
    source_ids: list[str],
    ledger_dir: Optional[Path] = None,
) -> list[Dict[str, Any]]:
    """Return an ordered, promptless inventory for one recovered Learn origin.

    The legacy resolver is intentionally hash-addressed and cannot enumerate a
    pre-receipt job.  This read-only bridge enumerates only completed snapshots
    inside the exact recovery fence, binds the first call to the exact selected
    source set, and binds compact repair calls to the preceding result.  It
    returns hashes and allowlisted routing metadata, never prompts or answers.
    """

    if (
        not garden_id
        or len(garden_id) > 240
        or not requested_model
        or len(requested_model) > 240
        or not valid_request_hash(source_set_hash)
        or not isinstance(source_ids, list)
        or not source_ids
        or any(not isinstance(value, str) or not value for value in source_ids)
    ):
        raise CouncilReceiptConflict("legacy inventory binding is invalid")

    bound_runs: list[Dict[str, Any]] = []
    for run in _legacy_runs_inside_fence(
        created_after=created_after,
        created_before=created_before,
        ledger_dir=ledger_dir,
    ):
        if (
            run.get("gardenId") != garden_id
            or run.get("requestedModel") != requested_model
            or run.get("resolvedModel") != requested_model
        ):
            continue
        if safe_result_from_legacy_run(run) is None:
            raise CouncilReceiptCorrupt(
                "legacy inventory contains an incomplete bound Council run"
            )
        bound_runs.append(run)

    def created_at(run: Dict[str, Any]) -> datetime:
        raw = run.get("createdAt")
        if not isinstance(raw, str):
            raise CouncilReceiptCorrupt("legacy inventory run has no creation time")
        try:
            return parse_iso(raw)
        except Exception as exc:
            raise CouncilReceiptCorrupt(
                "legacy inventory run has an invalid creation time"
            ) from exc

    bound_runs.sort(key=lambda run: (created_at(run), str(run.get("id") or "")))
    inventory: list[Dict[str, Any]] = []
    request_hashes: set[str] = set()
    run_ids: set[str] = set()
    previous: Optional[Dict[str, Any]] = None
    previous_updated: Optional[datetime] = None
    for sequence, run in enumerate(bound_runs):
        created = created_at(run)
        updated_raw = run.get("updatedAt")
        if not isinstance(updated_raw, str):
            raise CouncilReceiptCorrupt("legacy inventory run has no completion time")
        try:
            updated = parse_iso(updated_raw)
        except Exception as exc:
            raise CouncilReceiptCorrupt(
                "legacy inventory run has an invalid completion time"
            ) from exc
        if (
            updated < created
            or updated > created_before
            or (previous_updated is not None and created < previous_updated)
        ):
            raise CouncilReceiptCorrupt("legacy inventory calls are not serialized")
        selection_bound = _legacy_selection_binding_matches(
            run,
            garden_id=garden_id,
            source_set_hash=source_set_hash,
            source_ids=source_ids,
        )
        repair_bound = previous is not None and _legacy_repair_links_previous(
            run,
            previous,
            garden_id=garden_id,
        )
        if not selection_bound and not repair_bound:
            raise CouncilReceiptCorrupt(
                "legacy inventory run is not bound to the recovered source selection"
            )

        result = safe_result_from_legacy_run(run)
        if result is None:  # Guard retained for type narrowing after validation above.
            raise CouncilReceiptCorrupt("legacy inventory result is unavailable")
        request_hash = legacy_run_hash_v1(
            run,
            reasoning_effort=reasoning_effort,
            reasoning_summary=reasoning_summary,
        )
        run_id = result.get("councilRunId")
        response_hash = result.get("responseHash")
        if (
            request_hash in request_hashes
            or not isinstance(run_id, str)
            or not run_id
            or run_id in run_ids
            or not valid_request_hash(response_hash)
        ):
            raise CouncilReceiptCorrupt("legacy inventory result identity is ambiguous")
        request_hashes.add(request_hash)
        run_ids.add(run_id)
        inventory.append(
            {
                "sequence": sequence,
                "requestHash": request_hash,
                "councilRunId": run_id,
                "responseHash": response_hash,
                "createdAt": result.get("createdAt"),
                "updatedAt": result.get("updatedAt"),
                "councilMode": result.get("councilMode"),
                "requestedModel": result.get("requestedModel"),
                "resolvedModel": result.get("resolvedModel"),
                "usage": result.get("usage"),
                "modelRouting": result.get("modelRouting"),
            }
        )
        previous = run
        previous_updated = updated
    return inventory
