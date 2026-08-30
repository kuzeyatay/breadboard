"""Format detection for tool output.

Cheap, signature-based, and biased toward ``text`` — the generic compressor
is safe on anything, while a wrong specific guess (treating prose as a diff)
throws away lines it shouldn't. So a specific format has to earn it.

The tool name is a hint, not an answer: ``search_files`` returns grep hits on
one call and a plain message on the next, so the content always gets a vote.
"""

from __future__ import annotations

import json
import re
from typing import Optional

JSON = "json"
DIFF = "diff"
HTML = "html"
CODE = "code"
LOGS = "logs"
SEARCH = "search"
TEXT = "text"

ALL_FORMATS = (JSON, DIFF, HTML, CODE, LOGS, SEARCH, TEXT)

# How much of the head we sniff. Enough to see structure, small enough that
# detection stays free on a 40 MB log.
_SNIFF_CHARS = 16_000

_DIFF_HEAD = re.compile(r"^(diff --git |Index: |--- |\+\+\+ |@@ )", re.MULTILINE)
_DIFF_HUNK = re.compile(r"^@@ -\d+(,\d+)? \+\d+(,\d+)? @@", re.MULTILINE)
_HTML_DOCTYPE = re.compile(r"^\s*<(!doctype html|html\b|\?xml)", re.IGNORECASE)
_HTML_TAG = re.compile(r"</?(div|span|p|a|body|head|table|tr|td|li|ul|script|style)\b", re.IGNORECASE)

_LOG_LEVEL = re.compile(
    r"\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|SEVERE|CRITICAL|FATAL|PANIC)\b"
)
_LOG_TIMESTAMP = re.compile(
    r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})"      # ISO-ish
    r"|(^\[?\d{2}:\d{2}:\d{2}[.,]?\d*\]?)"            # bare clock
    r"|(^[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2})"   # syslog
)

_CODE_DECL = re.compile(
    r"^\s*("
    r"(async\s+)?def\s+\w+"                    # python
    r"|class\s+\w+"
    r"|(export\s+)?(default\s+)?(async\s+)?function\s+\w+"
    r"|(export\s+)?(const|let|var)\s+\w+\s*="
    r"|(pub\s+)?(async\s+)?fn\s+\w+"           # rust
    r"|(public|private|protected|static|final)[\w\s<>,\[\]]*\(" # java/c#
    r"|(import|from|use|require|#include|package)\b"
    r"|(interface|struct|impl|trait|enum|type)\s+\w+"
    r")"
)

_CODE_CONTROL = re.compile(
    r"^\s*(return|if|elif|else|for|while|switch|case|break|continue|try|catch|"
    r"except|finally|raise|throw|yield|await|match|with|assert|goto|pass|"
    r"import|from|def|class|global|del)\b"
)
# A line that ends the way a statement or a block does, rather than the way a
# sentence does.
_CODE_PUNCT = re.compile(r"[{};]\s*$|^\s*[)}\]]+[,;]?\s*$|:\s*$")
_CODE_ASSIGN = re.compile(r"^\s*[\w.\[\]\"']+\s*(=|:=|\+=|-=|\|=)\s*\S")
_CODE_CALL = re.compile(r"\w+\s*\(")

# A grep/ripgrep hit: path, separator, line number, separator, text.
_GREP_HIT = re.compile(r"^\s*[^\s:]+[:\-]\d+[:\-]")
# A ranked web result: "1. Title" / "## Title" followed by a bare URL.
_URL_LINE = re.compile(r"^\s*(https?://\S+|URL:\s*https?://\S+)", re.IGNORECASE)
_RESULT_HEAD = re.compile(r"^\s*(\[?\d{1,3}[.)\]]\s+\S|#{1,4}\s+\S|Title:\s*\S)", re.IGNORECASE)

# Tool names whose output has a reliable shape regardless of content.
_TOOL_HINTS = {
    "web_search": SEARCH,
    "web_fetch": HTML,
    "fetch_url": HTML,
    "search_files": SEARCH,
    "grep": SEARCH,
    "x_search": SEARCH,
    "image_search": JSON,
    "terminal_execute_command": LOGS,
    "execute_command": LOGS,
    "run_command": LOGS,
    "bash": LOGS,
}


def _ratio(matches: int, total: int) -> float:
    return (matches / total) if total else 0.0


def detect_format(content: str, tool_name: Optional[str] = None) -> str:
    """Return one of :data:`ALL_FORMATS` for *content*.

    Never raises; the worst case is :data:`TEXT`, which every input tolerates.
    """
    try:
        return _detect(content, tool_name)
    except Exception:
        return TEXT


def _detect(content: str, tool_name: Optional[str]) -> str:
    head = content[:_SNIFF_CHARS]
    stripped = head.lstrip()
    if not stripped:
        return TEXT

    # JSON is the one format we can confirm rather than guess, so it goes
    # first and a successful parse beats every other signal.
    if stripped[0] in "[{":
        try:
            json.loads(content)
            return JSON
        except (ValueError, RecursionError):
            pass

    if _HTML_DOCTYPE.match(stripped) or len(_HTML_TAG.findall(head)) >= 8:
        return HTML

    if _DIFF_HUNK.search(head) and _DIFF_HEAD.search(head):
        return DIFF

    lines = [line for line in head.splitlines() if line.strip()]
    if not lines:
        return TEXT
    sample = lines[:400]
    n = len(sample)

    log_hits = sum(
        1 for line in sample if _LOG_TIMESTAMP.search(line) or _LOG_LEVEL.search(line)
    )
    if _ratio(log_hits, n) >= 0.30:
        return LOGS

    grep_hits = sum(1 for line in sample if _GREP_HIT.match(line))
    if _ratio(grep_hits, n) >= 0.40:
        return SEARCH

    url_hits = sum(1 for line in sample if _URL_LINE.match(line))
    head_hits = sum(1 for line in sample if _RESULT_HEAD.match(line))
    if url_hits >= 3 and head_hits >= 3:
        return SEARCH

    # Declarations alone are too sparse a signal — a 30-line function body
    # per `def` puts the ratio at 3%, well under any threshold that prose
    # would not also clear. Control flow and line-terminating punctuation are
    # what actually separate code from prose, so they carry the vote and
    # declarations only have to confirm it.
    code_hits = sum(1 for line in sample if _CODE_DECL.match(line))
    codeish = sum(
        1
        for line in sample
        if _CODE_CONTROL.search(line)
        or _CODE_PUNCT.search(line)
        or _CODE_ASSIGN.match(line)
        or _CODE_CALL.search(line)
    )
    if code_hits >= 3 and _ratio(codeish, n) >= 0.45:
        return CODE

    hinted = _TOOL_HINTS.get((tool_name or "").strip().lower())
    if hinted is not None and hinted != JSON:
        # The hint breaks ties the content couldn't; it never overrides a
        # positive content signal above, and never claims JSON, which only a
        # successful parse may claim.
        return hinted

    return TEXT
