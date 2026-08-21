"""Taking a Markdown document apart so the model only ever sees sentences.

The model is a sentence-scale rewriter. Handing it a document would ask it to
reproduce Markdown from memory, and it would fail in the most expensive way
available: plausibly. So the document is disassembled here, deterministically,
and reassembled here, deterministically. The model contributes words to the
middle of that sandwich and nothing else.

Two levels of protection.

*Block* level: frontmatter, code, math, tables, HTML, blockquotes and reference
definitions are lifted out whole and never sent anywhere. Headings and list
items are split into a structural prefix (`## `, `- [ ] `, the indentation) that
is preserved byte-for-byte and a visible remainder that is prose.

*Inline* level: exact spans are replaced by numbered placeholders while text is
packed. Immediately before inference, ordinary numbers, dates, versions and
amounts are exposed again because the checkpoint copies natural literals more
reliably than artificial anchors. Format-sensitive or opaque spans - URLs,
citations, code, quoted passages and identifiers - stay masked. `preservation`
checks both the remaining anchors and the exposed facts after generation; a
chunk that changes either kind is thrown away.

Everything in this module is pure and deterministic. `count_tokens` is injected
rather than imported so the packing can be tested without loading a tokenizer,
and so nothing here ever imports torch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Iterable, Literal

from . import (
    DEFAULT_MAX_CHUNK_TOKENS,
    HARD_CEILING_TOKENS,
    MIN_REWRITABLE_WORDS,
    UNREWRITABLE_LABELS,
)

TokenCounter = Callable[[str], int]

#: Placeholder form, chosen by measurement against the real checkpoint rather
#: than by taste.
#:
#: The obvious `[[P0]]` turned out to be the worst option available: BART's BPE
#: splits the brackets from the digits, and the decoder rewrites them into
#: `[ edit ]`, `p1]]` and `wasP0]]`. Every chunk carrying an inline literal then
#: fails placeholder validation and reverts - safe, but useless, because the
#: sentences holding a citation or a link are exactly the ones worth protecting.
#:
#: Candidates put through the loaded model on one sentence with three
#: placeholders: `[[P0]]` destroyed, `PLACEHOLDER0` destroyed and hallucinated
#: into variants, `Qxa0` destroyed, `#0#` survived but lost punctuation, `zqz0`
#: survived but dropped a word, `XP0X` returned exact and in order. Hence this.
#:
#: A collision with real text is refused rather than escaped - see
#: `protect_inline` - because escaping would need the model to reproduce the
#: escape, which is the assumption this whole module exists to avoid.
PLACEHOLDER_TEMPLATE = "XP{index}X"
PLACEHOLDER_PATTERN = re.compile(r"XP(\d+)X")

#: Breadboard's grounded answers cite sources as `[S1]`, often in adjacent or
#: comma-separated groups. They are citations, not Markdown reference links.
#: Matching the whole group keeps `[S1][S2][S3]` to one model placeholder rather
#: than the destructive `XP0XXP1X[XP2X]` shape produced by the generic patterns.
_SOURCE_CITATION_PATTERN = (
    r"\[[A-Za-z]\d+\](?:(?:,[ \t]*|[ \t]*)\[[A-Za-z]\d+\])*"
)
_SOURCE_LIST_ITEM_RE = re.compile(
    r"^(?:\*\*|__)?" + _SOURCE_CITATION_PATTERN + r"(?:\*\*|__)?[ \t]*:"
)


class ChunkingError(ValueError):
    """Input this module refuses to take apart."""


# ---------------------------------------------------------------------------
# Inline protection
# ---------------------------------------------------------------------------

_MONTHS = (
    "January|February|March|April|May|June|July|August|September|October|"
    "November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec"
)

#: One alternation, applied left to right, so the longest structure at a given
#: position wins and nothing nests inside something already protected. Order
#: matters: a link must be matched before the URL inside it, and a source
#: citation group before the reference-link shape it resembles.
_INLINE_PATTERN_CANDIDATES: tuple[tuple[str, str], ...] = (
    # Code and math first: their contents are literally anything.
    ("code", r"``[^`]+``|`[^`\n]+`"),
    ("math", r"\$[^$\n]{1,200}\$|\\\([^\n]{1,200}?\\\)"),
    # Formatting is structure, not prose. Protect the whole span because this
    # checkpoint has been observed dropping a leading marker, turning a bold
    # fragment heading into decoder debris. The words inside a short emphasized
    # span are less valuable to rewrite than the surrounding sentence.
    ("strong", r"\*\*[^*\n]+\*\*|(?<![\w_])__[^_\n]+__(?![\w_])"),
    ("emphasis", r"(?<![\w*])\*[^*\n]+\*(?!\*)|(?<![\w_])_[^_\n]+_(?![\w_])"),
    # Grounding markers have the same surface shape as reference links when
    # adjacent, so they must win before the generic Markdown link patterns.
    ("citation", _SOURCE_CITATION_PATTERN),
    # Images and links, whole. The label could be rewritten in principle; the
    # destination could not, and splitting them buys a paragraph of risk for a
    # handful of words.
    ("image", r"!\[[^\]\n]*\]\([^)\n]*\)"),
    ("link", r"\[[^\]\n]*\]\([^)\n]*\)"),
    ("reflink", r"\[[^\]\n]*\]\[[^\]\n]*\]"),
    ("footnote", r"\[\^[^\]\s]+\]"),
    ("citation", r"\[@[^\]\s]+\]"),
    ("autolink", r"<https?://[^>\s]+>"),
    ("html", r"</?[A-Za-z][^>\n]{0,200}>"),
    ("url", r"\bhttps?://[^\s<>)\]]+|\bwww\.[^\s<>)\]]+"),
    ("email", r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    # Paths before flags before versions before numbers.
    ("path", r"[A-Za-z]:\\[^\s\"']+|(?:\.{1,2})?/[\w.+-]+(?:/[\w.+-]+)+/?"),
    ("flag", r"(?<![\w-])--?[A-Za-z][\w-]*(?![\w-])"),
    # Python's alternation resolves left to right at a given position rather
    # than by longest match, so anything a version number is a prefix of has to
    # come first: `18.5%` must be a percentage, not the version `18.5`.
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
    ("handle", r"(?<![\w/])@[A-Za-z0-9_]{2,}\b"),
    ("hashtag", r"(?<![\w&])#[A-Za-z][A-Za-z0-9_-]*\b"),
    # Quoted passages. A quotation is somebody else's sentence; rewriting one
    # is a misquote, not a rewrite.
    ("quote", "“[^”\n]{1,400}”|\"[^\"\n]{1,400}\""),
    # Identifiers that contain digits, then any remaining number.
    ("identifier", r"\b(?=[\w-]*\d)[A-Za-z][\w-]*\b"),
    ("number", r"\b\d[\d,]*(?:\.\d+)?\b"),
)

#: These facts remain natural model tokens. The preservation gate recognises
#: every one of these forms and rejects the candidate if its exact multiset
#: changes. Measured on the real checkpoint, this is substantially safer in
#: practice than asking it to copy an opaque placeholder for every number.
_VISIBLE_FACT_KINDS = frozenset({"percent", "currency", "date", "time", "version", "number"})
_INLINE_PATTERNS = _INLINE_PATTERN_CANDIDATES

_INLINE_RE = re.compile(
    "|".join(
        "(?P<{name}_{index}>{pattern})".format(name=name, index=index, pattern=pattern)
        for index, (name, pattern) in enumerate(_INLINE_PATTERNS)
    )
)


@dataclass(frozen=True)
class Protected:
    """One inline fragment lifted out of prose."""

    kind: str
    text: str


def protect_inline(text: str) -> tuple[str, list[Protected]]:
    """Replace inline literals with ordered placeholders.

    Returns the masked text and the fragments in placeholder order. Text that
    already contains something shaped like a placeholder is refused rather than
    escaped: escaping would need the model to reproduce the escape, which is the
    assumption this whole module exists to avoid.
    """
    if PLACEHOLDER_PATTERN.search(text):
        raise ChunkingError("text already contains a humanizer placeholder")

    fragments: list[Protected] = []
    out: list[str] = []
    cursor = 0
    for match in _INLINE_RE.finditer(text):
        group = match.lastgroup or "unknown_0"
        kind = group.rsplit("_", 1)[0]
        out.append(text[cursor : match.start()])
        out.append(PLACEHOLDER_TEMPLATE.format(index=len(fragments)))
        fragments.append(Protected(kind=kind, text=match.group(0)))
        cursor = match.end()
    out.append(text[cursor:])
    return "".join(out), fragments


def expose_checkable_facts(text: str, fragments: list[Protected]) -> str:
    """Restore natural fact literals while opaque fragments remain masked.

    Packing uses uniformly short placeholders, then this function prepares the
    actual model input. The chunk gate compares these visible facts exactly,
    while the placeholders still present protect everything that cannot safely
    be interpreted as ordinary prose.
    """
    return PLACEHOLDER_PATTERN.sub(
        lambda match: (
            fragments[int(match.group(1))].text
            if fragments[int(match.group(1))].kind in _VISIBLE_FACT_KINDS
            else match.group(0)
        ),
        text,
    )


def restore_inline(text: str, fragments: list[Protected]) -> str:
    """Put the fragments back. Assumes `placeholders_intact` already passed."""
    return PLACEHOLDER_PATTERN.sub(lambda match: fragments[int(match.group(1))].text, text)


def placeholder_sequence(text: str) -> list[int]:
    return [int(match.group(1)) for match in PLACEHOLDER_PATTERN.finditer(text)]


def placeholders_intact(original: str, rewritten: str) -> bool:
    """Every placeholder back exactly once, in the same order.

    Order matters as much as presence: `[[P1]] before [[P0]]` would reassemble
    into a sentence that says the opposite of what it read.
    """
    return placeholder_sequence(original) == placeholder_sequence(rewritten)


# ---------------------------------------------------------------------------
# Block segmentation
# ---------------------------------------------------------------------------

SegmentKind = Literal["protected", "prose"]


@dataclass
class Segment:
    """A contiguous span of the source.

    The invariant the whole module rests on: concatenating `source()` over
    every segment reproduces the input byte for byte.
    """

    kind: SegmentKind
    #: Everything before the rewritable words on this segment: a heading's
    #: `## `, a list item's `  - `, the indentation. Empty for protected blocks.
    prefix: str = ""
    #: The rewritable words. Empty for protected blocks.
    body: str = ""
    #: Trailing newlines and any hard-break marker.
    suffix: str = ""
    #: The verbatim text of a protected block.
    raw: str = ""
    #: What kind of structure this is, for diagnostics and document checks.
    label: str = ""
    #: A soft-wrapped paragraph's original lines, and the single-line body they
    #: were joined into. A rewrite legitimately reflows such a paragraph onto
    #: one line, but a paragraph nothing touched must come back exactly as it
    #: was typed - otherwise merely *offering* a rewrite would rewrap the whole
    #: document, and the document-level gate would be comparing against a shape
    #: the reader never saw.
    wrapped_source: str = ""
    joined_body: str = ""

    def source(self) -> str:
        if self.kind == "protected":
            return self.raw
        if self.wrapped_source and self.body == self.joined_body:
            return self.wrapped_source
        return self.prefix + self.body + self.suffix


_FRONTMATTER_RE = re.compile(r"\A---\r?\n.*?\r?\n---[ \t]*\r?\n?", re.DOTALL)
_FENCE_OPEN_RE = re.compile(r"^([ \t]*)(`{3,}|~{3,})(.*)$")
_HEADING_RE = re.compile(r"^([ \t]{0,3}#{1,6}[ \t]+)(.*?)([ \t]*#*[ \t]*)$")
_SETEXT_UNDERLINE_RE = re.compile(r"^[ \t]{0,3}(=+|-{2,})[ \t]*$")
_LIST_RE = re.compile(r"^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)(.*)$")
_LEADING_LIST_LABEL_RE = re.compile(
    r"^((?:\*\*[^*\n]+\*\*|__[^_\n]+__)[ \t]*)(.*)$"
)
_BLOCKQUOTE_RE = re.compile(r"^[ \t]{0,3}>")
_HTML_BLOCK_RE = re.compile(r"^[ \t]{0,3}<[A-Za-z!/?]")
_TABLE_DELIMITER_RE = re.compile(
    r"^[ \t]{0,3}\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$"
)
_REFERENCE_DEFINITION_RE = re.compile(r"^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+")
_INDENTED_CODE_RE = re.compile(r"^(?: {4}|\t)")
_THEMATIC_BREAK_RE = re.compile(
    r"^[ \t]{0,3}(?:\*[ \t]*){3,}$|^[ \t]{0,3}(?:-[ \t]*){3,}$|^[ \t]{0,3}(?:_[ \t]*){3,}$"
)
_MATH_OPEN_RE = re.compile(r"^[ \t]{0,3}(?:\$\$|\\\[)")
_HARD_BREAK_RE = re.compile(r"(?:[ \t]{2,}|\\)$")


def _split_lines(text: str) -> list[str]:
    """Lines with their terminators kept, so joining restores the input."""
    return text.splitlines(keepends=True)


def _line_body(line: str) -> tuple[str, str]:
    """Split a line into its content and its trailing newline."""
    match = re.search(r"(\r?\n)\Z", line)
    if match:
        return line[: match.start()], match.group(1)
    return line, ""


def segment_markdown(text: str) -> list[Segment]:
    """Split Markdown into protected structure and rewritable prose."""
    segments: list[Segment] = []

    frontmatter = _FRONTMATTER_RE.match(text)
    start = 0
    if frontmatter:
        segments.append(Segment(kind="protected", raw=frontmatter.group(0), label="frontmatter"))
        start = frontmatter.end()

    lines = _split_lines(text[start:])
    index = 0
    total = len(lines)

    def protect(count: int, label: str) -> None:
        nonlocal index
        segments.append(
            Segment(kind="protected", raw="".join(lines[index : index + count]), label=label)
        )
        index += count

    while index < total:
        raw = lines[index]
        content, _ = _line_body(raw)
        stripped = content.strip()

        if stripped == "":
            protect(1, "blank")
            continue

        fence = _FENCE_OPEN_RE.match(content)
        if fence:
            marker = fence.group(2)[0] * 3
            span = 1
            while index + span < total:
                candidate, _ = _line_body(lines[index + span])
                span += 1
                if candidate.strip().startswith(marker):
                    break
            protect(span, "fenced_code")
            continue

        if _MATH_OPEN_RE.match(content):
            opener = "$$" if content.lstrip().startswith("$$") else "\\["
            closer = "$$" if opener == "$$" else "\\]"
            closed_on_one_line = (
                content.strip().count("$$") >= 2 if opener == "$$" else closer in content
            )
            span = 1
            if not closed_on_one_line:
                while index + span < total:
                    candidate, _ = _line_body(lines[index + span])
                    span += 1
                    if closer in candidate:
                        break
            protect(span, "math_block")
            continue

        if _INDENTED_CODE_RE.match(content) and _previous_block_allows_indented_code(segments):
            span = 0
            while index + span < total:
                candidate, _ = _line_body(lines[index + span])
                if candidate.strip() != "" and not _INDENTED_CODE_RE.match(candidate):
                    break
                span += 1
            protect(span, "indented_code")
            continue

        if _BLOCKQUOTE_RE.match(content):
            span = 0
            while index + span < total:
                candidate, _ = _line_body(lines[index + span])
                if candidate.strip() == "" or not _BLOCKQUOTE_RE.match(candidate):
                    break
                span += 1
            protect(span, "blockquote")
            continue

        if _HTML_BLOCK_RE.match(content):
            span = 0
            while index + span < total:
                candidate, _ = _line_body(lines[index + span])
                if candidate.strip() == "":
                    break
                span += 1
            protect(span, "html_block")
            continue

        if _REFERENCE_DEFINITION_RE.match(content):
            protect(1, "reference_definition")
            continue

        if _THEMATIC_BREAK_RE.match(content):
            protect(1, "thematic_break")
            continue

        # A table is recognised by its delimiter row, which is on the *second*
        # line. Looking ahead one line is what keeps a header row from being
        # rewritten into something the delimiter no longer describes.
        if "|" in content and index + 1 < total:
            following, _ = _line_body(lines[index + 1])
            if _TABLE_DELIMITER_RE.match(following):
                span = 0
                while index + span < total:
                    candidate, _ = _line_body(lines[index + span])
                    if candidate.strip() == "" or "|" not in candidate:
                        break
                    span += 1
                protect(span, "table")
                continue

        heading = _HEADING_RE.match(content)
        if heading:
            _, newline = _line_body(raw)
            segments.append(
                Segment(
                    kind="prose",
                    prefix=heading.group(1),
                    body=heading.group(2),
                    suffix=heading.group(3) + newline,
                    label="heading",
                )
            )
            index += 1
            continue

        # A setext underline turns the line above it into a heading. That line
        # has already been emitted as a paragraph, so the underline is protected
        # and the paragraph reader below never merges across it.
        if _SETEXT_UNDERLINE_RE.match(content) and segments and segments[-1].kind == "prose":
            protect(1, "setext_underline")
            continue

        listing = _LIST_RE.match(content)
        if listing:
            _, newline = _line_body(raw)
            body = listing.group(2)
            label = "citation_list_item" if _SOURCE_LIST_ITEM_RE.match(body) else "list_item"
            leading_label = _LEADING_LIST_LABEL_RE.match(body)
            preserved_prefix = listing.group(1)
            if leading_label:
                preserved_prefix += leading_label.group(1)
                body = leading_label.group(2)
            segments.append(
                Segment(
                    kind="prose",
                    prefix=preserved_prefix,
                    body=body,
                    suffix=newline,
                    label=label,
                )
            )
            index += 1
            continue

        # Paragraph: consume until a blank line or any line that starts
        # something else.
        span = 0
        while index + span < total:
            candidate, _ = _line_body(lines[index + span])
            if span > 0 and not _continues_paragraph(candidate, lines, index + span, total):
                break
            span += 1
        segments.extend(_paragraph_segments(lines[index : index + span]))
        index += span

    return segments


def _previous_block_allows_indented_code(segments: list[Segment]) -> bool:
    """Four spaces after a list item is continuation, not a code block."""
    for segment in reversed(segments):
        if segment.label == "blank":
            continue
        return segment.label != "list_item"
    return True


def _continues_paragraph(content: str, lines: list[str], position: int, total: int) -> bool:
    if content.strip() == "":
        return False
    if (
        _FENCE_OPEN_RE.match(content)
        or _HEADING_RE.match(content)
        or _LIST_RE.match(content)
        or _BLOCKQUOTE_RE.match(content)
        or _HTML_BLOCK_RE.match(content)
        or _THEMATIC_BREAK_RE.match(content)
        or _MATH_OPEN_RE.match(content)
        or _SETEXT_UNDERLINE_RE.match(content)
        or _REFERENCE_DEFINITION_RE.match(content)
    ):
        return False
    if "|" in content and position + 1 < total:
        following, _ = _line_body(lines[position + 1])
        if _TABLE_DELIMITER_RE.match(following):
            return False
    return True


def _paragraph_segments(raw_lines: list[str]) -> list[Segment]:
    """One prose segment for a soft-wrapped paragraph, one per hard-broken line.

    A soft-wrapped paragraph is one thought that happens to be typed across
    several lines, and rewriting it as a unit is the point. A hard break (two
    trailing spaces, or a backslash) is deliberate layout - an address, a verse
    - so those lines stay separate and keep their own break marker.
    """
    bodies: list[tuple[str, str]] = []
    hard_broken = False
    for raw in raw_lines:
        content, newline = _line_body(raw)
        if _HARD_BREAK_RE.search(content):
            hard_broken = True
        bodies.append((content, newline))

    if hard_broken:
        segments: list[Segment] = []
        for content, newline in bodies:
            match = _HARD_BREAK_RE.search(content)
            break_marker = match.group(0) if match else ""
            visible = content[: len(content) - len(break_marker)]
            leading = len(visible) - len(visible.lstrip())
            segments.append(
                Segment(
                    kind="prose",
                    prefix=visible[:leading],
                    body=visible[leading:],
                    suffix=break_marker + newline,
                    label="paragraph_line",
                )
            )
        return segments

    first, _ = bodies[0]
    leading = len(first) - len(first.lstrip())
    body = " ".join(content.strip() for content, _ in bodies)
    suffix = bodies[-1][1]
    wrapped = "".join(raw_lines) if len(bodies) > 1 else ""
    return [
        Segment(
            kind="prose",
            prefix=first[:leading],
            body=body,
            suffix=suffix,
            label="paragraph",
            wrapped_source=wrapped,
            joined_body=body if wrapped else "",
        )
    ]


def reassemble(segments: Iterable[Segment]) -> str:
    return "".join(segment.source() for segment in segments)


# ---------------------------------------------------------------------------
# Sentence-aware, tokenizer-aware packing
# ---------------------------------------------------------------------------

#: Abbreviations whose full stop does not end a sentence. Short on purpose:
#: numbers, versions and dates are already placeholders by the time this runs,
#: which removes the large majority of false sentence boundaries.
_ABBREVIATIONS = {
    "e.g.",
    "i.e.",
    "etc.",
    "vs.",
    "cf.",
    "al.",
    "Mr.",
    "Mrs.",
    "Ms.",
    "Dr.",
    "Prof.",
    "St.",
    "Fig.",
    "No.",
    "approx.",
}

_SENTENCE_BOUNDARY_RE = re.compile("(?<=[.!?…])([\"'”’)\\]]*)(\\s+)")


def split_sentences(text: str) -> list[tuple[str, str]]:
    """(sentence, trailing whitespace) pairs that rejoin into the input."""
    pieces: list[tuple[str, str]] = []
    cursor = 0
    for match in _SENTENCE_BOUNDARY_RE.finditer(text):
        end = match.start() + len(match.group(1))
        if end <= cursor:
            continue
        candidate = text[cursor:end]
        words = candidate.split()
        if words and words[-1] in _ABBREVIATIONS:
            continue
        pieces.append((candidate, match.group(2)))
        cursor = match.end()
    remainder = text[cursor:]
    if remainder:
        pieces.append((remainder, ""))
    return pieces


@dataclass
class Chunk:
    """One unit of model input, and where it came back to."""

    segment_index: int
    order: int
    text: str
    #: Whitespace that joined this chunk to the next one inside the same
    #: segment. Held here so reassembly never has to guess at spacing.
    separator: str = ""
    fragments: list[Protected] = field(default_factory=list)
    tokens: int = 0


def pack_sentences(
    text: str,
    count_tokens: TokenCounter,
    max_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    hard_ceiling: int = HARD_CEILING_TOKENS,
) -> list[tuple[str, str]]:
    """Greedily pack whole sentences up to the budget.

    Only a sentence that exceeds the hard ceiling on its own is cut, and then on
    a word boundary. Everything else stays whole, because a rewriter handed half
    a clause writes the other half itself.
    """
    if max_tokens <= 0:
        raise ChunkingError("max_tokens must be positive")
    packed: list[tuple[str, str]] = []
    current = ""
    pending_separator = ""

    def flush() -> None:
        nonlocal current, pending_separator
        if current:
            packed.append((current, pending_separator))
        current = ""
        pending_separator = ""

    for sentence, separator in split_sentences(text):
        if count_tokens(sentence) > hard_ceiling:
            flush()
            for piece, piece_separator in _split_long_sentence(sentence, count_tokens, max_tokens):
                packed.append((piece, piece_separator))
            if packed:
                packed[-1] = (packed[-1][0], separator)
            continue

        candidate = current + pending_separator + sentence if current else sentence
        if current and count_tokens(candidate) > max_tokens:
            flush()
            current, pending_separator = sentence, separator
        else:
            current, pending_separator = candidate, separator

    flush()
    return packed


def _split_long_sentence(
    sentence: str, count_tokens: TokenCounter, max_tokens: int
) -> list[tuple[str, str]]:
    words = re.findall(r"\S+\s*", sentence)
    pieces: list[tuple[str, str]] = []
    current = ""
    for word in words:
        candidate = current + word
        if current and count_tokens(candidate) > max_tokens:
            trimmed = current.rstrip()
            pieces.append((trimmed, current[len(trimmed) :]))
            current = word
        else:
            current = candidate
    if current:
        trimmed = current.rstrip()
        pieces.append((trimmed, current[len(trimmed) :]))
    return pieces


def build_chunks(
    segments: list[Segment],
    count_tokens: TokenCounter,
    max_tokens: int = DEFAULT_MAX_CHUNK_TOKENS,
    hard_ceiling: int = HARD_CEILING_TOKENS,
) -> list[Chunk]:
    """Every rewritable chunk in the document, in reading order.

    Chunks never cross a segment boundary: two paragraphs are two thoughts, and
    filling a token budget is not a reason to merge them.
    """
    chunks: list[Chunk] = []
    for segment_index, segment in enumerate(segments):
        if segment.kind != "prose" or not segment.body.strip():
            continue
        if segment.label in UNREWRITABLE_LABELS:
            continue
        masked, fragments = protect_inline(segment.body)
        # Nothing but placeholders and punctuation: there is no prose to
        # rewrite, and sending it would invite the model to invent some.
        visible = PLACEHOLDER_PATTERN.sub("", masked).strip(" \t.,;:!?-—–")
        if not visible:
            continue
        # A fragment rather than a sentence. The gate would revert whatever came
        # back anyway; skipping costs no GPU time and raises no warning about a
        # "failure" that was really a request the model cannot take.
        if len(visible.split()) < MIN_REWRITABLE_WORDS:
            continue
        for order, (text, separator) in enumerate(
            pack_sentences(masked, count_tokens, max_tokens, hard_ceiling)
        ):
            chunks.append(
                Chunk(
                    segment_index=segment_index,
                    order=order,
                    text=text,
                    separator=separator,
                    fragments=fragments,
                    tokens=count_tokens(text),
                )
            )
    return chunks


def apply_chunks(
    segments: list[Segment], chunks: list[Chunk], rewritten: list[str]
) -> list[Segment]:
    """Put rewritten chunk text back into its segments and restore literals."""
    if len(chunks) != len(rewritten):
        raise ChunkingError("chunk and rewrite counts differ")
    by_segment: dict[int, list[tuple[Chunk, str]]] = {}
    for chunk, text in zip(chunks, rewritten):
        by_segment.setdefault(chunk.segment_index, []).append((chunk, text))

    out: list[Segment] = []
    for index, segment in enumerate(segments):
        pairs = by_segment.get(index)
        if not pairs:
            out.append(segment)
            continue
        pairs.sort(key=lambda pair: pair[0].order)
        masked = "".join(text + chunk.separator for chunk, text in pairs)
        body = restore_inline(masked, pairs[0][0].fragments)
        out.append(
            Segment(
                kind="prose",
                prefix=segment.prefix,
                body=body,
                suffix=segment.suffix,
                label=segment.label,
                wrapped_source=segment.wrapped_source,
                joined_body=segment.joined_body,
            )
        )
    return out
