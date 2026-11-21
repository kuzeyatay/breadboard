"""Any other optimizer that follows the contract of #133 (`IMAGE_OPTIMIZER_CUSTOM_URL`, `_KEY`, `_NAME`):

    POST {URL}?format=keep&quality=1-100&metadata=none|icc|all      (the body is the image itself)
    Authorization: Bearer {KEY}                                      (only when a key is set)

The answer is the image, with `Content-Type`, `X-Format`, `X-Width`, `X-Height` and `X-Output-Size`, and never
larger than what was sent; errors are 4xx/5xx with `{"error", "message"}`. The contract also has `format`
values that convert, and `resize`/`fit`; Doory doesn't use them: it sends the file in its final format and
size.
"""

from __future__ import annotations

from urllib.parse import urlencode

from django.conf import settings
from django.views.decorators.debug import sensitive_variables

from apps.ai import transport

from . import http
from .base import Job, OptimizerError

CONTRACT_FORMATS = {"png": "png", "jpg": "jpeg", "webp": "webp", "avif": "avif"}
MAX_NAME_LENGTH = 40


def url_problem(url: str) -> str:
    """Why `IMAGE_OPTIMIZER_CUSTOM_URL` can't be used, or ""."""
    try:
        transport.check_url(url, transport.operator_policy(), resolve_hosts=False)
    except transport.TransportError as exc:
        return exc.message
    if "?" in url or "#" in url:
        return "The address may not have a query or fragment."
    return ""


def key_problem(key: str) -> str:
    return "The key contains a line break." if "\r" in key or "\n" in key else ""


def metadata(job: Job) -> str:
    if not job.strip_metadata:
        return "all"
    return "none" if job.srgb else "icc"


class Custom:
    id = "custom"
    formats = ("png", "jpg", "webp", "avif")
    sends_offsite = True  # it may run on this network, but Doory can't tell

    @property
    def name(self) -> str:
        return settings.IMAGE_OPTIMIZER_CUSTOM_NAME.strip()[:MAX_NAME_LENGTH] or "Custom"

    def ready(self) -> bool:
        url = settings.IMAGE_OPTIMIZER_CUSTOM_URL.strip()
        return bool(url) and not url_problem(url) and not key_problem(settings.IMAGE_OPTIMIZER_CUSTOM_KEY)

    @sensitive_variables("headers")
    def shrink(self, job: Job, deadline: float) -> bytes:
        query = {"format": "keep", "metadata": metadata(job)}
        if job.quality is not None:
            query["quality"] = str(job.quality)
        headers = {"Content-Type": job.mime}
        if key := settings.IMAGE_OPTIMIZER_CUSTOM_KEY.strip():
            headers["Authorization"] = f"Bearer {key}"
        answer = http.send(
            "POST",
            f"{settings.IMAGE_OPTIMIZER_CUSTOM_URL.strip()}?{urlencode(query)}",
            deadline=deadline,
            max_bytes=settings.IMAGE_OPTIMIZER_MAX_BYTES,
            headers=headers,
            body=job.data,
        )
        if answer.status != 200:
            raise http.failure(answer, "message", "error")
        expected = {
            "x-format": CONTRACT_FORMATS[job.format],
            "x-width": str(job.width),
            "x-height": str(job.height),
            "x-output-size": str(len(answer.body)),
        }
        for name, value in expected.items():
            sent = answer.header(name).strip().lower()
            if sent and sent not in (value, "jpg" if value == "jpeg" else value):
                raise OptimizerError(f"its {name.title()} header doesn't match the image")
        if answer.content_type and answer.content_type != job.mime:
            raise OptimizerError("it answered with another content type")
        return answer.body
