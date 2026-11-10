# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "tools" / "shared"
sys.path.insert(0, str(SHARED))

from svg_screenshot import _load_svg, inline_local_hrefs  # noqa: E402

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nE0AAAAASUVORK5CYII="
)


class TestSvgScreenshotInline(unittest.TestCase):
    def test_inlines_nested_svg_and_png(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            parts = root / "parts"
            parts.mkdir()
            (root / "lineart.png").write_bytes(PNG)
            (parts / "v_1.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" '
                'viewBox="0 0 1 1">'
                '<image width="1" height="1" href="../lineart.png"/></svg>\n',
                encoding="utf-8",
            )
            parent = root / "out.svg"
            parent.write_text(
                '<svg xmlns="http://www.w3.org/2000/svg">'
                '<image href="parts/v_1.svg"/></svg>\n',
                encoding="utf-8",
            )
            text = _load_svg(parent)
            self.assertIn("data:image/svg+xml;base64,", text)
            self.assertNotIn('href="parts/', text)
            match = re.search(r"data:image/svg\+xml;base64,([A-Za-z0-9+/=]+)", text)
            self.assertIsNotNone(match)
            inner = base64.b64decode(match.group(1)).decode("utf-8")
            self.assertIn("data:image/png;base64,", inner)
            self.assertNotIn("../lineart.png", inner)

    def test_leaves_remote_and_fragment_hrefs(self):
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg">'
            '<use href="#src"/><image href="https://example.com/a.png"/></svg>'
        )
        self.assertEqual(inline_local_hrefs(svg, Path(".")), svg)


if __name__ == "__main__":
    unittest.main()
