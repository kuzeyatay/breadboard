from __future__ import annotations

import re


_OPAQUE_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")
_SENSITIVE_MARKERS = (
    "secret",
    "token",
    "password",
    "private-key",
    "api_key",
    "apikey",
    "credential",
    "authorization",
    "bearer",
)
_COMMON_SECRET_PREFIX = re.compile(
    r"(?:^|[^a-z0-9])(?:sk|pk|rk|xox[a-z]?)[_-][a-z0-9_-]{8,}",
    re.IGNORECASE,
)
_PLATFORM_SECRET_PREFIX = re.compile(
    r"(?:^|[^a-z0-9])(?:gh[oprs]|github_pat|npm|whsec|glpat)[_-][a-z0-9_-]{16,}",
    re.IGNORECASE,
)
_AWS_ACCESS_KEY = re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")
_GOOGLE_API_KEY = re.compile(r"\bAIza[A-Za-z0-9_-]{20,}\b", re.IGNORECASE)


def is_sensitive_metadata_text(value: str) -> bool:
    lowered = value.lower()
    return (
        any(marker in lowered for marker in _SENSITIVE_MARKERS)
        or bool(_COMMON_SECRET_PREFIX.search(value))
        or bool(_PLATFORM_SECRET_PREFIX.search(value))
        or bool(_AWS_ACCESS_KEY.search(value))
        or bool(_GOOGLE_API_KEY.search(value))
    )


def redact_metadata_text(value: str, *, limit: int) -> str:
    if is_sensitive_metadata_text(value):
        return "[redacted]"
    return value[:limit]


def require_opaque_metadata_ref(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not _OPAQUE_REFERENCE.fullmatch(value) or is_sensitive_metadata_text(value):
        raise ValueError(f"{field} must be a safe opaque metadata reference")
    return value
