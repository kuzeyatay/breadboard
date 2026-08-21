"""One rewrite, end to end.

    segment -> chunk -> model -> per-chunk gate -> reassemble -> document gate

The model appears exactly once in that list, in the middle, and every step
either side of it is deterministic. That is the whole argument for trusting the
output: not that the model behaved, but that anything it did which mattered was
checked afterwards against the text it was given.

A chunk that fails its gate is silently replaced by its original and counted.
The document failing its gate is different - that means reassembly itself is
suspect, so nothing is offered at all and the caller is told why.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable

from . import DEFAULT_MAX_CHUNK_TOKENS, HARD_CEILING_TOKENS, MAX_CHUNKS
from .chunking import (
    ChunkingError,
    apply_chunks,
    build_chunks,
    expose_checkable_facts,
    reassemble,
    segment_markdown,
)
from .model import Humanizer, ModelError
from .preservation import Warning_, check_chunk, check_document


class PipelineError(RuntimeError):
    """Input or state this pipeline refuses to run on."""


class CancelledError(PipelineError):
    """The caller went away between chunks."""


@dataclass
class HumanizeResult:
    original_text: str
    rewritten_text: str
    total_chunks: int = 0
    rewritten_chunks: int = 0
    reverted_chunks: int = 0
    preservation_passed: bool = True
    warnings: list[Warning_] = field(default_factory=list)
    inference_ms: int = 0


def _restore_terminal_marker(original: str, rewritten: str) -> str:
    """Repair the model's harmless habit of dropping the final punctuation.

    Internal sentence boundaries are still checked below. This only restores
    the marker at the chunk edge, where its value and position are known from
    the source rather than guessed from generated text.
    """
    before = original.rstrip()
    after = rewritten.rstrip()
    if not before or not after:
        return rewritten
    marker = before[-1]
    if marker in ".!?:" and after[-1] not in ".!?:":
        return after + marker
    return rewritten


def humanize(
    text: str,
    model: Humanizer,
    max_chunk_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    hard_ceiling: int = HARD_CEILING_TOKENS,
    should_cancel: Callable[[], bool] | None = None,
) -> HumanizeResult:
    """Rewrite the prose in `text`, leaving everything else exactly as it was."""
    try:
        segments = segment_markdown(text)
        chunks = build_chunks(segments, model.count_tokens, max_chunk_tokens, hard_ceiling)
    except ChunkingError as error:
        raise PipelineError(str(error)) from error

    if not chunks:
        return HumanizeResult(original_text=text, rewritten_text=text, preservation_passed=True)
    if len(chunks) > MAX_CHUNKS:
        raise PipelineError(
            "the text produced " + str(len(chunks)) + " chunks, over the limit of " + str(MAX_CHUNKS)
        )

    model_inputs = [
        expose_checkable_facts(chunk.text, chunk.fragments) for chunk in chunks
    ]

    started = time.monotonic()
    try:
        generated = model.rewrite(model_inputs, should_cancel)
    except ModelError as error:
        if str(error) == "cancelled":
            raise CancelledError("cancelled") from error
        raise
    inference_ms = int((time.monotonic() - started) * 1000)

    if len(generated) != len(chunks):
        raise PipelineError("the model returned a different number of chunks than it was given")

    warnings: list[Warning_] = []
    accepted: list[str] = []
    reverted = 0
    for index, (chunk, model_input, candidate) in enumerate(
        zip(chunks, model_inputs, generated)
    ):
        candidate = _restore_terminal_marker(model_input, candidate)
        problems = check_chunk(model_input, candidate, index)
        if problems:
            warnings.extend(problems)
            accepted.append(chunk.text)
            reverted += 1
        else:
            accepted.append(candidate)

    rewritten = reassemble(apply_chunks(segments, chunks, accepted))

    document_problems = check_document(text, rewritten)
    if document_problems:
        # Reassembly itself is in doubt. Offering the text anyway would put the
        # burden of spotting a dropped block on a reader looking at a diff.
        return HumanizeResult(
            original_text=text,
            rewritten_text=text,
            total_chunks=len(chunks),
            rewritten_chunks=0,
            reverted_chunks=len(chunks),
            preservation_passed=False,
            warnings=warnings + document_problems,
            inference_ms=inference_ms,
        )

    return HumanizeResult(
        original_text=text,
        rewritten_text=rewritten,
        total_chunks=len(chunks),
        rewritten_chunks=len(chunks) - reverted,
        reverted_chunks=reverted,
        preservation_passed=True,
        warnings=warnings,
        inference_ms=inference_ms,
    )
