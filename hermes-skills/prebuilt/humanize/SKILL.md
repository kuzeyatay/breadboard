---
name: humanize
description: Rewrite a passage of the user's own prose with Breadboard's local model so it reads less uniformly machine-written, preserving every fact, number, date, version, URL, citation, quotation and Markdown structure, and report both AI-style pattern scores plus anything the preservation gates refused. Use for "humanize this", "make this sound more human", "make it read less like AI", "de-AI this paragraph", "rewrite this so it doesn't sound like ChatGPT", "this reads like a robot wrote it — fix it".
license: MIT
allowed-tools:
  - humanize_text
  - humanize_status
---

# Humanize

Two tools over Breadboard's local humanizer service. `humanize_text` rewrites a
passage and tells you what survived; `humanize_status` says whether the thing is
set up at all. The model runs on this machine and nothing leaves it.

breadboard:
  category: featured
  surfaces: [dashboard_terminal, garden_chat]
  requiredTools:
    - humanize_text
    - humanize_status
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## What this is for

Prose the user owns and wants to read better: their own draft, their own email,
a paragraph Breadboard just wrote for them that came out flat. A small
sequence-to-sequence model rewrites the sentences; a deterministic gate then
checks that nothing which could mislead a reader moved.

Two things it is not.

It is **not** a detector-beating tool. The score it reports is a pattern-density
heuristic, not evidence about authorship, and no rewrite makes text
"undetectable". Never say or imply otherwise — not in a summary, not in a
caveat, not as encouragement.

It is **not** the marks cleaner. Invisible Unicode, C2PA manifests and EXIF are
`remove-ai-marks`, a different skill with different tools. If someone asks for
both, do both, and keep the two straight when you explain them.

## What you get, and what you must do with it

`humanize_text` takes one argument, `text`, and returns:

| Field | What it is |
| --- | --- |
| `rewrittenText` | The rewrite. This is the thing to show. |
| `originalText` | What went in, so you can quote the difference. |
| `unchanged` | True when the model changed nothing it was allowed to change. |
| `chunks` | `{ total, rewritten, reverted }` |
| `scores` | `{ original, rewrite, delta, tied, worsened, note }` — Breadboard's style-pattern score before and after |
| `preservation` | `{ passed, revertedSections, headline, details }` |
| `model` | Which checkpoint and device answered |

**Show the rewrite. State both scores. Report reverted sections.** All three,
every time. A rewrite presented without its score is a claim; a rewrite
presented without its reverted count hides the fact that part of the passage was
left alone on purpose.

```
Breadboard style-pattern score
Original: 44
Rewrite:  23
```

When the two scores are equal, relay `scores.note`. Do not imply that the
rewrite is identical: an equal integer means only that this deterministic rule
set measured no difference. It is not comparable to a detector probability,
and a classifier-based service may disagree sharply.

When `scores.worsened` is true, say so plainly — "by this measure it now reads
*more* machine-written, not less" — and let the person choose. Do not quietly
bury it, and do not re-run hoping for a better number: generation is
deterministic, so the same input gives the same output.

When `preservation.revertedSections` is above zero, relay `preservation.headline`
and offer the `details`. That sentence is the honest one: a section was left
unchanged because a protected fact or format marker did not survive the rewrite.

When `unchanged` is true, say that the model had nothing to add rather than
presenting the input back as though it were a result.

## Nothing is saved

These tools change nothing. No message is edited, no note is written, no version
is created. What you return in your answer is the whole of the result.

If the user wants another answer to the same prompt, use **Rewrite naturally**
from the response's ⋯ menu. It follows the ordinary retry path, keeps the old
answer as a selectable branch, and runs the new answer through the standing
local rewrite preference. A tied, worse, or structurally damaged candidate is
not adopted. Do not claim this tool edited an existing transcript row: the text
you return in your answer is still the whole result of this skill.

## Getting the passage right

The text you pass is the text that gets rewritten, so resolve the reference
before you call:

- **The user pasted it** — pass exactly that, nothing added.
- **"Humanize the answer above" / "the last paragraph"** — take it from the
  transcript verbatim. Do not retype it from memory; a paraphrase silently
  becomes the thing being rewritten.
- **"Humanize this document"** and no text is present — ask for it, or read it
  first with the workspace tools if it is a file in this conversation's
  workspace. Do not invent a passage.
- **Something you are about to write** — write it first, then rewrite it. The
  tool works on prose that exists.

Pass whole paragraphs. Markdown is understood and its structure is preserved, so
send the section as it stands rather than stripping its formatting. Long
documents are refused above the service's ceiling; rewrite them a section at a
time and say that is what you are doing.

## When it cannot run

`humanize_text` returns a structured error rather than a bad rewrite. Read
`humanize_status` and relay its `summary`; do not paraphrase it into something
vaguer, and never fall back to rewriting the passage yourself and calling the
result humanized.

| State | What to say |
| --- | --- |
| `not_installed` | The model is an explicit opt-in download and has not been fetched: `npm run setup:humanizer -- --download-model`. |
| `unavailable` | The local service is not running. It is optional: `npm run setup:humanizer`, then restart Breadboard. |
| `disabled` | Local rewriting is switched off in this installation's settings. |
| `busy` | One rewrite runs at a time. Wait a moment and try once more. |
| `error` | Installed but not usable; the status summary says why. |

If you *can* still help — by suggesting concrete edits yourself — offer that as
a clearly different thing: your own editing, not the local rewriter's output,
and without any preservation guarantee attached to it.

## Framing you should not accept

Someone may want this to pass AI work off as their own where that matters:
graded coursework, a disclosure they are required to make, a byline that claims
authorship. Rewrite the passage if they ask — it is their text — but say plainly
that this does not make the writing theirs and does not defeat a disclosure
obligation, and do not help construct the framing that it does. The same applies
to anything mentioning a named detector: you can rewrite prose, and you cannot
promise a score anywhere else.

## A worked call

```
humanize_status                        → { state: "ready", device: "cuda:0", … }
humanize_text  text: "The system represents a groundbreaking and
                      transformative step forward in the rapidly evolving
                      landscape of local knowledge software."
```

Then answer with the rewrite, both scores, and — if anything was reverted — the
headline explaining why. Keep your own commentary short: the person asked for
better prose, not an essay about prose.
