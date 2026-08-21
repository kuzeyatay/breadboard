"""Request and response shapes, validated at the edge.

The only caller is Breadboard's own server over loopback, but the payload is a
whole document written by a language model and forwarded from a browser, so
validation here is a boundary rather than a formality. `extra="forbid"` in
particular: a field this service does not understand is a caller that thinks it
is talking to something else.

Same conventions as `colpali-service` and `cad-service` next door - pydantic,
camelCase aliases on the wire, snake_case in Python.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from . import DEFAULT_MAX_CHUNK_TOKENS, HARD_CEILING_TOKENS, MAX_TEXT_CHARS


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class HumanizeRequest(_Model):
    #: Opaque, caller-chosen, and the handle a cancellation refers to. Never
    #: interpreted, never used as a path.
    request_id: str = Field(alias="requestId", min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    #: One mode today. Present so a second one does not need a new endpoint.
    mode: str = Field(default="natural", pattern="^natural$")
    max_chunk_tokens: int = Field(
        alias="maxChunkTokens",
        default=DEFAULT_MAX_CHUNK_TOKENS,
        ge=32,
        le=HARD_CEILING_TOKENS,
    )


class CancelRequest(_Model):
    request_id: str = Field(alias="requestId", min_length=1, max_length=128)


class ChunkCounts(_Model):
    total: int
    rewritten: int
    reverted: int


class PreservationWarning(_Model):
    code: str
    chunk_index: int = Field(alias="chunkIndex")
    #: Categories only. The literals themselves never leave this process.
    kinds: list[str] = Field(default_factory=list)
    count: int = 0


class PreservationReport(_Model):
    passed: bool
    warnings: list[PreservationWarning] = Field(default_factory=list)


class TimingReport(_Model):
    load: int
    inference: int
    total: int


class HumanizeResponse(_Model):
    request_id: str = Field(alias="requestId")
    #: `complete` when the rewrite may be offered; `preservation_failed` when
    #: the document-level gate refused it and the original is returned instead.
    status: str
    model_id: str = Field(alias="modelId")
    model_revision: str = Field(alias="modelRevision")
    device: str
    dtype: str
    original_text: str = Field(alias="originalText")
    rewritten_text: str = Field(alias="rewrittenText")
    chunks: ChunkCounts
    preservation: PreservationReport
    timing_ms: TimingReport = Field(alias="timingMs")


class HealthResponse(_Model):
    #: `ok`, `busy` or `degraded`. A machine that has never downloaded the
    #: checkpoint is `ok` - the service works, it just has nothing to run yet,
    #: which `modelState` says and `status` should not confuse with a fault.
    status: str
    #: `not_installed` | `installed_not_loaded` | `loaded`.
    model_state: str = Field(alias="modelState")
    service_version: str = Field(alias="serviceVersion")
    python_version: str = Field(alias="pythonVersion")
    torch_version: str = Field(alias="torchVersion")
    transformers_version: str = Field(alias="transformersVersion")
    cuda_version: str = Field(alias="cudaVersion")
    model_id: str = Field(alias="modelId")
    model_revision: str = Field(alias="modelRevision")
    device: str
    dtype: str
    model_loaded: bool = Field(alias="modelLoaded")
    model_installed: bool = Field(alias="modelInstalled")
    busy: bool
    detail: str = ""
