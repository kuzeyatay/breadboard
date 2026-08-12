from __future__ import annotations

"""Embeddings for ChatMock: a local model by default, any provider on request.

ChatMock started as a chat gateway, so every Breadboard subsystem that wanted
vectors — semantic retrieval, GBrain, Deep Tutor's knowledge bases — had to
either carry its own embedding client or go without. This module makes vectors
part of the same gateway the chat surfaces already point at.

Two backends, chosen by the model id:

* ``local/<name>`` (and the bare aliases) runs in this process through
  fastembed — ONNX Runtime on the CPU, no key, no network after the first
  model download. This is the default because it is the only backend that
  works on a machine with no paid provider configured, which is the machine
  Breadboard is usually on.
* ``<provider>/<model>`` posts to that provider's own ``/embeddings``,
  reusing the credentials already stored for chat. Same prefix grammar as
  chat completions, so ``openai/text-embedding-3-small`` needs no new config.

fastembed is an optional extra (`pip install -e '.[embeddings]'`): it drags in
ONNX Runtime and tokenizers, which is a lot of megabytes for an install that
only wants chat. Absence is reported as a 503 naming the install command
rather than a stack trace.
"""

import os
import threading
from typing import Any, Dict, List, Tuple

import requests

from .providers import store
from .providers.openai_compatible import build_headers
from .providers.registry import resolve_model
from .providers.catalog import KIND_ANTHROPIC, KIND_CHATGPT_OAUTH
from .utils import get_home_dir

LOCAL_PROVIDER_ID = "local"

#: Local models, by public id. Each entry is (fastembed id, dimension).
#:
#: Deliberately short. These are the sizes worth having on a laptop: a small
#: English model that indexes a Garden in seconds, a larger English one when
#: quality matters more than time, and a multilingual model because notes are
#: not always in English.
LOCAL_MODELS: Dict[str, Tuple[str, int]] = {
    "bge-small-en-v1.5": ("BAAI/bge-small-en-v1.5", 384),
    "bge-base-en-v1.5": ("BAAI/bge-base-en-v1.5", 768),
    "multilingual-e5-small": ("intfloat/multilingual-e5-small", 384),
}

DEFAULT_LOCAL_MODEL = "bge-small-en-v1.5"

INSTALL_HINT = (
    "Local embeddings need the `embeddings` extra: "
    "pip install -e '.[embeddings]' (or: uv pip install fastembed) in the chatmock checkout."
)

# One loaded model per id, shared across requests. Loading is seconds and tens
# of megabytes of resident memory, so it must not happen per call.
_local_models: Dict[str, Any] = {}
_local_lock = threading.Lock()


