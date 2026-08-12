from __future__ import annotations

"""The OpenAI-compatible `/v1/embeddings` surface.

Thin on purpose: parsing and shaping live here, the two backends live in
`chatmock.embeddings`. `/v1/embeddings/models` is a ChatMock extension — the
local catalog with each model's dimension, which a client has to know before it
can create a vector index.
"""

from typing import Any, Dict

from flask import Blueprint, Response, jsonify, make_response, request

from .embeddings import (
    EmbeddingError,
    embed_local,
    embed_remote,
    embedding_model_entries,
    is_local_model,
    local_available,
    normalize_input,
)
from .http import build_cors_headers

embeddings_bp = Blueprint("embeddings", __name__)


def _with_cors(payload: Any, status: int) -> Response:
    resp = make_response(jsonify(payload), status)
    for key, value in build_cors_headers().items():
        resp.headers.setdefault(key, value)
    return resp


def _error(status: int, message: str) -> Response:
    return _with_cors({"error": {"message": message, "type": "invalid_request_error"}}, status)


@embeddings_bp.route("/v1/embeddings", methods=["POST", "OPTIONS"])
def create_embeddings() -> Response:
    if request.method == "OPTIONS":
        return _with_cors({}, 204)

    raw = request.get_json(silent=True)
    if not isinstance(raw, dict):
        return _error(400, "The request body must be a JSON object.")
    payload: Dict[str, Any] = raw
    model = payload.get("model")

    try:
        if is_local_model(model):
            texts = normalize_input(payload.get("input"))
            vectors, resolved_model, dimension = embed_local(model, texts)
            # Token accounting is approximate for the local backend: fastembed
            # does not report it, and a made-up exact number would be worse
            # than an obvious estimate. Callers use it for progress, not billing.
            estimated = sum(max(1, len(text) // 4) for text in texts)
            return _with_cors(
                {
                    "object": "list",
                    "model": resolved_model,
                    "dimensions": dimension,
                    "data": [
                        {"object": "embedding", "index": index, "embedding": vector}
                        for index, vector in enumerate(vectors)
                    ],
                    "usage": {"prompt_tokens": estimated, "total_tokens": estimated},
                },
                200,
            )

        body, resolved_model = embed_remote(model, payload)
        # Keep the provider's own body, but make sure the model reads as the id
        # the client asked for rather than the upstream's unprefixed one.
        if isinstance(body, dict):
            body = {**body, "model": body.get("model") or resolved_model}
        return _with_cors(body, 200)
    except EmbeddingError as error:
        return _error(error.status, str(error))
    except Exception as error:  # pragma: no cover - defensive
        return _error(500, f"The embedding request failed: {error}")


@embeddings_bp.route("/v1/embeddings/models", methods=["GET"])
def list_embedding_models() -> Response:
    return _with_cors(
        {
            "object": "list",
            "localAvailable": local_available(),
            "data": embedding_model_entries(),
        },
        200,
    )
