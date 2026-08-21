---
name: office
description: Create, inspect and edit real Office documents — Word (.docx), Excel (.xlsx), PowerPoint (.pptx) — with the OfficeCLI document DOM, then hand the finished file to the user as an artifact. Use for "make me a report/deck/spreadsheet", "fix the formatting in this docx", "add a chart", "build a pivot table", "turn these numbers into an xlsx".
license: MIT
allowed-tools:
  - office_run
  - office_export
  - document_edit
  - pdf_to_docx
---

# Office

Real .docx, .xlsx and .pptx files. OfficeCLI remains the authoring path for new
documents: `office_run` executes one command and `office_export` hands the
finished file to the user. Existing DOCX/PPTX attachments also have an
in-process, byte-preserving path through `document_edit`; local PDF → DOCX uses
`pdf_to_docx`.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - office_run
    - office_export
    - document_edit
    - pdf_to_docx
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## The workspace is the boundary

Every file path is relative to this conversation's document workspace —
`report.docx`, `decks/q4.pptx`. There is no way to reach a file outside it,
embed one into a document, or write one elsewhere; commands that try are
refused before the binary runs. Element paths such as `/body/p[1]`,
`/slide[2]/shape[1]` and `/Sheet1/A1` are OfficeCLI's addressing inside the
document, not filesystem paths.

## One command per call

Give `office_run` the command without the leading `officecli`:

```
create report.docx
add report.docx /body --type paragraph --prop text="Executive Summary" --prop style=Heading1
set data.xlsx /Sheet1/A1 --prop value=Region --prop bold=true
add deck.pptx / --type slide --prop title="Q4 Report" --prop background=1A1A2E
view report.docx outline
```

Verbs: `create`, `add`, `set`, `get`, `query`, `remove`, `move`, `swap`,
`view`, `validate`, `batch`, `dump`, `refresh`, `raw`, `raw-set`, `add-part`,
`open`, `save`, `close`, `help`, `load_skill`. The watch/preview server and
MCP mode are not available here — `view <file> html` is how a snapshot is
rendered, and `office_export` attaches one to the artifact for you.

## Existing attachments and PDF conversion

When the turn includes an attached DOCX, PPTX or PDF, the system names its
workspace copy in `<breadboard_editable_documents>`. Do not rebuild that file
from its extracted markdown.

- For DOCX/PPTX, call `document_edit` with the file and no patches. It returns
  stable block anchors and their text. Call it again with only the requested
  `{anchor, text}` replacements. The patch call publishes the result itself.
- For PDF, call `pdf_to_docx` with the workspace file. It converts locally and
  publishes the DOCX. The PDF viewer and original PDF are unchanged.
- Element anchors such as `/body/p[3]` are document addresses, never file paths.

Use OfficeCLI for creating a new document or for structural/formatting work the
anchored replacement seam does not express. Do not convert a new-document task
into an edit, and do not replace OfficeCLI with the in-process engine.

**When unsure about a property name, a value format or a command's syntax, run
`help` instead of guessing** — `help docx paragraph`, `help xlsx pivottable`,
`help pptx set shape`. One help call beats a guess-fail-retry loop. Add
`--json` to any command for structured output.

For many edits to one file, prefer `batch` — atomic by default, one save
cycle:

```
batch data.xlsx --commands '[{"op":"set","path":"/Sheet1/A1","props":{"value":"Done"}}]' --json
```

## Deeper guidance is one load away

`office_run` with `load_skill <name>` prints a full authoring guide; follow
it. Load the most specific match, once per document: `word` / `pptx` / `excel`
for the format defaults, `academic-paper`, `pitch-deck` (fundraising only),
`morph-ppt`, `financial-model`, `data-dashboard` for the specialised jobs. The
same guides are in the Skills catalog under **Office**.

## Finish by exporting

A document the user never receives does not exist. After the last edit, call
`office_export` with the file and a title — once per finished document, not
after every change. The user gets a downloadable artifact with an inline
preview; `.csv` and `.pdf` files in the workspace export too.

Before exporting, `view <file> issues` and `validate <file>` are how you check
your own work — an artifact with a broken layout you never looked at is worse
than one slide fewer.

## Pitfalls that cost a retry

- All attributes go through `--prop`: `--prop name="Title 1"`, never `--name`.
- Paths are 1-based (`/body/p[3]` is the third paragraph); `--index` is
  0-based; Excel row/col `add --index` is 1-based.
- In PPT, `shape[1]` is usually the title placeholder — content starts at
  `shape[2]`.
- Prefer stable-id paths returned by earlier commands
  (`/slide[1]/shape[@id=…]`) over positional indices in multi-step edits.
- Text with `\n` needs `\\n` inside `--prop text="…"`.
