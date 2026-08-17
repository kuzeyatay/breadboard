from __future__ import annotations

"""The pxpipe proxy, which is how ``claude-fable-5-efficient`` is cheaper.

Fable's bill is dominated by input, and Claude Code re-sends the same bulk on
every turn: its system prompt, its tool documentation, and the older half of the
conversation. pxpipe is a local proxy that renders exactly that bulk into dense
PNG pages before the request leaves the machine. An image costs tokens by its
pixel dimensions rather than by how much text is inside it, so the same context
arrives for roughly a third of the input tokens — read through the same vision
channel Claude already uses for screenshots.

Only one Breadboard model uses it. ``cliproxy/claude-fable-5-efficient`` is the
same Fable 5 as its plain sibling, on the same subscription, reached through the
same Claude Code CLI; the suffix names the route, not a different model. The
sibling stays because the compression is lossy in one specific way: long exact
strings (hashes, ids, keys) buried in imaged bulk can come back subtly wrong
rather than missing. Recent turns are never imaged, so ordinary conversation is
unaffected, but work that turns on byte-exact recall belongs on plain Fable.

The proxy is started here, on the first request that asks for it, rather than
supervised alongside the long-lived services. It is a per-model detail of one
provider path, and this module is the only code in Breadboard that knows the
model exists — starting it anywhere else would mean a second place that has to
agree about the port.
"""

import os
import socket
import subprocess
import time
from pathlib import Path

from .types import ProviderError

# The public model id, and the plain model it is really served by. The CLI is
# given the plain id: `-efficient` describes Breadboard's routing and would be
# rejected upstream as a model name.
EFFICIENT_SUFFIX = "-efficient"

DEFAULT_PORT = 47821
DEFAULT_HOST = "127.0.0.1"

# How long a cold start may take. The proxy loads a bundled glyph atlas and
# binds a socket; a warm machine is ready in well under a second, but a first
# run competing with the request that triggered it can be slower.
_STARTUP_TIMEOUT_SECONDS = 25.0
_STARTUP_POLL_SECONDS = 0.25
_LISTEN_PROBE_SECONDS = 0.5


def is_efficient_model(model: object) -> bool:
    """Whether this id asks for the pxpipe route."""
    normalized = str(model or "").strip().lower()
    if "/" in normalized:
        normalized = normalized.split("/", 1)[1]
    return normalized.startswith("claude-") and normalized.endswith(EFFICIENT_SUFFIX)


def upstream_model(model: str) -> str:
    """The model id the Claude Code CLI actually understands."""
    return model[: -len(EFFICIENT_SUFFIX)] if is_efficient_model(model) else model


def _port() -> int:
    try:
        value = int(os.environ.get("PXPIPE_PORT", "").strip())
    except (TypeError, ValueError):
        return DEFAULT_PORT
    return value if 1 <= value <= 65535 else DEFAULT_PORT


def _configured_base_url() -> str | None:
    """A proxy someone else supervises, which this module must not start."""
    value = os.environ.get("PXPIPE_BASE_URL", "").strip()
    return value.rstrip("/") or None


def _root() -> Path:
    """The pxpipe checkout, which sits beside ChatMock in the repository."""
    configured = os.environ.get("PXPIPE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    # .../<repo>/chatmock/chatmock/providers/pxpipe.py -> <repo>/pxpipe
    return Path(__file__).resolve().parents[3] / "pxpipe"


def _is_listening(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=_LISTEN_PROBE_SECONDS):
            return True
    except OSError:
        return False


def _log_path(root: Path) -> Path:
    from ..utils import get_home_dir

    home = Path(get_home_dir())
    try:
        home.mkdir(parents=True, exist_ok=True)
        return home / "pxpipe.log"
    except OSError:
        return root / "pxpipe.log"


def _log_tail(path: Path, limit: int = 400) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""
    return text[-limit:]


def _spawn(root: Path, port: int) -> None:
    entry = root / "dist" / "node.js"
    if not entry.is_file():
        raise ProviderError(
            "The efficient route needs the pxpipe proxy, which has not been built yet. "
            f"Run `npm install` and `node scripts/build.mjs` in {root}, then try again. "
            "Plain Claude Fable 5 works without it."
        )

    env = os.environ.copy()
    env["PORT"] = str(port)
    # The proxy writes one JSONL row per request to ~/.pxpipe/events.jsonl and
    # nothing else; its own dashboard reads that file. Its console output is
    # only startup banners and failures, so a single log is enough to explain a
    # proxy that refuses to come up.
    log = _log_path(root)
    try:
        handle = log.open("ab")
    except OSError:
        handle = subprocess.DEVNULL

    # No console window on Windows: this is a background service started in the
    # middle of answering a chat message.
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        subprocess.Popen(
            ["node", str(entry)],
            cwd=str(root),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=handle,
            stderr=handle,
            creationflags=creation_flags,
        )
    except FileNotFoundError as exc:
        raise ProviderError(
            "The efficient route needs Node.js to run the pxpipe proxy, and `node` is "
            "not on Breadboard's PATH. Plain Claude Fable 5 works without it."
        ) from exc
    except OSError as exc:
        raise ProviderError(f"The pxpipe proxy could not be started: {exc}") from exc
    finally:
        if handle is not subprocess.DEVNULL:
            handle.close()


def base_url() -> str:
    """The proxy's address, starting it if nothing is listening there yet.

    Idempotent by observation rather than by bookkeeping: the check is whether
    something answers on the port, so a proxy left running by a previous
    ChatMock — or started by hand — is adopted instead of duplicated.
    """
    configured = _configured_base_url()
    if configured:
        return configured

    host, port = DEFAULT_HOST, _port()
    if _is_listening(host, port):
        return f"http://{host}:{port}"

    root = _root()
    if not root.is_dir():
        raise ProviderError(
            "The efficient route needs the pxpipe proxy, which is not installed. "
            f"Clone it to {root} (or set PXPIPE_ROOT), or use plain Claude Fable 5."
        )

    _spawn(root, port)

    deadline = time.monotonic() + _STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if _is_listening(host, port):
            return f"http://{host}:{port}"
        time.sleep(_STARTUP_POLL_SECONDS)

    detail = _log_tail(_log_path(root))
    raise ProviderError(
        "The pxpipe proxy did not start, so the efficient route is unavailable. "
        "Plain Claude Fable 5 works without it."
        + (f" It reported: {detail}" if detail else "")
    )
