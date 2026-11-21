"""TinyPNG (Tinify API): `TINYPNG_API_KEY`.

1. `POST https://api.tinify.com/shrink` with the image as the body, Basic auth `api:<key>` → 201 and a
   `Location` (`https://api.tinify.com/output/<id>`).
2. `GET` that location for the file, or `POST` it `{"preserve": [...]}` to keep the metadata.

TinyPNG makes PNGs smaller by reducing their colours (lossy), and JPG, WebP and AVIF by encoding them again.
"""

from __future__ import annotations

import base64
import json

from django.conf import settings
from django.views.decorators.debug import sensitive_variables

from . import http
from .base import Job, OptimizerError

API = "https://api.tinify.com"
PRESERVE = ["copyright", "creation", "location"]


class TinyPng:
    id = "tinypng"
    name = "TinyPNG"
    formats = ("png", "jpg", "webp", "avif")
    sends_offsite = True

    def ready(self) -> bool:
        return bool(settings.TINYPNG_API_KEY.strip())

    @sensitive_variables("auth")
    def shrink(self, job: Job, deadline: float) -> bytes:
        auth = "Basic " + base64.b64encode(f"api:{settings.TINYPNG_API_KEY.strip()}".encode()).decode()
        shrunk = http.send(
            "POST",
            f"{API}/shrink",
            deadline=deadline,
            max_bytes=http.JSON_MAX_BYTES,
            headers={"Authorization": auth, "Content-Type": job.mime},
            body=job.data,
        )
        if shrunk.status != 201:
            raise http.failure(shrunk, "message", "error")
        location = shrunk.header("location")
        if location.startswith("/"):
            location = API + location
        if not location.startswith(f"{API}/output/"):  # the key goes to the API and nowhere else
            raise OptimizerError("the service sent no download address")
        if job.strip_metadata:
            output = http.send(
                "GET",
                location,
                deadline=deadline,
                max_bytes=settings.IMAGE_OPTIMIZER_MAX_BYTES,
                headers={"Authorization": auth},
            )
        else:
            output = http.send(
                "POST",
                location,
                deadline=deadline,
                max_bytes=settings.IMAGE_OPTIMIZER_MAX_BYTES,
                headers={"Authorization": auth, "Content-Type": "application/json"},
                body=json.dumps({"preserve": PRESERVE}).encode(),
            )
        if output.status != 200:
            raise http.failure(output, "message", "error")
        return output.body
