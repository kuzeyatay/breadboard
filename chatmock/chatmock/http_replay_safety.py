from __future__ import annotations

"""Fail-closed classification for retrying an HTTP request.

An HTTP client exception can happen after a POST reached the server, even when
no response bytes reached this process.  Retrying those failures can therefore
start the same model request twice.  The only exception here is a connection
failure whose exception graph proves that no connection was established.
"""

import errno
from typing import Iterator

import requests
from urllib3 import exceptions as urllib3_exceptions


_REFUSED_ERRNOS = frozenset(
    value
    for value in (
        getattr(errno, "ECONNREFUSED", None),
        # Windows' WSAECONNREFUSED is not exposed as errno.ECONNREFUSED on
        # every Python build.
        10061,
    )
    if isinstance(value, int)
)


def _linked_exceptions(root: BaseException) -> Iterator[BaseException]:
    """Yield a bounded exception graph, including urllib3's ``reason`` link."""

    pending = [root]
    seen: set[int] = set()
    while pending and len(seen) < 32:
        current = pending.pop()
        identity = id(current)
        if identity in seen:
            continue
        seen.add(identity)
        yield current

        linked = [current.__cause__, current.__context__]
        linked.extend(
            getattr(current, name, None)
            for name in ("reason", "original_error")
        )
        linked.extend(current.args)
        pending.extend(value for value in linked if isinstance(value, BaseException))


def is_proven_preconnect_failure(error: BaseException) -> bool:
    """Return true only when the complete error graph proves non-acceptance.

    ``ReadTimeout``, resets, broken pipes, protocol failures, and bare
    ``ConnectionError`` instances remain ambiguous and fail closed.  A requests
    connect timeout or urllib3 new-connection failure is safe because the POST
    could not have been sent.  Mixed graphs are rejected even if they also
    contain a refusal marker.
    """

    if not isinstance(error, requests.RequestException):
        return False

    linked = list(_linked_exceptions(error))
    # Hitting the traversal bound means part of the evidence graph was not
    # inspected. Treat that as ambiguity rather than trusting an early refusal.
    if len(linked) >= 32:
        return False

    evidence = False
    transparent_types = (
        requests.ConnectionError,
        urllib3_exceptions.MaxRetryError,
    )
    safe_evidence_types = (
        requests.ConnectTimeout,
        urllib3_exceptions.NewConnectionError,
        urllib3_exceptions.ConnectTimeoutError,
        ConnectionRefusedError,
    )

    for item in linked:
        if isinstance(item, safe_evidence_types):
            evidence = True
            continue
        if isinstance(item, transparent_types):
            continue
        if isinstance(item, OSError):
            if getattr(item, "errno", None) in _REFUSED_ERRNOS:
                evidence = True
                continue
            return False
        # Unknown wrapper/protocol exceptions make the graph ambiguous.  Do
        # not infer safety from their message text.
        return False
    return evidence
