from __future__ import annotations

"""Loopback-only, promptless recovery reads for durable Council results."""

import ipaddress
import json
from typing import Any, Dict

from flask import Blueprint, jsonify, request

from .request_receipts import (
    CouncilReceiptConflict,
    CouncilReceiptCorrupt,
    CouncilReceiptNotFound,
    default_receipt_store,
    legacy_completed_inventory,
    legacy_completed_matches,
    legacy_outcome_matches,
    parse_iso,
    strict_completed_result,
    valid_request_hash,
    valid_request_id,
)


council_result_bp = Blueprint("council_result", __name__)


def _loopback() -> bool:
    try:
        return ipaddress.ip_address(request.remote_addr or "").is_loopback
    except ValueError:
        return False


def _internal_read_denial():
    if not _loopback():
        return _error("Council result recovery is loopback-only", 403, "loopback_required")
    # ChatMock's public compatibility API deliberately reflects CORS origins.
    # These recovery reads contain durable identifiers (and resolve can return
    # an answer), so browser-originated requests are not part of this internal
    # server-to-server contract even when the browser itself is on loopback.
    # Node's standards-based fetch may itself emit Sec-Fetch-Mode, so Origin is
    # the reliable discriminator: a browser cross-origin read always carries
    # it, while the Dashboard/CLI server-to-server GET intentionally does not.
    if request.headers.get("Origin") is not None:
        return _error(
            "Council result recovery rejects browser-originated reads",
            403,
            "browser_forbidden",
        )
    return None


def _error(message: str, status: int, code: str):
    return jsonify({"error": {"message": message, "code": code}}), status


def _promptless_result(receipt: Dict[str, Any]) -> Dict[str, Any]:
    result = receipt.get("result")
    return strict_completed_result(result)


@council_result_bp.get("/v1/internal/council-results/resolve")
def resolve_council_result():
    denial = _internal_read_denial()
    if denial is not None:
        return denial
    request_id = request.args.get("requestId", "")
    request_hash = request.args.get("requestHash", "")
    if not valid_request_id(request_id) or not valid_request_hash(request_hash):
        return _error("Invalid request receipt binding", 400, "invalid_binding")
    try:
        store = default_receipt_store()
        receipt = store.read(request_id, request_hash)
        state = receipt.get("state")
        if state == "started":
            return (
                jsonify(
                    {
                        "state": "started",
                        "error": {
                            "message": "Council request is still in-flight or its outcome is ambiguous",
                            "code": "request_started",
                        },
                        "receipt": store.promptless_metadata(
                            request_id,
                            request_hash,
                            receipt,
                        ),
                    }
                ),
                409,
            )
        if state == "failed":
            return (
                jsonify(
                    {
                        "state": "failed",
                        "error": {
                            "message": "Council request completed without a reusable answer",
                            "code": "request_failed",
                        },
                        "receipt": store.promptless_metadata(
                            request_id,
                            request_hash,
                            receipt,
                        ),
                    }
                ),
                409,
            )
        return jsonify(
            {
                "state": "completed",
                "result": _promptless_result(receipt),
                "receipt": store.promptless_metadata(
                    request_id,
                    request_hash,
                    receipt,
                ),
            }
        )
    except CouncilReceiptNotFound:
        return _error("Council request receipt not found", 404, "receipt_not_found")
    except CouncilReceiptConflict:
        return _error("Council request receipt binding conflicts", 409, "binding_conflict")
    except CouncilReceiptCorrupt:
        return _error("Council request receipt is corrupt", 409, "receipt_corrupt")
    except Exception:
        return _error("Council request receipt could not be read", 500, "receipt_read_failed")


@council_result_bp.get("/v1/internal/council-results/legacy-resolve")
def resolve_legacy_council_result():
    denial = _internal_read_denial()
    if denial is not None:
        return denial
    request_hash = request.args.get("requestHash", "")
    created_after = request.args.get("createdAfter", "")
    created_before = request.args.get("createdBefore", "")
    effort = request.args.get("reasoningEffort", "")
    summary = request.args.get("reasoningSummary", "")
    if not valid_request_hash(request_hash):
        return _error("Invalid legacy request hash", 400, "invalid_binding")
    if not effort or not summary or len(effort) > 32 or len(summary) > 32:
        return _error("Invalid legacy reasoning policy", 400, "invalid_policy")
    try:
        after = parse_iso(created_after)
        before = parse_iso(created_before)
    except Exception:
        return _error("Legacy result fence is invalid", 400, "invalid_fence")
    try:
        matches = legacy_completed_matches(
            request_hash=request_hash,
            created_after=after,
            created_before=before,
            reasoning_effort=effort,
            reasoning_summary=summary,
        )
    except CouncilReceiptConflict:
        return _error("Legacy result fence is invalid", 400, "invalid_fence")
    except CouncilReceiptCorrupt:
        return _error("Legacy Council ledger is ambiguous", 409, "legacy_ledger_ambiguous")
    except Exception:
        return _error("Legacy Council ledger could not be read", 500, "legacy_read_failed")
    if not matches:
        return _error("No exact completed legacy Council result exists", 404, "legacy_not_found")
    if len(matches) != 1:
        return _error("Multiple exact legacy Council results exist", 409, "legacy_multiple")
    return jsonify({"state": "completed", "legacy": True, "result": matches[0]})


