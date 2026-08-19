"""Where a document's page vectors live.

The service owns this, not Breadboard, and that is the load-bearing decision in
the whole design. A ColPali page embedding is not one vector — it is one vector
per image patch, on the order of a thousand of them, which is a few hundred
kilobytes per page. Handing those back to the dashboard and receiving them again
on every question would move tens of megabytes per turn over loopback and
serialise them twice. So the pages cross the wire once, at index time, and a
query afterwards carries only an id and a sentence.

The vectors are ragged: pages differ in how many patches they produce. They are
stored flat with an offset table rather than padded, because padding a hundred
pages to the longest one wastes the memory this file exists to bound.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class DocumentIndex:
    """One document's pages, as they came back from the model."""

    document_id: str
    model_id: str
    page_numbers: list[int]
    #: One float16 array per page, shape (patches, dimensions).
    vectors: list[np.ndarray]

    @property
    def dimensions(self) -> int:
        return int(self.vectors[0].shape[1]) if self.vectors else 0


class IndexStore:
    def __init__(self, root: str | os.PathLike[str]) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, document_id: str) -> Path:
        # The caller has already matched document_id against DOCUMENT_ID_PATTERN;
        # `name` here is belt and braces so a future caller cannot walk out of
        # the directory by supplying a path instead of an id.
        return self._root / f"{Path(document_id).name}.npz"

    def exists(self, document_id: str) -> bool:
        return self._path(document_id).is_file()

    def count(self) -> int:
        return sum(1 for _ in self._root.glob("*.npz"))

    def write(
        self,
        document_id: str,
        model_id: str,
        page_numbers: list[int],
        vectors: list[np.ndarray],
    ) -> None:
        if not vectors:
            raise ValueError("an index needs at least one page")
        flat = np.concatenate([page.astype(np.float16, copy=False) for page in vectors], axis=0)
        lengths = [int(page.shape[0]) for page in vectors]
        offsets = np.zeros(len(lengths) + 1, dtype=np.int64)
        np.cumsum(lengths, out=offsets[1:])

        target = self._path(document_id)
        # Written to a temporary name in the same directory and renamed into
        # place, so a service killed mid-index leaves no half-written index that
        # would read back as a complete one.
        handle, temporary = tempfile.mkstemp(dir=self._root, suffix=".tmp")
        os.close(handle)
        try:
            with open(temporary, "wb") as stream:
                np.savez(
                    stream,
                    vectors=flat,
                    offsets=offsets,
                    pages=np.asarray(page_numbers, dtype=np.int32),
                    model=np.asarray(model_id),
                )
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def read(self, document_id: str) -> DocumentIndex | None:
        path = self._path(document_id)
        if not path.is_file():
            return None
        with np.load(path, allow_pickle=False) as archive:
            flat = archive["vectors"]
            offsets = archive["offsets"]
            pages = archive["pages"]
            model_id = str(archive["model"])
        vectors = [flat[offsets[i] : offsets[i + 1]] for i in range(len(pages))]
        return DocumentIndex(
            document_id=document_id,
            model_id=model_id,
            page_numbers=[int(page) for page in pages],
            vectors=vectors,
        )

    def delete(self, document_id: str) -> bool:
        path = self._path(document_id)
        if not path.is_file():
            return False
        path.unlink()
        return True