class EmbeddingError(RuntimeError):
    """A failure with an HTTP status the route can report verbatim."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def normalize_input(value: Any) -> List[str]:
    """Accept every shape the OpenAI embeddings API does.

    A single string, a list of strings, or a list of token-id lists. Token ids
    are refused rather than guessed at: we have no tokenizer to invert them
    with, and returning vectors for the wrong text would be worse than an
    error.
    """
    if isinstance(value, str):
        texts = [value]
    elif isinstance(value, list):
        if any(isinstance(item, (list, int)) for item in value):
            raise EmbeddingError(
                400, "Pre-tokenized input is not supported; send the text itself."
            )
        texts = [str(item) for item in value]
    else:
        raise EmbeddingError(400, "`input` must be a string or an array of strings.")

    if not texts:
        raise EmbeddingError(400, "`input` must not be empty.")
    if len(texts) > 512:
        raise EmbeddingError(400, "`input` is limited to 512 items per request.")
    # An empty string has no meaningful direction; a zero vector would poison a
    # cosine index silently, so it is replaced by a single space, which the
    # tokenizer turns into a real (if uninformative) vector.
    return [text if text.strip() else " " for text in texts]


def is_local_model(model: str) -> bool:
    return resolve_local_name(model) is not None


def resolve_local_name(model: Any) -> str | None:
    """The local model id behind a request, or None when it names a provider."""
    raw = str(model or "").strip()
    if not raw:
        return DEFAULT_LOCAL_MODEL
    if raw.startswith(f"{LOCAL_PROVIDER_ID}/"):
        raw = raw[len(LOCAL_PROVIDER_ID) + 1 :]
    if raw in LOCAL_MODELS:
        return raw
    # Accept the upstream's own name too, so a config copied from fastembed's
    # documentation works.
    for public, (fastembed_id, _dimension) in LOCAL_MODELS.items():
        if raw.lower() == fastembed_id.lower():
            return public
    return None


def local_dimension(model: str) -> int:
    name = resolve_local_name(model) or DEFAULT_LOCAL_MODEL
    return LOCAL_MODELS[name][1]


def model_cache_dir() -> str:
    """Where downloaded ONNX weights live.

    fastembed defaults to the system temp directory, which is exactly the place
    a cleanup tool will empty — and re-downloading a model on a machine that is
    offline turns a working index into a broken one. ChatMock's own home is
    stable and already the place its state lives.
    """
    override = os.getenv("CHATMOCK_EMBEDDING_CACHE")
    if override and override.strip():
        return os.path.abspath(override.strip())
    return os.path.join(get_home_dir(), "embedding-models")


def _load_local(name: str):
    cached = _local_models.get(name)
    if cached is not None:
        return cached
    with _local_lock:
        cached = _local_models.get(name)
        if cached is not None:
            return cached
        try:
            from fastembed import TextEmbedding  # type: ignore import-not-found
        except Exception as exc:  # pragma: no cover - depends on the install
            raise EmbeddingError(503, f"{INSTALL_HINT} ({exc})") from exc
        fastembed_id = LOCAL_MODELS[name][0]
        cache_dir = model_cache_dir()
        try:
            os.makedirs(cache_dir, exist_ok=True)
            model = TextEmbedding(model_name=fastembed_id, cache_dir=cache_dir)
        except Exception as exc:
            # The first use downloads the ONNX weights; no network means no
            # model, and that is worth saying plainly.
            raise EmbeddingError(
                503,
                f"The local embedding model {fastembed_id} could not be loaded: {exc}",
            ) from exc
        _local_models[name] = model
        return model


def embed_local(model: str, texts: List[str]) -> Tuple[List[List[float]], str, int]:
    """Embed in-process. Returns (vectors, public model id, dimension)."""
    name = resolve_local_name(model) or DEFAULT_LOCAL_MODEL
    engine = _load_local(name)
    try:
        vectors = [[float(value) for value in vector] for vector in engine.embed(texts)]
    except Exception as exc:
        raise EmbeddingError(500, f"Local embedding failed: {exc}") from exc
    if len(vectors) != len(texts):
        raise EmbeddingError(500, "The local embedder returned the wrong number of vectors.")
    return vectors, f"{LOCAL_PROVIDER_ID}/{name}", LOCAL_MODELS[name][1]


def embed_remote(model: str, payload: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    """Relay to a configured provider's own embeddings endpoint.

    The response body is returned as the provider sent it — an embeddings
    response has no ChatMock-specific fields to add, and re-encoding it would
    only risk dropping something a client wanted.
    """
    resolved = resolve_model(model)
    if resolved.provider.kind == KIND_CHATGPT_OAUTH:
        raise EmbeddingError(
            400,
            "The ChatGPT upstream has no embeddings endpoint. Use a `local/…` model, "
            "or prefix a provider that offers embeddings (for example `openai/text-embedding-3-small`).",
        )
    if resolved.provider.kind == KIND_ANTHROPIC:
        raise EmbeddingError(
            400, "Anthropic has no embeddings endpoint. Use a `local/…` model instead."
        )

    credentials = store.resolve_credentials(resolved.provider)
    if not credentials.usable:
        raise EmbeddingError(
            400,
            f"{resolved.provider.id} cannot serve embeddings: {credentials.reason}.",
        )

    body = {**payload, "model": resolved.upstream_model}
    url = f"{credentials.base_url}/embeddings"
    try:
        response = requests.post(
            url, headers=build_headers(credentials), json=body, timeout=120
        )
    except requests.RequestException as exc:
        raise EmbeddingError(502, f"{resolved.provider.id} could not be reached: {exc}") from exc

    if response.status_code >= 400:
        # Provider errors can echo request fields; only the status and a short
        # excerpt travel back, never the whole payload.
        excerpt = response.text[:400].replace("\n", " ")
        raise EmbeddingError(
            response.status_code,
            f"{resolved.provider.id} refused the embedding request: {excerpt}",
        )
    try:
        data = response.json()
    except ValueError as exc:
        raise EmbeddingError(502, f"{resolved.provider.id} returned a non-JSON body.") from exc
    if not isinstance(data, dict):
        raise EmbeddingError(502, f"{resolved.provider.id} returned an unexpected body.")
    return data, resolved.public_model


def embedding_model_entries() -> List[Dict[str, Any]]:
    """The local catalog, for a client that wants to know what is on offer.

    Deliberately not merged into ``/v1/models``: that list feeds Breadboard's
    chat-model pickers, and an embedding model shown there would be a model
    that produces no answer.
    """
    return [
        {
            "id": f"{LOCAL_PROVIDER_ID}/{public}",
            "object": "model",
            "owned_by": LOCAL_PROVIDER_ID,
            "dimensions": dimension,
            "upstream": fastembed_id,
        }
        for public, (fastembed_id, dimension) in LOCAL_MODELS.items()
    ]


def local_available() -> bool:
    """Whether an in-process embedding could run right now."""
    try:
        import fastembed  # noqa: F401
    except Exception:
        return False
    return True
