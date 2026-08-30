"""The README must not advertise a skill you cannot invoke.

The Highlights table tells a reader what to type. It listed `$memory`, which is
not a skill and routes to a picker, and `$request-to-handoff`, which is a
playbook id rather than an installable skill - both sat there unnoticed because
nothing checked the table against the catalog.

This gate reads every label out of the "Try it with" column in all four READMEs
and requires it to be a real installable skill's display name. It also keeps
operator-only CLI commands out of that column: `AGENTS.md` reserves `omh …`
commands for operators and wrappers, and a normal user should only ever need
`omh setup`, `omh update`, and `omh doctor`.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from omh.skills.catalog import installable_skill_names, omh_skill_display_name


READMES = ("README.md", "README.ko.md", "README.ja.md", "README.zh.md")

# The "Try it with" column is the second cell of each Highlights row.
_LABEL_RE = re.compile(r"`([^`]+)`")


def _highlight_rows(text: str) -> list[str]:
    rows: list[str] = []
    inside = False
    for line in text.splitlines():
        if line.strip().startswith("**") and "ighlight" in line or "하이라이트" in line or "ハイライト" in line or "亮点" in line:
            inside = True
            continue
        if inside:
            if line.startswith("|") and line.count("|") >= 4 and not set(line) <= set("|- "):
                rows.append(line)
            elif rows and not line.startswith("|"):
                break
    return rows


class ReadmeHighlightsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.display_names = {omh_skill_display_name(name) for name in installable_skill_names()}

    def test_every_advertised_label_is_an_installable_skill(self) -> None:
        for rel in READMES:
            rows = _highlight_rows(Path(rel).read_text(encoding="utf-8"))
            self.assertTrue(rows, f"{rel}: no Highlights rows found")
            for row in rows:
                cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
                for label in _LABEL_RE.findall(cells[1]):
                    with self.subTest(readme=rel, label=label):
                        self.assertIn(label, self.display_names)

    def test_the_try_it_column_holds_no_operator_cli_commands(self) -> None:
        # `omh mcp` and `omh plugin` used to live here. AGENTS.md keeps the
        # control-plane commands in the operator reference, not in the table a
        # chat user reads to learn what to say.
        for rel in READMES:
            for row in _highlight_rows(Path(rel).read_text(encoding="utf-8")):
                cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
                for label in _LABEL_RE.findall(cells[1]):
                    with self.subTest(readme=rel, label=label):
                        self.assertFalse(label.startswith("omh "), f"{label} is an operator command")

    def test_the_workflow_engines_are_advertised_with_their_ulw_label(self) -> None:
        english = Path("README.md").read_text(encoding="utf-8")
        rows = "\n".join(_highlight_rows(english))

        for engine in ("ulw-work", "ulw-goal", "ulw-team", "ulw-loop"):
            with self.subTest(engine=engine):
                self.assertIn(f"`{engine}`", rows)


if __name__ == "__main__":
    unittest.main()
