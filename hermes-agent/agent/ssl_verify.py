"""TLS verify resolution for httpx/OpenAI provider clients."""

from __future__ import annotations

from collections import OrderedDict
import logging
import os
import ssl
import threading
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _coerce_insecure(ssl_verify: Any) -> bool:
    if ssl_verify is False:
        return True
    if isinstance(ssl_verify, str) and ssl_verify.strip().lower() in {"false", "0", "no", "off"}:
        return True
    return False


def resolve_httpx_verify(
    *,
    ca_bundle: Optional[str] = None,
    ssl_verify: Any = None,
    base_url: str = "",
) -> bool | ssl.SSLContext:
    """Resolve httpx ``verify`` for provider HTTP clients.

    Priority:
    1. ``ssl_verify: false`` — disable verification (local dev only)
    2. explicit ``ca_bundle`` (per-provider ``ssl_ca_cert`` config field)
    3. ``HERMES_CA_BUNDLE``, ``SSL_CERT_FILE``, ``REQUESTS_CA_BUNDLE``,
       ``CURL_CA_BUNDLE`` env vars
    4. ``True`` (httpx/certifi default)

    ``base_url`` is used only for the insecure-mode warning message.
    """
    if _coerce_insecure(ssl_verify):
        logger.warning(
            "TLS certificate verification DISABLED (ssl_verify: false) for %s — "
            "this is intended for local development only and is unsafe on any "
            "network you do not fully control.",
            base_url or "a custom provider endpoint",
        )
        return False

    effective_ca = (
        (ca_bundle or "").strip()
        or os.getenv("HERMES_CA_BUNDLE", "").strip()
        or os.getenv("SSL_CERT_FILE", "").strip()
        or os.getenv("REQUESTS_CA_BUNDLE", "").strip()
        or os.getenv("CURL_CA_BUNDLE", "").strip()
    )
    if effective_ca:
        ca_path = str(Path(effective_ca).expanduser())
        if os.path.isfile(ca_path):
            return ssl.create_default_context(cafile=ca_path)
        logger.warning(
            "CA bundle path does not exist: %s — falling back to default certificates",
            effective_ca,
        )
    return True


# TLS contexts hold trust configuration, not live sockets. Reusing the default
# trust store avoids reloading the same CA file for every mounted transport and
# every streamed model call, while each request keeps its own connection pool.
_default_contexts: OrderedDict[tuple, ssl.SSLContext] = OrderedDict()
_default_context_lock = threading.Lock()


def prepare_httpx_verify(verify: Any = True) -> Any:
    """Materialize default httpx trust once; preserve explicit TLS settings.

    Only default CA-file contexts are cached. A caller-owned context, insecure
    setting or legacy path passes through unchanged. CA-directory contexts are
    fresh because files inside the directory can rotate independently. A CA
    file's identity and timestamps invalidate its cached trust on replacement.
    """
    if verify is not True:
        return verify
    import certifi

    ca_file = os.environ.get("SSL_CERT_FILE")
    ca_directory = os.environ.get("SSL_CERT_DIR")
    if not ca_file and ca_directory:
        return ssl.create_default_context(capath=ca_directory)
    ca_file = os.path.abspath(ca_file or certifi.where())
    info = os.stat(ca_file)
    key = (ca_file, info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    with _default_context_lock:
        context = _default_contexts.get(key)
        if context is None:
            context = ssl.create_default_context(cafile=ca_file)
            _default_contexts[key] = context
            while len(_default_contexts) > 4:
                _default_contexts.popitem(last=False)
        else:
            _default_contexts.move_to_end(key)
        return context
