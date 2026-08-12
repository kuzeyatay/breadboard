# Documents that survive, and are read as documents

Two platform-wide changes, both of which were previously invisible failures.

## 1. The file is kept

**Before.** A `.docx`, `.pdf`, `.xlsx` or `.pptx` picked in any composer was
posted to `/api/extract-text`, the string that came back was kept, and the
browser dropped the file. The message carried the extracted text and a filename.
Nothing, anywhere in Breadboard, could rewrite an agreement — because by the
time anything ran there was no agreement, only a description of one.

The same gap made a **regenerated turn** answer against nothing: only an
attachment's *name* is stored with a message, so a retry handed the model a list
of filenames and it answered anyway. Confident and invisible, which is the worst
shape a failure takes.

**Now.** A document is the third attachment kind whose bytes are the point,
after a video and a mesh, and it follows their pattern exactly: streamed to a
per-user directory, addressed by a `doc_…` blob id, ownership enforced by the
path so a blob belonging to someone else is simply not there to find.

Unlike those two it carries **both** — the pointer *and* the text — because each
alone is a different failure. Text alone is what we had. Bytes alone would make
every model open the file before it could answer a question about it.

```
src/lib/document-attachments.ts            formats, caps, blob ids, summary
src/lib/conversations/document-blob-store.ts   bytes + a figures sidecar
src/lib/document-attachments-server.ts     re-read text; resolve for a retry
src/app/api/chat-attachments/documents/    upload+read; GET original or figure
```

`ChatAttachment` and `ChatMessageAttachment` both gained a `document` variant, so
the pointer survives a save, a reload and a retry. `resolveDocumentAttachments`
runs at every server entry point (`/api/hermes/sessions/*/messages`, `…/direct`,
the Garden adapter) and fills in the text a reused attachment did not carry.

## 2. The reading is structural

**Before.** `stripXml` — remove every tag from `word/document.xml`, collapse the
whitespace. What that costs:

| In the file | What arrived |
|---|---|
| A table | A run-on sentence. Term sheets, rent schedules, cap tables and damages calculations are mostly tables. |
| An equation | Its characters with the structure gone: `x²` → `x2`. Plausible, wrong, unnoticeable. |
| A figure | Nothing. Not a placeholder — the model was never told a chart existed. |
| A tracked deletion | Ordinary text, so a struck-out clause was quoted as though in force. |
| A workbook formula | Dropped. Only the cached values survived, so the one thing a model is attached to answer about was the one thing missing. |
| Speaker notes | Dropped, and slide boundaries with them. |

**Now.** `src/lib/document-structure/` walks the OOXML properly:

- `xml.ts` — a small reader. OOXML nesting is the whole point: `<w:tbl>` and
  `<w:p>` nest, and a regex cannot say which paragraph is in which cell.
- `omml.ts` — Office Math → LaTeX (fractions, sub/superscripts, radicals, n-ary
  operators with limits, delimiters, matrices, accents). LaTeX because the rest
  of Breadboard already speaks it, and a model reasons better about
  `\frac{a}{b}` than about `ab`. Unrecognised constructs fall back to their text
  rather than vanishing.
- `docx.ts` — headings, lists with depth, **markdown tables**, bold (in an
  agreement the bold words are the defined ones), figures lifted to real files
  with their captions and alt text, `~~struck~~` for unaccepted deletions,
  footnotes, endnotes and comment threads.
- `xlsx.ts` — the grid *and* the formulas behind it, addressed as
  `Sheet!B12 = =SUM(...)`. Error values reported as findings.
- `pptx.ts` — per-slide, with speaker notes labelled and images extracted.

Figures are written to a sidecar directory beside the blob and referenced from
the markdown, so a chart in a report is a file an agent can open rather than
something locked inside a zip. A one-line header states what is in the file —
"12 pages · 3 tables · 2 figures · 5 live formulas" — so the model is told the
figures exist in the same breath as it is given the words. The same line appears
on the composer chip, which is the one moment a person can check.

**PDFs are stored here but read by `/api/extract-text`**, which already renders
pages and falls back to transcribing a scan with a vision model. Reusing that is
better than reimplementing it.

## What this unlocks

The Legal Agent's workspace now stages, per document:

```
supply.docx              the original — read it, and rewrite it
supply.extracted.md      the structured reading (equations, table structure,
                         which passages are struck rather than operative)
supply.figures/          every picture and chart, as real files
```

Both, because neither is a superset: pandoc (what the harness's `read` tool uses)
gives faithful prose and loses the equations; the extraction keeps the equations
and the figure references. The assignment names each file and says which one is
the original that may be edited in place — an agent that is not told that
reasonably writes a fresh document instead of marking up the one it was given.

## Verified live (2026-08-10)

Against real files and real ChatMock (`cliproxy/claude-sonnet-5`):

- **A redline the agent authored.** Given a clean Supply Agreement, asked to
  change payment terms and the assignment clause: the output `.docx` contains
  3 insertions and 2 deletions — `ninety (90)`→`thirty (30)`, and
  `without notice to or consent of the Buyer` → `not … the Buyer's prior written
  consent` — as real `<w:ins>`/`<w:del>` tracked changes. All 18 package parts
  preserved, including the table and the embedded image. This is the thing that
  was impossible before.
- Extraction verified against Word/Excel/PowerPoint fixtures: a table came back
  as a markdown table, `E=∑ᵢ₌₁ⁿ (Rᵢ−Cᵢ)/(1+r)ⁱ` as correct LaTeX, a figure with
  its caption and its bytes, tracked changes marked, workbook formulas listed
  with their cell references, speaker notes labelled.

Not exercised live: the browser upload itself (covered structurally), and PDFs
through the new store.

## Known limits

- A PDF is stored but not rewritten in place; what an agent makes from one is a
  new file. `isEditableDocumentFormat` says so.
- Charts drawn from embedded data have no bitmap to lift; they are announced as
  `[Chart]` with a warning rather than silently skipped.
- Legacy `.doc`, `.xls`, `.ppt` are not handled — they are not OOXML.
