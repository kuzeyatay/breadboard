"""The acceptance fixture, in one place so every layer checks the same text."""

from __future__ import annotations

ACCEPTANCE_MARKDOWN = """---
title: Release notes
version: 2.4
---

# A Pivotal New Chapter

The system represents a groundbreaking and transformative step forward in the rapidly evolving landscape of local knowledge software.

Version 2.4 shipped on August 19, 2026. Read the [release report](https://example.com/releases/2.4).

Run `npm run build` before publishing.

> "Do not alter this quoted statement."

The measured improvement was 18.5%.
"""

#: Everything that must come back byte-for-byte identical.
ACCEPTANCE_INVARIANTS = (
    "---\ntitle: Release notes\nversion: 2.4\n---\n",
    "# ",
    "2.4",
    "August 19, 2026",
    "https://example.com/releases/2.4",
    "`npm run build`",
    '> "Do not alter this quoted statement."',
    "18.5%",
)

#: The sentence the model is expected to actually change.
ACCEPTANCE_GENERIC_PROSE = (
    "The system represents a groundbreaking and transformative step forward in the "
    "rapidly evolving landscape of local knowledge software."
)
