"""The gate that treats the model's output as untrusted.

"Preserve the meaning" is not something a 400M-parameter rewriter promises and
not something a service can take on faith. What it can do is check, cheaply and
deterministically, that the things a reader would be misled by have not moved:
numbers, dates, versions, links, citations, quotations, the placeholders that
stand in for all of those, and the Markdown structure around them.

The rule when a check fails is always the same and never clever: keep the
original. There is no repair path here on purpose - guessing what the model
meant by changing 18.5% to 18% is how a rewriter becomes a fabricator.

Two levels, matching `chunking`. Chunk level runs on selectively masked text:
opaque spans are placeholders, while ordinary numeric facts remain visible and
are compared before and after generation. Document level runs on the finished
text, where the placeholders are gone, and compares the real multiset end to
end.

Warnings never carry the text they are about. They name a category and a count,
which is what a reader needs to decide whether to accept a rewrite, and nothing
that would put user content into a log line if one were ever written.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

from .chunking import (
    PLACEHOLDER_PATTERN,
    Segment,
    placeholder_sequence,
    segment_markdown,
)

#: A rewrite may compress or expand, but not by this much. A chunk that came
#: back at a third of its length dropped a clause; one that came back at twice
#: its length invented one.
MIN_LENGTH_RATIO = 0.5
MAX_LENGTH_RATIO = 1.8

_MONTHS = (
    "January|February|March|April|May|June|July|August|September|October|"
    "November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec"
)

#: What counts as a critical literal. Deliberately broader than the inline
#: protector: this side is looking for things the model *added*, so it must
#: recognise a number even in a shape the protector would never have produced.
_LITERAL_PATTERNS: tuple[tuple[str, str], ...] = (
    ("url", r"\bhttps?://[^\s<>)\]]+|\bwww\.[^\s<>)\]]+"),
    ("email", r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    ("path", r"[A-Za-z]:\\[^\s\"']+|(?:\.{1,2})?/[\w.+-]+(?:/[\w.+-]+)+/?"),
    ("flag", r"(?<![\w-])--?[A-Za-z][\w-]*(?![\w-])"),
    ("percent", r"\b\d+(?:\.\d+)?\s?%"),
    (
        "currency",
        "[$€£¥]\\s?\\d[\\d,]*(?:\\.\\d+)?"
        r"|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|JPY|TRY)\b",
    ),
    ("date", r"\b(?:" + _MONTHS + r")\s+\d{1,2},?\s+\d{4}\b"),
    ("date", r"\b\d{1,2}\s+(?:" + _MONTHS + r")\s+\d{4}\b"),
    ("date", r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
    ("time", r"\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?"),
    ("version", r"\bv?\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)?\b"),
    ("citation", r"\[@[^\]\s]+\]"),
    ("footnote", r"\[\^[^\]\s]+\]"),
    ("handle", r"(?<![\w/])@[A-Za-z0-9_]{2,}\b"),
    ("hashtag", r"(?<![\w&])#[A-Za-z][A-Za-z0-9_-]*\b"),
    ("measurement", r"\b\d[\d,]*(?:\.\d+)?\s?(?:ms|s|m|km|cm|mm|kg|g|MB|GB|TB|KB|Hz|kHz|GHz|px|%)\b"),
    ("acronym", r"\b[A-Z]{2,}(?:s)?\b"),
    ("quote", "“[^”\n]{1,400}”|\"[^\"\n]{1,400}\""),
    ("number", r"\b\d[\d,]*(?:\.\d+)?\b"),
)

_LITERAL_RE = re.compile(
    "|".join(
        "(?P<{name}_{index}>{pattern})".format(name=name, index=index, pattern=pattern)
        for index, (name, pattern) in enumerate(_LITERAL_PATTERNS)
    )
)

#: Two or more capitalised words in a row, not at the start of a sentence.
#: Conservative on purpose: "The System" opening a sentence is grammar, while
#: "Release Candidate Two" in the middle of one is a name.
_PROPER_NAME_RE = re.compile(r"(?<=[a-z,;:] )([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)")

#: Control characters that have no business in prose. Tab and newline are fine.
_BAD_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|�")


def critical_literals(text: str) -> Counter[str]:
    """The multiset of things that must survive a rewrite unchanged.

    Keys are `kind:value`, so a number turning into a date is a change rather
    than a coincidence of spelling.
    """
    counts: Counter[str] = Counter()
    for match in _LITERAL_RE.finditer(text):
        group = match.lastgroup or "unknown_0"
        kind = group.rsplit("_", 1)[0]
        counts[kind + ":" + match.group(0).strip()] += 1
    for match in _PROPER_NAME_RE.finditer(text):
        counts["name:" + match.group(1)] += 1
    return counts


def literal_kinds(keys: list[str]) -> list[str]:
    """Category names only. Warnings must never carry the values themselves."""
    return sorted({key.split(":", 1)[0] for key in keys})


@dataclass
class Warning_:
    """One reason a rewrite was refused, safe to show and safe to log."""

    code: str
    #: Which chunk, or -1 for a document-level finding.
    chunk_index: int = -1
    #: Categories involved, never the literals themselves.
    kinds: list[str] = field(default_factory=list)
    count: int = 0

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "chunkIndex": self.chunk_index,
            "kinds": self.kinds,
            "count": self.count,
        }


def _repeats_itself(text: str) -> bool:
    """A degenerate generation: the same clause emitted twice in a row.

    Beam search on a short input does this when the model has nothing to say.
    Whole-sentence repetition is the common shape; a long repeated tail is the
    other, and both are caught by comparing normalised halves of the output.
    """
    sentences = [part.strip().lower() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    if len(sentences) > 1 and len(set(sentences)) < len(sentences):
        return True
    words = text.split()
    if len(words) >= 12:
        for size in range(4, min(12, len(words) // 2) + 1):
            tail = words[-size:]
            if words[-2 * size : -size] == tail:
                return True
    return False


def _stutters(original: str, rewritten: str) -> bool:
    """A word repeated back-to-back that was not repeated in the original.

    The checkpoint's characteristic small failure, seen on the very first real
    sentence put through it: "a groundbreaking and transformative step" came
    back as "a revolutionary and revolutionary step". No n-gram is repeated, so
    `no_repeat_ngram_size` cannot see it and neither can the block above - but a
    reader sees it immediately, and it is not something the original said.
    """
    tokens = re.findall(r"[A-Za-z']{3,}", rewritten.lower())
    before = re.findall(r"[A-Za-z']{3,}", original.lower())
    original_pairs = {(before[index], before[index + 1]) for index in range(len(before) - 1)}
    for index in range(len(tokens) - 1):
        pair = (tokens[index], tokens[index + 1])
        if pair[0] == pair[1] and pair not in original_pairs:
            return True
    # "revolutionary and revolutionary": the same word either side of a short
    # connective, which reads exactly as badly.
    for index in range(len(tokens) - 2):
        if (
            tokens[index] == tokens[index + 2]
            and tokens[index + 1] in {"and", "or", "yet", "but"}
            and (tokens[index], tokens[index + 2]) not in original_pairs
            and before[index : index + 3] != tokens[index : index + 3]
        ):
            return True
    return False


def _loses_sentence_boundaries(original: str, rewritten: str) -> bool:
    """Sentences fused together, or a closing full stop dropped.

    Also found by putting the acceptance fixture through the real model:
    "Version 2.4 shipped on August 19, 2026. Read the [release report](...)."
    came back as "2.4 shipped on August 19, 2026 Read the [release report](...)"
    - every literal intact, every placeholder home, and two sentences run into
    one. No other check here can see that, because nothing was added, removed or
    altered except the punctuation holding the sentences apart.
    """
    def terminators(text: str) -> int:
        return len(re.findall(r"[.!?]", PLACEHOLDER_PATTERN.sub(" ", text)))

    if terminators(rewritten) < terminators(original):
        return True
    # A chunk that ended a sentence must still end one.
    stripped_original = PLACEHOLDER_PATTERN.sub(" ", original).rstrip()
    stripped_rewritten = PLACEHOLDER_PATTERN.sub(" ", rewritten).rstrip()
    if stripped_original.endswith((".", "!", "?", ":")) and not stripped_rewritten.endswith(
        (".", "!", "?", ":")
    ):
        return True
    return False


def _looks_truncated_at_start(original: str, rewritten: str) -> bool:
    """A sentence that suddenly begins mid-word.

    The real checkpoint produced ``ehens are composite organisms`` from
    ``Lichens are composite organisms``. Literal and length checks both pass,
    but a sentence that started with an uppercase word cannot legitimately
    begin with a lowercase token after rewriting.
    """
    before = re.search(r"[^\W\d_]+", PLACEHOLDER_PATTERN.sub(" ", original), re.UNICODE)
    after = re.search(r"[^\W\d_]+", PLACEHOLDER_PATTERN.sub(" ", rewritten), re.UNICODE)
    if before is None or after is None:
        return False
    return before.group(0)[0].isupper() and after.group(0)[0].islower()


def _introduces_structure(original: str, rewritten: str) -> bool:
    """Markdown the model added on its own initiative.

    Chunks are always inside a single block, so a newline is structure too: a
    rewrite that split a paragraph in half would reassemble into two paragraphs
    with the second one's prefix missing.
    """
    if "\n" in rewritten or "\r" in rewritten:
        return True
    for marker in ("```", "|", "](", "![", "<", ">"):
        if rewritten.count(marker) > original.count(marker):
            return True
    if re.match(r"^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)", rewritten) and not re.match(
        r"^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)", original
    ):
        return True
    return False


def _invalid_unicode(text: str) -> bool:
    if _BAD_CONTROL_RE.search(text):
        return True
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        return True
    return any(unicodedata.category(character) == "Cs" for character in text)


def check_chunk(original: str, rewritten: str, chunk_index: int) -> list[Warning_]:
    """Everything that would make this rewrite unsafe to keep.

    An empty list means the chunk may be used. Anything else and the caller
    keeps the original - see `pipeline`.
    """
    warnings: list[Warning_] = []
    stripped = rewritten.strip()

    if not stripped:
        return [Warning_(code="empty_rewrite", chunk_index=chunk_index)]

    if placeholder_sequence(original) != placeholder_sequence(rewritten):
        warnings.append(
            Warning_(
                code="placeholder_lost",
                chunk_index=chunk_index,
                count=abs(len(placeholder_sequence(original)) - len(placeholder_sequence(rewritten))),
            )
        )

    baseline = max(1, len(original.strip()))
    ratio = len(stripped) / baseline
    if ratio < MIN_LENGTH_RATIO or ratio > MAX_LENGTH_RATIO:
        warnings.append(Warning_(code="length_out_of_bounds", chunk_index=chunk_index))

    if _repeats_itself(rewritten) or _stutters(original, rewritten):
        warnings.append(Warning_(code="repeated_text", chunk_index=chunk_index))

    if _invalid_unicode(rewritten):
        warnings.append(Warning_(code="invalid_unicode", chunk_index=chunk_index))

    if _introduces_structure(original, rewritten):
        warnings.append(Warning_(code="structure_changed", chunk_index=chunk_index))

    if _loses_sentence_boundaries(original, rewritten):
        warnings.append(Warning_(code="sentence_boundary_lost", chunk_index=chunk_index))

    if _looks_truncated_at_start(original, rewritten):
        warnings.append(Warning_(code="truncated_word", chunk_index=chunk_index))

    before = critical_literals(PLACEHOLDER_PATTERN.sub(" ", original))
    after = critical_literals(PLACEHOLDER_PATTERN.sub(" ", rewritten))
    missing = before - after
    invented = after - before
    if missing:
        warnings.append(
            Warning_(
                code="literal_removed",
                chunk_index=chunk_index,
                kinds=literal_kinds(list(missing)),
                count=sum(missing.values()),
            )
        )
    if invented:
        warnings.append(
            Warning_(
                code="literal_invented",
                chunk_index=chunk_index,
                kinds=literal_kinds(list(invented)),
                count=sum(invented.values()),
            )
        )

    return warnings


def _structure_fingerprint(segments: list[Segment]) -> list[tuple[str, str, str]]:
    """What must be identical between the original and the rewrite.

    Protected blocks are compared by hash rather than by content so a mismatch
    can be reported without the reporter ever holding the block.
    """
    fingerprint: list[tuple[str, str, str]] = []
    for segment in segments:
        if segment.kind == "protected":
            digest = hashlib.sha256(segment.raw.encode("utf-8")).hexdigest()[:16]
            fingerprint.append(("protected", segment.label, digest))
        else:
            fingerprint.append(("prose", segment.label, segment.prefix + "|" + segment.suffix))
    return fingerprint


def check_document(original: str, rewritten: str) -> list[Warning_]:
    """The second gate, over the reassembled document.

    Chunk checks can all pass and the document still be wrong - a segment
    dropped during reassembly, a protected block clipped by an off-by-one. This
    is the check that makes the difference between "every part looked fine" and
    "the whole is intact".
    """
    warnings: list[Warning_] = []

    before_segments = segment_markdown(original)
    after_segments = segment_markdown(rewritten)
    before_shape = _structure_fingerprint(before_segments)
    after_shape = _structure_fingerprint(after_segments)
    if before_shape != after_shape:
        differences = sum(
            1
            for index in range(max(len(before_shape), len(after_shape)))
            if before_shape[index : index + 1] != after_shape[index : index + 1]
        )
        warnings.append(
            Warning_(code="document_structure_changed", count=differences)
        )

    before = critical_literals(original)
    after = critical_literals(rewritten)
    missing = before - after
    invented = after - before
    if missing:
        warnings.append(
            Warning_(
                code="document_literal_removed",
                kinds=literal_kinds(list(missing)),
                count=sum(missing.values()),
            )
        )
    if invented:
        warnings.append(
            Warning_(
                code="document_literal_invented",
                kinds=literal_kinds(list(invented)),
                count=sum(invented.values()),
            )
        )

    if PLACEHOLDER_PATTERN.search(rewritten):
        warnings.append(
            Warning_(
                code="unresolved_placeholder",
                count=len(placeholder_sequence(rewritten)),
            )
        )

    if _invalid_unicode(rewritten):
        warnings.append(Warning_(code="invalid_unicode"))

    return warnings