@council_result_bp.get("/v1/internal/council-results/legacy-outcome")
def resolve_legacy_council_outcome():
    """Resolve one exact terminal pre-receipt run, including safe failures."""

    denial = _internal_read_denial()
    if denial is not None:
        return denial
    request_hash = request.args.get("requestHash", "")
    created_after = request.args.get("createdAfter", "")
    created_before = request.args.get("createdBefore", "")
    effort = request.args.get("reasoningEffort", "")
    summary = request.args.get("reasoningSummary", "")
    if not valid_request_hash(request_hash):
        return _error("Invalid legacy request hash", 400, "invalid_binding")
    if not effort or not summary or len(effort) > 32 or len(summary) > 32:
        return _error("Invalid legacy reasoning policy", 400, "invalid_policy")
    try:
        after = parse_iso(created_after)
        before = parse_iso(created_before)
    except Exception:
        return _error("Legacy outcome fence is invalid", 400, "invalid_fence")
    try:
        matches = legacy_outcome_matches(
            request_hash=request_hash,
            created_after=after,
            created_before=before,
            reasoning_effort=effort,
            reasoning_summary=summary,
        )
    except CouncilReceiptConflict:
        return _error("Legacy outcome fence is invalid", 400, "invalid_fence")
    except CouncilReceiptCorrupt:
        return _error(
            "Legacy Council outcome is ambiguous",
            409,
            "legacy_ledger_ambiguous",
        )
    except Exception:
        return _error(
            "Legacy Council outcome could not be read",
            500,
            "legacy_read_failed",
        )
    if not matches:
        return _error("No exact terminal legacy Council outcome exists", 404, "legacy_not_found")
    if len(matches) != 1:
        return _error("Multiple exact legacy Council outcomes exist", 409, "legacy_multiple")
    outcome = matches[0]
    if outcome.get("outcome") == "completed":
        return jsonify(
            {
                "state": "completed",
                "legacy": True,
                "result": outcome["result"],
            }
        )
    return jsonify({"state": "failed", "legacy": True, "failure": outcome})


@council_result_bp.get("/v1/internal/council-results/legacy-inventory")
def inventory_legacy_council_results():
    """Enumerate only the sealed identities of one recovered legacy run.

    This endpoint is deliberately promptless in both directions.  It exists so
    an operator can seal all already-completed pre-receipt calls before a Learn
    retry; it cannot dispatch or return a model answer.
    """

    denial = _internal_read_denial()
    if denial is not None:
        return denial
    created_after = request.args.get("createdAfter", "")
    created_before = request.args.get("createdBefore", "")
    effort = request.args.get("reasoningEffort", "")
    summary = request.args.get("reasoningSummary", "")
    garden_id = request.args.get("gardenId", "")
    requested_model = request.args.get("requestedModel", "")
    source_set_hash = request.args.get("sourceSetHash", "")
    source_ids_json = request.args.get("sourceIdsJson", "")
    if not effort or not summary or len(effort) > 32 or len(summary) > 32:
        return _error("Invalid legacy reasoning policy", 400, "invalid_policy")
    if len(source_ids_json) > 32_000:
        return _error("Invalid legacy source selection", 400, "invalid_binding")
    try:
        source_ids = json.loads(source_ids_json)
    except Exception:
        return _error("Invalid legacy source selection", 400, "invalid_binding")
    try:
        results = legacy_completed_inventory(
            created_after=parse_iso(created_after),
            created_before=parse_iso(created_before),
            reasoning_effort=effort,
            reasoning_summary=summary,
            garden_id=garden_id,
            requested_model=requested_model,
            source_set_hash=source_set_hash,
            source_ids=source_ids,
        )
    except CouncilReceiptConflict:
        return _error("Legacy inventory fence or binding is invalid", 400, "invalid_fence")
    except CouncilReceiptCorrupt:
        return _error("Legacy Council inventory is ambiguous", 409, "legacy_ledger_ambiguous")
    except Exception:
        return _error("Legacy Council inventory could not be read", 500, "legacy_read_failed")
    return jsonify({"state": "completed", "legacy": True, "results": results})
