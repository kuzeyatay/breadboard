"""Content-free structured lifecycle events for the local detector service."""

from __future__ import annotations

import json
import sys
import time
from typing import Any


def emit(event: str, **fields: Any) -> None:
    """Write one bounded JSON event without accepting user content fields."""
    allowed = {
        "modality",
        "status",
        "duration_ms",
        "queue_depth",
        "device",
        "reason",
    }
    payload = {
        "schemaVersion": 1,
        "component": "detect-ai",
        "event": event,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **{key: value for key, value in fields.items() if key in allowed},
    }
    sys.stderr.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stderr.flush()
