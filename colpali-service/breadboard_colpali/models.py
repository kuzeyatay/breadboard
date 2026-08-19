"""Request and response shapes, validated at the edge.

The only caller is Breadboard's own server over loopback, but the payloads carry
a document id that becomes a filename, so validation here is a boundary and not
a formality.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: The blob ids Breadboard mints for attached documents — `doc_` and 32 hex
#: characters, from `isDocumentBlobId` on the TypeScript side. Anything else is
#: refused before it can reach a path: this value names a file in the index
#: directory, so `..` must never survive the trip.
DOCUMENT_ID_PATTERN = re.compile(r"^doc_[0-9a-f]{32}$")


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class PageImage(_Model):
    page_number: int = Field(alias="pageNumber", ge=1)
    #: A rendered page, PNG or JPEG, base64 without a data-URL prefix.
    image_base64: str = Field(alias="imageBase64", min_length=1)


class IndexRequest(_Model):
    document_id: str = Field(alias="documentId")
    pages: list[PageImage] = Field(min_length=1)

    @field_validator("document_id")
    @classmethod
    def _check_document_id(cls, value: str) -> str:
        if not DOCUMENT_ID_PATTERN.match(value):
            raise ValueError("documentId must be a Breadboard document blob id")
        return value


class IndexResponse(_Model):
    document_id: str = Field(alias="documentId")
    #: Pages actually embedded, which is fewer than were sent when the document
    #: ran past MAX_INDEXED_PAGES.
    pages: int
    dimensions: int
    model_id: str = Field(alias="modelId")
    truncated: bool


class SearchRequest(_Model):
    document_id: str = Field(alias="documentId")
    query: str = Field(min_length=1, max_length=4_000)
    top_k: int = Field(alias="topK", default=6, ge=1, le=50)

    @field_validator("document_id")
    @classmethod
    def _check_document_id(cls, value: str) -> str:
        if not DOCUMENT_ID_PATTERN.match(value):
            raise ValueError("documentId must be a Breadboard document blob id")
        return value


class ScoredPage(_Model):
    page_number: int = Field(alias="pageNumber")
    score: float


class SearchResponse(_Model):
    document_id: str = Field(alias="documentId")
    model_id: str = Field(alias="modelId")
    pages: list[ScoredPage]


class HealthResponse(_Model):
    status: str
    service_version: str = Field(alias="serviceVersion")
    python_version: str = Field(alias="pythonVersion")
    torch_version: str = Field(alias="torchVersion")
    cuda_version: str = Field(alias="cudaVersion")
    model_id: str = Field(alias="modelId")
    device: str
    dtype: str
    #: True while the weights are resident. A loaded model is the difference
    #: between a 40 ms query and a 20 s one, and it is also 1 GB of someone
    #: else's VRAM, so the state is worth reporting rather than guessing at.
    model_loaded: bool = Field(alias="modelLoaded")
    indexed_documents: int = Field(alias="indexedDocuments")
    detail: str = ""
