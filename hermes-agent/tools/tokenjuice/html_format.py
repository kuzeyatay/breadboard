"""HTML → readable text, before line-based compression runs over it.

Raw HTML is the worst ratio of tokens to meaning that reaches a model: script
bodies, inline styles, SVG path data, base64 images, and class-attribute soup
routinely make up 90% of a fetched page. Almost none of it is what the tool
call was for.

Stripping to text is therefore the compression, and the line compressors
handle whatever is left. The extracted text becomes the cached *source*, so
recovering an elided span returns readable text rather than markup — the
header says so, since that is a real change to what "the original" means.
"""

from __future__ import annotations

import html
import re
from typing import Tuple

# Dropped whole, contents included: never prose, always large.
_DISCARD_ELEMENTS = re.compile(
    r"<(script|style|noscript|svg|canvas|template|iframe|head)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_COMMENTS = re.compile(r"<!--.*?-->", re.DOTALL)
# Elements whose boundary is a paragraph break in the extracted text.
_BLOCK = re.compile(
    r"</?(p|div|section|article|header|footer|nav|main|aside|h[1-6]|li|tr|"
    r"table|thead|tbody|ul|ol|dl|dt|dd|blockquote|pre|form|figure|br|hr)\b[^>]*>",
    re.IGNORECASE,
)
_ANY_TAG = re.compile(r"<[^>]{0,4000}>", re.DOTALL)
_ENTITY_WS = re.compile(r"[ \t ]+")
_BLANK_RUN = re.compile(r"\n{3,}")

# A link worth keeping in the text: the href of an anchor with visible text.
_ANCHOR = re.compile(
    r"<a\b[^>]*\bhref\s*=\s*[\"']([^\"'#][^\"']*)[\"'][^>]*>(.*?)</a\s*>",
    re.IGNORECASE | re.DOTALL,
)
_HEADING = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1\s*>", re.IGNORECASE | re.DOTALL)
_TITLE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.IGNORECASE | re.DOTALL)


def _inner_text(fragment: str) -> str:
    return _ENTITY_WS.sub(" ", html.unescape(_ANY_TAG.sub(" ", fragment))).strip()


def extract_text(content: str) -> Tuple[str, int]:
    """Return (readable text, characters of markup removed).

    Headings keep their level as ``##`` markers and links keep their target,
    because those are the two things a model most often needs from a page it
    cannot re-fetch cheaply.
    """
    title_match = _TITLE.search(content)
    title = _inner_text(title_match.group(1)) if title_match else ""

    body = _DISCARD_ELEMENTS.sub(" ", content)
    body = _COMMENTS.sub(" ", body)

    body = _HEADING.sub(
        lambda m: f"\n\n{'#' * int(m.group(1))} {_inner_text(m.group(2))}\n", body
    )
    body = _ANCHOR.sub(
        lambda m: (
            f"[{_inner_text(m.group(2))}]({m.group(1).strip()})"
            if _inner_text(m.group(2))
            else ""
        ),
        body,
    )
    body = _BLOCK.sub("\n", body)
    body = _ANY_TAG.sub(" ", body)

    text = html.unescape(body)
    text = _ENTITY_WS.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = _BLANK_RUN.sub("\n\n", text).strip()

    if title:
        text = f"# {title}\n\n{text}"

    return text, max(0, len(content) - len(text))
