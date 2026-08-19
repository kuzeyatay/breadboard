"""Breadboard's local ColPali service: visual page retrieval over attachments.

Text retrieval reads a document the way the extractor left it — a flattened
string, with the chart gone, the table turned into a run-on sentence, and the
figure never mentioned. ColPali does not read the text at all. It embeds the
*picture* of each page and the query into the same space and scores them with
late interaction, so the page it returns is the one that looks like an answer.
That is the whole reason this service exists: the pages it finds are the ones
text search cannot.
"""

from __future__ import annotations

SERVICE_VERSION = "1.0.0"

#: The checkpoint this service loads.
#:
#: colSmol-500M rather than the flagship colpali-v1.3 for one hard reason: the
#: machine this runs on has 6 GB of VRAM and ComfyUI wants it too. colSmol is
#: ~1 GB in bfloat16 and scores 82.3 on ViDoRe against the flagship's 84.8 —
#: two and a half points for four fifths of the card. It is also SmolVLM-based,
#: so it carries Apache 2.0 rather than the Gemma licence.
#:
#: The class is ColIdefics3, NOT "ColSmol". SmolVLM is Idefics3-architecture and
#: colpali-engine exports no class by that name, whatever the README implies.
DEFAULT_MODEL_ID = "vidore/colSmol-500M"

#: Pages embedded per forward pass. Small on purpose: a batch of eight 1200px
#: pages is where a 6 GB card starts swapping, and the indexing runs in the
#: background where latency costs nothing.
DEFAULT_BATCH_SIZE = 2

#: The most pages one document may contribute to an index. A textbook is a
#: legitimate attachment and its embeddings are hundreds of megabytes; this is
#: the line past which a document is indexed in part and said to be.
MAX_INDEXED_PAGES = 300

__all__ = [
    "SERVICE_VERSION",
    "DEFAULT_MODEL_ID",
    "DEFAULT_BATCH_SIZE",
    "MAX_INDEXED_PAGES",
]
