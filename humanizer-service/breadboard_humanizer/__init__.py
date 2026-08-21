"""Breadboard's local text humanizer: a constrained rewriter for its own prose.

Breadboard already knows when something it wrote reads like a machine wrote it
— `dashboard/src/lib/prose-score` gives that a number. What it could not do was
anything about it. This service is the other half: a small seq2seq model that
rewrites generic prose into something less uniform, run entirely on the machine
the text is already on.

Three things shape the whole design.

The model is *not* trusted. It is a 400M-parameter BART trained on short
sentence-length pairs, and asking it to preserve a version number or a URL is a
hope, not a contract. So the document is taken apart deterministically before
the model sees it, only prose is sent, and every rewritten chunk is compared
against the literals the original carried. A chunk that loses one is discarded
and its original kept. Formatting never depends on the model reproducing
Markdown, because the model never sees Markdown.

The weights are not ours to ship. The upstream model card labels itself MIT but
says the designation is a placeholder, so nothing here downloads anything until
a person explicitly asks, and the checkpoint lands in Breadboard's mutable user
data rather than in the repository or the installer.

And the card is 6 GB with ComfyUI on it too. So: load the installed checkpoint
as part of Breadboard startup, run one inference at a time, and use an idle
timer that hands the VRAM back.
"""

from __future__ import annotations

import os

SERVICE_VERSION = "1.0.0"

#: The checkpoint this service loads.
#:
#: A BART-large fine-tune (facebook/bart-large is the base) trained to rewrite
#: AI-flavoured English into something flatter and less uniform. It is a
#: *rewriter*, not a generator: it takes a sentence or two and returns a
#: sentence or two. Everything in `chunking` exists to keep it inside that
#: regime, because handed a whole document it produces confident mush.
DEFAULT_MODEL_ID = "cive202/humanize-ai-text-bart-large"

#: The revision the pin is against.
#:
#: A commit, not `main`: a model repository can be force-pushed, and
#: a rewriter whose behaviour changes underneath a preservation gate is a
#: rewriter whose gate was tuned against something else. This is the commit that
#: was reviewed; see docs/HUMANIZER_INTEGRATION.md for how to move it.
#:
#: Kept overridable through BREADBOARD_HUMANIZER_REVISION so a developer can
#: test a newer revision without editing source.
DEFAULT_MODEL_REVISION = "c74c28e03d3e306c8717d9f85cc18edb7d493299"

#: What goes in front of the input. Empty, by measurement.
#:
#: The integration brief specified `"humanize: "`, a T5-style task prefix. Put
#: through the actual checkpoint it is actively harmful: with the prefix, "The
#: system represents a groundbreaking step forward..." comes back as "Local
#: Knowledge Software and Its Impact on the Local Knowledge Industry Essay
#: (Article) (Article) * Local knowledge software is..." - a title, a bullet
#: list and a truncation. Without it, the same sentence comes back as "The
#: system is a revolutionary step forward in the rapidly evolving world of
#: local knowledge software", which is the rewrite the feature is for.
#:
#: The checkpoint's own config is `facebook/bart-large` with the stock
#: summarization `task_specific_params` untouched, which is consistent with a
#: fine-tune that never learned a prefix. BART fine-tunes generally do not use
#: one; the convention is T5's.
#:
#: Kept configurable so restoring it is one environment variable, not an edit.
MODEL_PREFIX = os.environ.get("BREADBOARD_HUMANIZER_PREFIX", "")

#: Below this many visible words a segment is not sent to the model at all.
#: A three-word fragment is not a sentence, and this checkpoint answers one by
#: inventing a document around it. See `chunking.build_chunks`.
MIN_REWRITABLE_WORDS = 4

#: Segment labels never sent to the model, whatever their length.
#:
#: Headings, measured: "A Pivotal New Chapter" comes back as "Pivotal New
#: Chapter: A New Chapter in American History Essay (Book Review) Essay
#: (Article)". Word count cannot separate that from a short sentence - "The
#: measured improvement was 18.5%" is the same length - but the segment label
#: can, and a heading is the least valuable thing in a document to reword.
UNREWRITABLE_LABELS = frozenset({"heading", "citation_list_item"})

#: Tokens of model input per chunk, measured with the model's own tokenizer.
#:
#: 96 rather than BART's 1024 because the *training* distribution, not the
#: positional limit, is the constraint: the pairs this checkpoint learned from
#: are sentence-scale. Keeping this below the measured size of two dense factual
#: sentences also stops their protected literals from accumulating in one model
#: input. It leaves room for the prefix above without relying on any assumption
#: about where the tokenizer puts a boundary.
DEFAULT_MAX_CHUNK_TOKENS = 96

#: The line past which a chunk is split even mid-sentence. A single sentence
#: longer than this is pathological input (a pasted log line, a table smuggled
#: into a paragraph) and is better cut than sent whole.
HARD_CEILING_TOKENS = 200

#: Ceilings. Every one of these is a refusal rather than a truncation: silently
#: rewriting half a document and returning it as the whole is worse than saying
#: no.
MAX_TEXT_CHARS = 200_000
MAX_REQUEST_BYTES = 1024 * 1024
MAX_CHUNKS = 400

#: How long the weights stay resident after the last rewrite. Five minutes is
#: long enough that reviewing one answer and rewriting the next is warm, short
#: enough that a chat left open overnight is not holding 1.6 GB of VRAM.
DEFAULT_IDLE_UNLOAD_SECONDS = 300.0

#: Wall-clock ceiling for one /humanize call, chunks included.
DEFAULT_TIMEOUT_MS = 120_000

__all__ = [
    "SERVICE_VERSION",
    "DEFAULT_MODEL_ID",
    "DEFAULT_MODEL_REVISION",
    "MODEL_PREFIX",
    "MIN_REWRITABLE_WORDS",
    "UNREWRITABLE_LABELS",
    "DEFAULT_MAX_CHUNK_TOKENS",
    "HARD_CEILING_TOKENS",
    "MAX_TEXT_CHARS",
    "MAX_REQUEST_BYTES",
    "MAX_CHUNKS",
    "DEFAULT_IDLE_UNLOAD_SECONDS",
    "DEFAULT_TIMEOUT_MS",
]
