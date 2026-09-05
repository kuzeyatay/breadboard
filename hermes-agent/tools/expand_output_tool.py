"""The ``expand_output`` tool — recovery for compressed tool results.

Compression is only honest if the model can get the dropped text back, so
this tool ships with it rather than as an optional extra. It reads the local
TokenJuice cache and never re-runs the tool that produced the output, which
means recovering a span costs nothing beyond the tokens it returns and works
even when the original command was expensive, slow, or no longer repeatable.
"""

from __future__ import annotations

from typing import Any

from tools.registry import registry

# Registered as a bare function schema: the registry adds the OpenAI
# {"type": "function", "function": ...} envelope itself, and a schema handed
# over already wrapped ends up wrapped twice, which Gemini rejects.
EXPAND_OUTPUT_SCHEMA = {
        "name": "expand_output",
        "description": (
            "Recover text that was elided from a compressed tool result. "
            "Compressed results start with a <juiced ... handle=\"...\"> header and "
            "contain [[juice:xxxxxx#N · what was dropped]] markers. Pass the handle "
            "from the header with either span=N to restore one marked span, or "
            "offset and limit to read any line window of the full output. "
            "Use it when a marker says the elided part is what you actually need — "
            "not reflexively after every compressed result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "handle": {
                    "type": "string",
                    "description": (
                        "The handle from the <juiced> header, or the short prefix "
                        "shown inside a marker."
                    ),
                },
                "span": {
                    "type": "integer",
                    "description": (
                        "The number after '#' in a marker. Returns exactly the lines "
                        "that marker replaced."
                    ),
                },
                "offset": {
                    "type": "integer",
                    "description": "1-based line to start from. Ignored when span is given.",
                },
                "limit": {
                    "type": "integer",
                    "description": "How many lines to return from offset. Defaults to 400.",
                },
            },
            "required": ["handle"],
        },
}


def expand_output_tool(
    handle: str,
    span: int | None = None,
    offset: int | None = None,
    limit: int | None = None,
    **_: Any,
) -> str:
    from tools.tokenjuice import expand

    if not str(handle or "").strip():
        return "expand_output needs the handle from a <juiced> header."
    return expand(str(handle).strip(), span=span, offset=offset, limit=limit)


registry.register(
    name="expand_output",
    toolset="tokenjuice",
    schema=EXPAND_OUTPUT_SCHEMA,
    handler=lambda args, **kw: expand_output_tool(
        handle=args.get("handle", ""),
        span=args.get("span"),
        offset=args.get("offset"),
        limit=args.get("limit"),
    ),
    emoji="🧃",
    # An expansion is already clipped to a fixed ceiling by the expander, and
    # re-persisting one would loop straight back into compression.
    max_result_size_chars=float("inf"),
)
