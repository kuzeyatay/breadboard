"""TokenJuice — format-aware compression of tool output, with recovery.

Tools return more than a model needs to read. A 400 KB JSON response, a
9,000-line build log, a fetched page that is 90% markup: today each of those
either floods the context window or gets cut at a fixed character count,
which loses the end of the log and leaves the JSON unparseable.

This package compresses instead of truncating. It works out what shape the
output is, drops the parts of that shape that repeat, and marks each drop with
a count and a handle. The full text goes to a local cache, so anything elided
can be recovered exactly with one tool call rather than by re-running the tool.

Entry points:

``compress``   the stage itself; returns ``None`` to mean "carry on as before"
``expand``     ranged retrieval of an elided span or any line window
``summary``    what compression has saved so far, for reporting

The design follows OpenHuman's TokenJuice (tinyhumansai/openhuman), which
keeps the compression engine behind a module boundary and leaves policy,
persistence and pricing to the host. This is an independent implementation of
that split for Hermes; no OpenHuman code is used.
"""

from tools.tokenjuice.engine import Compressed, compress
from tools.tokenjuice.expand import expand
from tools.tokenjuice.savings import summary

__all__ = ["Compressed", "compress", "expand", "summary"]
