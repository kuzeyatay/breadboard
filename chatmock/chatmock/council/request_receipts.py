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
_REQUEST_ID_RE = re.compile(r"^lrq_[A-Za-z0-9_-]{8,120}$")
_REQUEST_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_JS_MAX_SAFE_INTEGER = 9_007_199_254_740_991


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
    allowed = (
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
    )
    result: list[Dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        result.append({key: item.get(key) for key in allowed if key in item})
    return result


def safe_result_from_run(run: CouncilRun) -> Dict[str, Any]:
    usage = run.token_usage_snapshot()
    final_answer = run.final_answer or ""
    return {
        "councilRunId": run.id,
        "councilMode": run.council_mode,
        "requestedModel": run.requested_model,
        "resolvedModel": run.resolved_model,
        "finalAnswer": final_answer,
        "reasoningSummary": run.reasoning_summary or None,
        "usage": {
            "inputTokens": usage.input_tokens,
            "outputTokens": usage.output_tokens,
            "totalTokens": usage.total_tokens,
            "cachedInputTokens": usage.cached_input_tokens,
            "reasoningTokens": usage.reasoning_tokens,
            "callCount": usage.call_count,
            "reportedCallCount": usage.reported_call_count,
        },
        "modelRouting": _safe_model_routing(run.model_attempts_snapshot()),
        "responseHash": hashlib.sha256(final_answer.encode("utf-8")).hexdigest(),
        "createdAt": run.created_at,
        "updatedAt": run.updated_at,
    }


def safe_result_from_legacy_run(run: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    final_answer = run.get("finalAnswer")
    run_id = run.get("id")
    if not isinstance(final_answer, str) or not final_answer.strip():
        return None
    if not isinstance(run_id, str) or not run_id:
        return None
    usage = run.get("usage") if isinstance(run.get("usage"), dict) else {}
    return {
        "councilRunId": run_id,
        "councilMode": run.get("councilMode"),
        "requestedModel": run.get("requestedModel"),
        "resolvedModel": run.get("resolvedModel"),
        "finalAnswer": final_answer,
        "reasoningSummary": run.get("reasoningSummary"),
        "usage": {
            key: usage.get(key, 0)
            for key in (
                "inputTokens",
                "outputTokens",
                "totalTokens",
                "cachedInputTokens",
                "reasoningTokens",
                "callCount",
                "reportedCallCount",
            )
        },
        "modelRouting": _safe_model_routing(run.get("modelRouting")),
        "responseHash": hashlib.sha256(final_answer.encode("utf-8")).hexdigest(),
        "createdAt": run.get("createdAt"),
        "updatedAt": run.get("updatedAt"),
    }


def _strict_json_bytes(value: Dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


class StrictCouncilReceiptStore:
    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)
        self._lock = threading.RLock()

    def _path(self, request_id: str) -> Path:
        if not valid_request_id(request_id):
            raise CouncilReceiptConflict("invalid recoverable request id")
        return self.base_dir / f"{request_id}.json"

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
        if value.get("schemaVersion") != RECEIPT_SCHEMA_VERSION:
            raise CouncilReceiptCorrupt("recoverable request receipt schema is invalid")
        if not valid_request_id(value.get("requestId")):
            raise CouncilReceiptCorrupt("recoverable request receipt id is invalid")
        if not valid_request_hash(value.get("requestHash")):
            raise CouncilReceiptCorrupt("recoverable request receipt hash is invalid")
        if value.get("state") not in ("started", "completed", "failed"):
            raise CouncilReceiptCorrupt("recoverable request receipt state is invalid")
        return value

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

    def reserve(self, request_id: str, request_hash: str) -> Dict[str, Any]:
        if not valid_request_hash(request_hash):
            raise CouncilReceiptConflict("invalid recoverable request hash")
        path = self._path(request_id)
        now = _now_iso()
        value = {
            "schemaVersion": RECEIPT_SCHEMA_VERSION,
            "requestId": request_id,
            "requestHash": request_hash,
            "state": "started",
            "createdAt": now,
            "updatedAt": now,
        }
        payload = _strict_json_bytes(value)
        with self._lock:
            self._ensure_dir()
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
            answer = result.get("finalAnswer")
            if not isinstance(answer, str) or not answer.strip():
                raise CouncilReceiptConflict("recoverable result has no final answer")
            completed = {
                **current,
                "state": "completed",
                "updatedAt": _now_iso(),
                "result": result,
            }
            self._replace(path, completed)
            return completed

    def fail(self, request_id: str, request_hash: str, code: str) -> Dict[str, Any]:
        with self._lock:
            path = self._path(request_id)
            current = self.read(request_id, request_hash)
            if current.get("state") != "started":
                raise CouncilReceiptConflict(
                    f"recoverable request cannot fail from {current.get('state')}"
                )
            failed = {
                **current,
                "state": "failed",
                "updatedAt": _now_iso(),
                "failureCode": str(code)[:120],
            }
            self._replace(path, failed)
            return failed


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


def _legacy_runs_inside_fence(
    *,
    created_after: datetime,
    created_before: datetime,
    ledger_dir: Optional[Path] = None,
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
        paths: Iterable[Path] = list(base.glob("crun_*.json"))
    except Exception as exc:
        raise CouncilReceiptCorrupt("legacy Council ledger cannot be listed") from exc

    runs: list[Dict[str, Any]] = []
    for path in paths:
        def modified_inside_fence() -> bool:
            try:
                modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            except Exception as exc:
                raise CouncilReceiptCorrupt(
                    "legacy Council snapshot metadata is unreadable"
                ) from exc
            return created_after <= modified <= created_before

        try:
            run = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            # A torn candidate inside the exact window is ambiguity, not a file
            # that may be silently skipped.
            if modified_inside_fence():
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
        if created_after <= created <= created_before:
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
    ):
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
