"""Outgoing calls of the optimizers that send the image to a service: always through `apps.ai.transport`
(operator policy: the address is checked, redirects are refused, one deadline, a size cap, nothing logged)."""

from __future__ import annotations

import json
import re
import secrets
from collections.abc import Mapping

from apps.ai import transport

from .base import OptimizerError, left

JSON_MAX_BYTES = 64 * 1024  # answers that are not the image
_UNPRINTABLE = re.compile(r"[^\x20-\x7e]+")


def send(
    method: str,
    url: str,
    *,
    deadline: float,
    max_bytes: int,
    headers: Mapping[str, str] | None = None,
    body: bytes = b"",
) -> transport.HttpResponse:
    try:
        return transport.send(
            method,
            url,
            policy=transport.operator_policy(),
            headers=headers,
            body=body,
            max_bytes=max_bytes,
            timeout=left(deadline),
        )
    except transport.TransportError as exc:
        raise OptimizerError(exc.message) from exc


def json_body(response: transport.HttpResponse) -> dict:
    try:
        data = json.loads(response.body)
    except (ValueError, RecursionError):
        return {}
    return data if isinstance(data, dict) else {}


def failure(response: transport.HttpResponse, *fields: str) -> OptimizerError:
    """The error of an answer that is not a success: its status and, when it sends one, its JSON error text
    (`fields`, the first one present), shortened to printable characters."""
    data = json_body(response)
    text = next((data[name] for name in fields if isinstance(data.get(name), str) and data[name]), "")
    text = _UNPRINTABLE.sub(" ", text).strip()[:160]
    return OptimizerError(f"the service answered {response.status}" + (f": {text}" if text else ""))


def multipart(fields: Mapping[str, str], file_field: str, filename: str, mime: str, data: bytes):
    """(body, content type) of a multipart/form-data request with text `fields` and one file."""
    boundary = "doory-" + secrets.token_hex(16)
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields.items()
    ]
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode()
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"
