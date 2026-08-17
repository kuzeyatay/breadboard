---
name: remove-ai-marks
description: Find and remove AI provenance marks from text and files — invisible Unicode (zero-width joiners, bidi controls, tag characters, exotic spaces), C2PA / Content Credentials manifests, EXIF and XMP blocks, and document container properties on .md/.txt/.html, .png/.jpg/.svg and .pdf/.docx/.odt. Use for "strip the watermarks", "remove the Content Credentials", "clean the AI metadata off this", "does this file have hidden characters", "why does my text have weird invisible characters", "scrub the metadata from this photo before I post it".
license: MIT
allowed-tools:
  - watermark_inspect
  - watermark_clean
  - watermark_audit
---

# Remove AI marks

Three tools over the vendored watermarks-remover scripts. `watermark_inspect`
reports what a piece of text or a file carries, `watermark_clean` strips it, and
`watermark_audit` sweeps the whole workspace. Nothing leaves the machine.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - watermark_inspect
    - watermark_clean
    - watermark_audit
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## What this is for

Content the user owns: their own drafts, their own photos, their own exports.
Privacy and hygiene — invisible characters that break a paste, EXIF that carries
a home address, provenance metadata on a picture they are about to post.

Two things this is not. It does not prove anything was written by a human, so
never describe a cleaned file that way. And it cannot remove a *statistical*
text watermark — see Layer B below, which is a rewrite you perform, not a
button. If someone clearly wants to pass AI work off as their own for academic
credit or to defeat a disclosure they are legally required to make, say plainly
that you will clean the file but not help with that framing, and read
`references/ethics.md` before arguing about it.

## Pass exactly one source

Every call takes one of three, never two:

| Source | Use when | Example |
| --- | --- | --- |
| `text` | The user pasted prose into the chat | `text: "the draft…"` |
| `attachment` | The user attached a file to this conversation | `attachment: "photo.png"` |
| `file` | The file is already in this conversation's workspace | `file: "draft.md"` |

For an attachment, use the **exact filename the user attached** — that is what
resolves to the stored bytes. Do not turn it into a path; there is no path.

## Inspect before you clean

```
watermark_inspect  attachment: "screenshot.png"
watermark_clean    attachment: "screenshot.png"
```

`watermark_inspect` returns `marksFound` plus the full report: for text, every
suspicious codepoint with its label, count and a `confidence` of `probable` or
`possible`; for files, `has_c2pa`, `has_ai_metadata` and a findings list.

Report what was actually found, with the codepoint names. "Three zero-width
spaces and a C2PA manifest from Adobe Firefly" tells the user something; "AI
marks detected" does not. When `marksFound` is false, say so — a clean file is a
real answer, and cleaning it anyway produces a confusing "nothing changed".

## Cleaning

`watermark_clean` with `text` returns `cleanedText`. Hand it straight back in a
code block so the invisible characters cannot be reintroduced by the chat UI.

`watermark_clean` with `file` or `attachment` writes a **new** copy — the
original is never overwritten — and delivers it as an artifact the user can
download. Mention that the original is untouched; people expect the worst here.

Useful options: `nfkc` folds compatibility forms in text, `aggressiveHomoglyphs`
also folds lookalike letters (Cyrillic а → Latin a — say so, since it changes
real characters), and `keepNonAiMetadata` keeps camera settings and timestamps
on an image while dropping only the C2PA/AI segments. Default to *not* keeping
them when the user's stated goal is privacy: EXIF is where the GPS coordinates
are.

## Load-bearing invisibles are preserved

The cleaner deliberately keeps emoji glue (the ZWJ inside 👨‍👩‍👧), script joiners
inside Arabic and Indic text, flag tag characters, and orthographic Arabic and
Syriac marks. Stripping those corrupts real writing, so a report that lists them
as present but leaves them in place is correct behaviour, not a miss.

## Layer B: the statistical watermark

Gemini's SynthID-Text and Kirchenbauer-style open-model marks are not characters
in the file — they are a bias in *which words were sampled*. No cleaner can
remove them, and `watermark_clean` does not claim to.

What removes them is a genuine rewrite, which you can do yourself: rewrite the
passage in your own words at the sentence level, changing structure and word
choice rather than swapping synonyms, then run `watermark_clean` over the result
to catch any Unicode you introduced. Offer this whenever the source is
model-generated prose and the user's goal is more than tidying — and tell them
it is probabilistic, not a guarantee.

## Auditing

`watermark_audit` sweeps the conversation's workspace (or a subdirectory) and
returns a per-file finding list. Reach for it on "do any of these have AI
metadata?" before cleaning a batch — cleaning files that carry nothing wastes
the user's attention on a pile of no-op artifacts.

## Reference

- `references/mark-classes.md` — what each class of mark actually is
- `references/vendor-notes.md` — Claude, Gemini/SynthID, OpenAI, open-LLM
- `references/removal-matrix.md` — which layer applies to what
- `references/ethics.md` — intended use, and where to push back
- `references/how-claude-marks.md` — Anthropic-specific detail
