from __future__ import annotations

import argparse

from ..installer import OmhError
from ..workflows.domain_intelligence import (
    approve_domain_candidate,
    build_domain_review,
    build_domain_status,
    capture_domain_candidate,
    list_domain_profiles,
    reject_domain_candidate,
    retire_domain_profile,
)
from .common import _paths, _print_json


def cmd_memory_domain_status(args: argparse.Namespace) -> int:
    try:
        payload = build_domain_status(_paths(args))
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def cmd_memory_domain_capture(args: argparse.Namespace) -> int:
    try:
        payload = capture_domain_candidate(
            _paths(args),
            scope_kind=args.scope_kind,
            scope_ref=args.scope_ref,
            domain_id=args.domain,
            mappings=_parse_domain_mappings(args.mapping or []),
            workflow_hints=args.workflow_hint or [],
            source_class=args.source_class,
            source_ref=args.source_ref,
            observation_count=args.observation_count,
            confidence=args.confidence,
        )
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def cmd_memory_domain_review(args: argparse.Namespace) -> int:
    try:
        payload = build_domain_review(
            _paths(args),
            candidate_id=args.candidate,
            limit=_optional_positive_int(args.limit, "--limit") or 20,
        )
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def cmd_memory_domain_approve(args: argparse.Namespace) -> int:
    try:
        payload = approve_domain_candidate(_paths(args), args.candidate_id, approved_by=args.approved_by)
    except FileNotFoundError as exc:
        raise OmhError(f"domain-intelligence candidate not found: {args.candidate_id}") from exc
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def cmd_memory_domain_reject(args: argparse.Namespace) -> int:
    try:
        payload = reject_domain_candidate(
            _paths(args),
            args.candidate_id,
            rejected_by=args.rejected_by,
            reason=args.reason,
        )
    except FileNotFoundError as exc:
        raise OmhError(f"domain-intelligence candidate not found: {args.candidate_id}") from exc
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def cmd_memory_domain_list(args: argparse.Namespace) -> int:
    try:
        payload = list_domain_profiles(
            _paths(args),
            scope_kind=args.scope_kind,
            scope_ref=args.scope_ref,
            domain_id=args.domain,
            include_retired=args.include_retired,
        )
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def cmd_memory_domain_retire(args: argparse.Namespace) -> int:
    try:
        payload = retire_domain_profile(
            _paths(args),
            scope_kind=args.scope_kind,
            scope_ref=args.scope_ref,
            domain_id=args.domain,
            retired_by=args.retired_by,
            reason=args.reason,
        )
    except FileNotFoundError as exc:
        raise OmhError(f"domain-intelligence profile not found: {args.domain}") from exc
    except (OSError, ValueError) as exc:
        raise OmhError(str(exc)) from exc
    _print_json(payload)
    return 0


def _optional_positive_int(value: int | None, flag: str) -> int | None:
    if value is None:
        return None
    if value < 1:
        raise ValueError(f"{flag} must be at least 1")
    return value


def _parse_domain_mappings(values: list[str]) -> list[tuple[str, str]]:
    mappings: list[tuple[str, str]] = []
    for value in values:
        if "=" not in value:
            raise ValueError("domain mappings must use PHRASE=CANONICAL_TERM")
        phrase, canonical = value.split("=", 1)
        mappings.append((phrase, canonical))
    return mappings
