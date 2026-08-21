# Local text humanizer — "Rewrite naturally"

Breadboard could already tell you when something it wrote read like a machine
wrote it: `dashboard/src/lib/prose-score` gives that a number. What it could not
do was anything about it. This is the other half — a small seq2seq model,
running on your machine, that rewrites the prose of one answer you asked it to,
behind gates that check what came back and a dialog that shows you before
anything changes.

The switch is off by default and the weights are not shipped with Breadboard.
Turned on, it is a standing instruction rather than a per-message choice — see
"Automatic mode" below.

---

## What it does, from the reader's side

1. Turn on **Rewrite naturally** in the composer's intelligence menu, directly
   above **Personalize**. The switch adds an action; it does not rewrite
   anything.
2. Under any assistant answer, open the **⋯** menu and choose **Rewrite
   naturally**.
3. A dialog opens and says *Rewriting locally…*. You can cancel it.
4. When it finishes you get: the original, the rewrite, a line-level diff with
   word-level marks inside changed lines, both **AI-style pattern scores**, and a
   note about anything the gates refused.
5. **Use rewrite** stores the rewrite as a new version of that answer. **Copy
   rewrite**, **Retry** and **Cancel** do what they say. Nothing is written
   until you press **Use rewrite**.
6. Afterwards the answer carries version arrows. The original is version 1 and
   stays selectable forever.

Below roughly 900px the diff becomes a unified `+`/`−` column rather than two
unreadable ones.

## Automatic mode

**Rewrite naturally** is a standing preference, not a per-message toggle. With
it on, three things are offered to the local rewriter without being asked, and
take the rewrite whenever the preservation gates pass it:

| Surface | When | Where |
| --- | --- | --- |
| Finished chat answers | after the turn lands | transcript owner, client-side |
| Markdown artifacts | as they are stored | `tools/artifacts` route, server-side |
| Garden notes | as they become a file | `garden_save_note`, server-side |

Deliberately excluded: agent run summaries. Those carry cited findings whose
wording the citations refer to, and rewording them would decouple the two.
Non-Markdown artifacts are excluded too — the rewriter takes prose apart with a
Markdown segmenter, so an HTML or JSON body is a document it cannot read.

Three properties hold everywhere, and they are what make automatic mode
defensible without a human reading a diff each time:

- **The original is never lost.** A rewritten answer keeps the model's own words
  as version 1 behind the arrows; a reload still finds them, and evidence
  reattaches when you switch back.
- **Every automatic path runs the same gates as the manual one.** There is no
  shortcut around them; the automatic path calls the same two routes the dialog
  does.
- **Failure is silence.** Not installed, busy, timed out, or every chunk
  refused — the text is left exactly as it was and nothing interrupts the
  reader. A rewrite must never cost somebody their answer, artifact or note.

Chat answers swap in *after* the turn lands rather than blocking it. Streaming
stays streaming, which means you briefly see the model's own wording before the
rewrite replaces it. Holding the answer back instead would have meant no
streaming at all, several seconds on GPU and minutes on CPU, with every chat on
the machine queued behind one inference lock.

Server-side surfaces read the preference from the account
(`hermes_user_settings.humanizer_auto`) rather than from the browser switch,
because an artifact and a note are written where no `localStorage` exists. The
switch mirrors itself onto the account when you toggle it.

Two bounds on the server path, both about that single inference lock: text under
240 characters is skipped (nothing for a sentence-scale rewriter to do) and text
over 20,000 characters is skipped (a long note would hold the lock for minutes
while every chat waited).

### What automatic mode does not promise

It cannot rewrite everything, and the name overstates it. Headings are skipped,
fragments under four visible words are skipped, already-plain prose usually
comes back unchanged, and any chunk whose rewrite fails a gate keeps its
original. On a short technical answer, most chunks revert and the text is
untouched. That is the design working, not failing — but "everything is
humanized" is not a claim this switch can make.

### What it does not do

It does not make text "undetectable", it does not "bypass AI detectors", and the
score beside it does not prove who wrote anything. Nothing in the UI or this
document claims otherwise, and there is a test that fails if it starts to.

It also never rewrites anything while the switch is off, and never rewrites
without keeping the original.

---

## The `/humanize` skill

The review dialog is one way in. The other is asking.

"Humanize this paragraph" selects the first-party `humanize` skill on its own,
the way "draw me a flowchart" selects Diagram Design — through
`dashboard/src/lib/hermes/humanize-intent.ts`, which runs in both turn chains
(`conversations/turn-service.ts` and `hermes/garden-chat-adapter.ts`) and
rewrites the message to `/humanize <the message>` when the wording asks for it.
In super agent mode the skill is in the inventory anyway; the intent module is
what makes the selection reliable rather than a matter of the model noticing.

It fires on `humanize` / `humanise` / `de-AI` / `deslop`, on a rewriting verb
pointed at machine-sounding prose ("rewrite this so it doesn't sound like AI",
"make the intro read less robotic"), and on a short follow-up after a rewrite
("try that again", "make it warmer"). It deliberately does **not** fire on
questions about humanizers, on questions about this feature, on requests to
strip metadata (that is `remove-ai-marks`), on plain editing requests, or on
anything naming a detector — that last one deserves the assistant's own words
about what this can and cannot do, not a silent hand-off.

The skill has two tools, registered in the Hermes plugin and reaching the
sidecar through `POST /api/hermes/tools/humanizer`:

| Tool | Does |
| --- | --- |
| `humanize_text` | Rewrites a passage; returns the original, the rewrite, both scores, chunk counts and the preservation report. |
| `humanize_status` | Whether the service is up and the model downloaded, and on which device. Never loads or downloads anything. |

This door is deliberately narrower than the dialog's. It **returns text and
writes nothing** — no message edited, no note written, no version created. The
skill's guidance says so, and tells the model to point at **Rewrite naturally**
when the person wants a rewrite actually applied to an answer in the transcript.
It also requires the model to show the rewrite, state both scores and report any
reverted sections, every time.

Both tools are authenticated chat-surface only (Terminal and Garden chat, never
the anonymous Quartz surface), scoped by the same capability token every
internal tool uses, and audited by name without the passage ever being written
down.

---

## Architecture

```
browser
  │  POST /api/humanizer/rewrite      (Next.js route, authenticated, Zod, no-store)
  ▼
dashboard server
  │  Bearer <per-install secret>      (loopback only, server-owned)
  ▼
humanizer-service  (Python, 127.0.0.1)
  │
  ├─ chunking.py       Markdown → protected blocks + rewritable prose
  │                    inline literals → XP0X placeholders
  │                    sentence packing measured with the BART tokenizer
  ├─ model.py          startup preload, one at a time, idle unload
  ├─ preservation.py   per-chunk gate, then a document-level gate
  └─ pipeline.py       segment → chunk → model → gate → reassemble → gate
```

The browser never learns the sidecar's URL, port, secret, model cache path or
installation paths. It sends text to a Breadboard route and gets text back.

Files:

| Layer | Path |
| --- | --- |
| Python service | `humanizer-service/breadboard_humanizer/` |
| Loopback client | `dashboard/src/lib/humanizer/service.ts` |
| Configuration | `dashboard/src/lib/humanizer/config.ts` |
| Request schemas | `dashboard/src/lib/humanizer/schemas.ts` |
| Scores + warning copy | `dashboard/src/lib/humanizer/review.ts` |
| Diff | `dashboard/src/lib/humanizer/diff.ts` |
| Routes | `dashboard/src/app/api/humanizer/{rewrite,status,versions}/route.ts` |
| Review UI | `dashboard/src/app/components/humanizer/` |
| Content versions | `dashboard/src/lib/conversations/message-versions.ts` |
| Supervision | `desktop/src/main/service-definitions.ts` |
| Skill | `hermes-skills/prebuilt/humanize/SKILL.md` |
| Self-selection | `dashboard/src/lib/hermes/humanize-intent.ts` |
| Automatic (chat) | `dashboard/src/app/components/humanizer/auto-humanize.ts` |
| Automatic (server) | `dashboard/src/lib/humanizer/auto-server.ts` |
| Agent tools | `dashboard/src/app/api/hermes/tools/humanizer/route.ts`, `hermes-agent/plugins/breadboard/__init__.py` |

### The service boundary

`humanizer-service` binds `127.0.0.1` and nothing else — the host is not
configurable past loopback. Every request carries a per-launch bearer passed
through the environment, never argv, so it cannot appear in a process listing.
Three endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | State, versions, device, dtype, whether the model is installed and whether it is loaded. Never loads anything. |
| `POST /humanize` | One rewrite. |
| `POST /cancel` | Abandon a request id; observed between chunks. |

Request:

```json
{ "requestId": "opaque", "text": "Markdown or plain text",
  "mode": "natural", "maxChunkTokens": 180 }
```

Response:

```json
{ "requestId": "opaque", "status": "complete",
  "modelId": "cive202/humanize-ai-text-bart-large", "modelRevision": "main",
  "device": "cuda:0", "dtype": "float16",
  "originalText": "...", "rewrittenText": "...",
  "chunks": { "total": 6, "rewritten": 5, "reverted": 1 },
  "preservation": { "passed": true, "warnings": [] },
  "timingMs": { "load": 0, "inference": 1420, "total": 1495 } }
```

`status` is `complete` or `preservation_failed`. On a document-level failure the
original comes back unchanged and the dashboard turns it into a structured
refusal rather than offering it.

Health states, all reported rather than inferred:

```
service available, model not installed      status ok,       modelState not_installed
service available, installed but not loaded status ok,       modelState installed_not_loaded
service available, model loaded             status ok,       modelState loaded
service busy                                status busy
service degraded (torch broken, load failed) status degraded
```

---

## Model and revision

| | |
| --- | --- |
| Model | `cive202/humanize-ai-text-bart-large` |
| Class | `AutoModelForSeq2SeqLM` / `AutoTokenizer` |
| Prefix | **none** — see below |
| Pinned revision | `c74c28e03d3e306c8717d9f85cc18edb7d493299` |
| Upstream base | `facebook/bart-large` |
| Generation | `num_beams=4`, `do_sample=false`, `early_stopping=true`, `no_repeat_ngram_size=4` |
| `max_new_tokens` | derived from input length, bounded to `[32, 256]` |
| `trust_remote_code` | **false**, always |

Generation is deterministic on purpose. A review dialog that showed a different
rewrite every time you pressed **Retry** would be a slot machine, and the
preservation gate downstream needs something stable to check.

### What the real checkpoint taught us

Four things below were changed *after* measuring the downloaded weights rather
than reasoning about them. They are recorded here because each looks like a
detail and each decided whether the feature works at all.

**No task prefix.** The integration spec called for `"humanize: "`, a T5-style
prefix. Measured, it is actively harmful: with it, "The system represents a
groundbreaking step forward…" returns *"Local Knowledge Software and Its Impact
on the Local Knowledge Industry Essay (Article) (Article) * Local knowledge
software is…"* — a title, a bullet list and a truncation. Without it the same
sentence returns "The system is a revolutionary step forward in the rapidly
evolving world of local knowledge software." The checkpoint's own config is
`facebook/bart-large` with the stock summarization `task_specific_params`
untouched, consistent with a fine-tune that never learned a prefix. Restore it
with `BREADBOARD_HUMANIZER_PREFIX` if a future revision wants one.

**`XP0X` placeholders, not `[[P0]]`.** BART's BPE splits brackets from digits
and the decoder returns `[ edit ]`, `p1]]` and `wasP0]]`. Every chunk carrying a
link or a number then failed validation and reverted — safe, but useless,
because those are the sentences worth protecting. Candidates measured on one
three-placeholder sentence: `[[P0]]` destroyed, `PLACEHOLDER0` destroyed, `Qxa0`
destroyed, `#0#` survived minus punctuation, `zqz0` survived minus a word,
`XP0X` exact.

**Headings are never sent.** "A Pivotal New Chapter" comes back as "Pivotal New
Chapter: A New Chapter in American History Essay (Book Review)". Word count
cannot separate that from a short sentence — "The measured improvement was
18.5%" is the same length — so the rule keys off the segment label instead.

**Two gates exist because the model got past the others.** `repeated_text` now
also catches a stutter ("a groundbreaking and transformative step" →
"a revolutionary and revolutionary step"): no n-gram repeats, so
`no_repeat_ngram_size` cannot see it. `sentence_boundary_lost` is new entirely —
"Version 2.4 shipped on August 19, 2026. Read the [report](…)." came back as
"2.4 shipped on August 19, 2026 Read the [report](…)" with every literal intact,
every placeholder home, and two sentences fused into a run-on. Nothing else in
the gate could see it.

### Measured yield

On eight sentences run through the finished pipeline with the real checkpoint:

| Input | Result |
| --- | --- |
| Six formulaic, AI-flavoured sentences | all six rewritten and accepted |
| Two already-plain sentences | both reverted — nothing to improve |

Representative accepted rewrites:

- "serves as a testament to the transformative power of innovation" → "is a
  testament to the power of innovation"
- "must leverage cutting-edge solutions" → "must take advantage of cutting-edge
  solutions"
- "empowers developers to seamlessly integrate" → "allows developers to easily
  integrate"
- "Ultimately, this represents a pivotal moment" → "Finally, this is a turning
  point"

The acceptance fixture is a poor guide to yield in either direction: its
sentences are short and literal-dense, so most of them are skipped or reverted
and the document comes back nearly unchanged. That is the gate behaving
correctly on hard input, not the feature failing.

The revision pin lives in `DEFAULT_MODEL_REVISION`
(`humanizer-service/breadboard_humanizer/__init__.py`) and in
`HUMANIZER_DEFAULT_REVISION` (`dashboard/src/lib/humanizer/config.ts`); both are
overridable through `BREADBOARD_HUMANIZER_REVISION` for development. `main` is
the revision that was reviewed. It is not a strong pin — a model repository can
be force-pushed — so if you need one that cannot move, set the environment
variable to a commit SHA and record it here. Moving the pin is a reviewed
change: bump the constants, re-run `humanizer-service/tests`, and re-run the
real-model smoke test.

---

## Setup

```bash
npm run setup:humanizer                       # the Python environment (~2.5 GB)
npm run setup:humanizer -- --download-model   # the checkpoint (~1.6 GB)
```

The split is deliberate. Provisioning an environment is a developer action;
downloading someone else's model weights is a licensing decision (below), so it
never happens as a side effect of anything.

### Starting it

Nothing else to do: once the environment exists, **every** way of starting
Breadboard starts the service with it, and every way of starting Breadboard
without it carries on exactly as before.

| Launcher | How it decides |
| --- | --- |
| `npm run dev` | `scripts/dev-all.mjs` looks for `.runtime/humanizer-venv` and starts the sidecar when it is there, printing a one-line note when it is not |
| The desktop app | `desktop/src/main/service-definitions.ts` registers the service only when `resolveHumanizerPython` finds an interpreter; the port is allocated in `app-lifecycle.ts` |
| `start.bat` | An `if exist` on the venv, beside the CAD and ColPali lines |

An installed checkpoint is preloaded during Breadboard startup. The service
opens its socket after that attempt, so the desktop supervisor and `npm run dev`
wait for warming before they finish their startup sequence. Missing or broken
weights remain an optional health state: they do not prevent Breadboard from
opening, and the authenticated status route reports the precise problem.

`npm run dev:humanizer` runs it on its own, which is only useful when debugging
the sidecar or when the dashboard is being run by hand.

The environment is its own pinned Python 3.13 virtualenv under
`.runtime/humanizer-venv`, provisioned with `uv`. This repository's default
interpreter is 3.14, for which PyTorch publishes no Windows wheels. The setup
script never touches a global Python.

### Device selection

```
auto  →  CUDA with float16 when a CUDA device is present, otherwise CPU float32
cuda  →  CUDA with float16, or a clear failure. Never a silent fall back to CPU.
cpu   →  CPU float32, even where a card exists.
```

Set it with `BREADBOARD_HUMANIZER_DEVICE`, or the desktop `humanizerDevice`
setting. The default target — Ryzen 7 PRO 8845HS, 32 GB, RTX 1000 Ada with 6 GB
of VRAM — runs `auto` into float16 on the card, which is ~1.6 GB of weights.
The idle timer (default 300s, `BREADBOARD_HUMANIZER_IDLE_UNLOAD_SECONDS`) hands
that VRAM back, and on CUDA the unload calls `torch.cuda.empty_cache()`. This
matters on that machine specifically: ComfyUI wants the same card.

CPU-only works and is correct — roughly an order of magnitude slower.

### Cache location, offline behaviour, removal

The checkpoint is cached under Breadboard's **mutable user data**:

```
<BREADBOARD_DATA_DIR>/humanizer/models     (dev, including desktop dev; default: ~/.breadboard/humanizer/models)
<userData>/Data/runtime/humanizer/models   (installed desktop app)
```

Never in application resources, never in the installer, never in the checkout.
Consequences, all intended:

- An application update replaces the program; the model cache is untouched.
- Uninstalling or updating Breadboard does not silently delete weights you
  downloaded.
- Removing the model is deleting that directory. No user content lives there.
- After installation, rewriting is **offline**: the loader passes
  `local_files_only=True` and the service sets `HF_HUB_OFFLINE=1`. Hugging Face
  and Transformers telemetry are disabled.

---

## Preservation rules

The model is untrusted output. "Preserves meaning" is a claim to verify, not an
assumption to build on.

### What is never sent to the model

Whole blocks, lifted out and reinserted byte-for-byte:

YAML frontmatter · fenced code blocks · indented code blocks · block mathematics
· raw HTML blocks · Markdown tables · reference-link definitions · blockquotes ·
thematic breaks · setext underlines.

Structural prefixes, preserved exactly while their visible prose is rewritten:
heading markers, ordered and unordered list markers, task-list markers,
indentation, blank lines, paragraph boundaries.

Inline fragments, replaced by `XP0X`-style placeholders before the text is
sent and restored after: inline code · inline mathematics · Markdown links and
images (label and destination together) · reference links · footnote identifiers
· citation keys · HTML tags · URLs · email addresses · file paths ·
command-line flags · version numbers · dates · times · percentages · currency
amounts · digit-containing identifiers · `@handles` · `#hashtags` · quoted
passages.

Every placeholder must return exactly once and in the same order. Reordering
counts as loss — `XP1X before XP0X` reassembles into a sentence that says
the opposite of what it read. A chunk that fails placeholder validation is
discarded and its original kept, and no unresolved placeholder is ever
published.

### Chunking

The model was trained on short, sentence-scale pairs, so:

- chunks never cross a block boundary — two paragraphs are two thoughts;
- length is measured with the **model's own tokenizer**, never character count;
- default budget 180 tokens, hard ceiling 200 (the 180 leaves room for the
  `humanize: ` prefix without relying on tokenizer-boundary assumptions);
- whole sentences are packed greedily up to the budget;
- only a sentence that alone exceeds the hard ceiling is cut, and then on a word
  boundary;
- the whitespace needed to reassemble the block is carried alongside each chunk,
  so nothing is guessed at.

Chunking is pure and separately unit-tested; the tokenizer is injected, so the
tests never load one.

### The gates

**Per chunk**, comparing what came back against what went in. A chunk fails if
it is empty, loses or reorders a placeholder, falls outside a 0.5–1.8 length
ratio, repeats itself, **stutters** (a word repeated back to back, or either
side of "and"/"or", where the original did not), **loses a sentence boundary**
(fewer terminators than the original, or a closing full stop dropped), contains
invalid Unicode or control characters, adds Markdown structure (including a
newline — chunks live inside one block), or changes the multiset of critical
literals: numbers, decimals, dates, times,
percentages, currency, measurements, versions, URLs, emails, citations,
footnotes, paths, commands, flags, acronyms, handles, hashtags, quoted strings,
and conservatively-identified capitalised multiword names.

A failing chunk keeps its **original text**, records a structured warning, and
the run continues. Nothing is repaired: guessing what the model meant by
changing 18.5% to 18% is how a rewriter becomes a fabricator.

**Per document**, after reassembly: protected blocks compared by hash, Markdown
structure and prose prefixes compared position by position, the critical-literal
multiset compared end to end, and a final sweep for surviving placeholders or
invalid Unicode. If this fails, the rewrite is **not offered at all** — the
original is returned and the caller is told why.

There is no second model anywhere in this. No semantic-similarity scorer, no
LLM critic, no ChatMock call to check the BART output. Everything above is
deterministic and auditable.

---

## Scoring semantics

Both versions are scored with Breadboard's existing scorer,
`dashboard/src/lib/prose-score`, using the normal Breadboard profile and garden
Markdown masking. There is no second detector and no new heuristic.

The dialog shows, for each version, the score, band, confidence, pattern score,
uniformity score and top findings:

```
AI-style pattern score
Original: 44
Rewrite:  23
```

The score is a **review signal**. It is a weighted pattern-density measure on a
log curve blended with statistical uniformity — a count of habits, not evidence
about authorship. Two rules follow, and both are implemented:

- a rewrite that scores **worse** is still offered, labelled plainly ("The
  rewrite scores higher than the original … so by this measure it reads more
  machine-written, not less"), never auto-rejected;
- a rewrite that scores **better** is never accepted on that basis. Safety is
  the preservation gate's decision; this number is advice.

Short passages score noisily. A rewrite that is factually safe is not rejected
because the number did not move.

---

## Applying a rewrite

Pressing **Use rewrite** posts to `/api/humanizer/versions`. The browser sends
the conversation id, the message id, the content it believes that message holds,
and the replacement. The server decides everything else:

- the message must exist, be an assistant message, be complete, and belong to
  the signed-in user's conversation;
- its current content must equal `expectedContent`, or the apply fails with
  `message_content_stale` and the reader is asked to run the rewrite again —
  this is what stops a rewrite of text that has since been regenerated or
  steered from landing;
- the new version is appended; version 0 is always the text the model produced
  and is never overwritten;
- the row's `content` column mirrors the active version, so every other reader
  in the codebase (history, memory, export, runtime context replay) needs to
  know nothing about this;
- a **derived** version does not inherit the original's verification evidence.
  That evidence was gathered about the original's wording. Selecting the
  original brings it back.

`AssistantMessageActions` opens the dialog and holds no database logic; the
transcript owner (`agent-runtime-panel.tsx`) applies the result and drives the
version arrows. Artifacts, tool calls and source references are not touched:
they belong to the turn, not to a wording of it.

---

## Configuration

Desktop (`desktop-config.json`, backfilled on upgrade):

```
humanizerMode:   "local" | "disabled"      default local
humanizerDevice: "auto" | "cuda" | "cpu"   default auto
humanizerServiceSecret                     per-install, never logged
```

Environment (see `.env.example`):

```
HUMANIZER_MODE
BREADBOARD_HUMANIZER_HOME
BREADBOARD_HUMANIZER_PORT
BREADBOARD_HUMANIZER_MODEL
BREADBOARD_HUMANIZER_REVISION
BREADBOARD_HUMANIZER_DEVICE
BREADBOARD_HUMANIZER_SECRET
BREADBOARD_HUMANIZER_IDLE_UNLOAD_SECONDS
BREADBOARD_HUMANIZER_MAX_CHUNK_TOKENS
BREADBOARD_HUMANIZER_TIMEOUT_MS
```

`HUMANIZER_MODE` has no remote value by design. The port is allocated
dynamically by the desktop supervisor; 7735 is only the development preference,
and anything already holding it moves the service to an OS-assigned port that
the dashboard is then told about.

The service is an **optional leaf**. Its absence, a failed setup, a failed model
download or a failed inference cannot stop ChatMock, Hermes, Quartz, the
dashboard or the desktop application from starting. There is a desktop test that
fails if that stops being true.

---

## Licensing and redistribution

Breadboard does **not** bundle, vendor, mirror, package or redistribute the
model weights. They are not in this repository, not in the installer, and not in
application resources.

The upstream model card carries an MIT designation **and states that the
designation is a placeholder**. Breadboard therefore treats the weights as an
optional third-party download of *unresolved* licence status, and no Breadboard
documentation describes this model as unconditionally MIT-licensed. If you
intend to use rewritten output commercially, resolve the licensing with the
model's publisher first.

Full notice: `humanizer-service/THIRD_PARTY_NOTICES.md`.

---

## Known limitations

- It is a **constrained rewriting model**, not a writer. It changes wording; it
  will not restructure an argument. Measured, it does its best work on long
  formulaic sentences and reverts on short or already-plain ones — see
  "Measured yield" above.
- **Headings are never rewritten.** Handed one, this checkpoint writes an essay
  title rather than rewording it, so they are skipped by segment label.
- **Sentences under four visible words are skipped**, placeholders excluded.
  "Run `npm run build` before publishing." is three visible words and is left
  alone.
- The preservation gates reduce risk; they do **not** guarantee semantic
  equivalence. A rewrite can keep every number and still shift emphasis. The
  diff exists because you are the last check.
- Placeholder-dense sentences (a line that is mostly links and versions) are
  frequently reverted. That is the gate working, but it means such passages
  rarely improve.
- A soft-wrapped paragraph that is rewritten is reflowed onto one line. A
  paragraph nothing touched keeps its original wrapping byte-for-byte.
- Chunks are rewritten independently, so a transition sentence can lose a little
  of its connection to the one before it.
- The prose score is noisy under about 150 words.
- Only the assistant-response surface is wired today. The editor integration is
  designed for but not built (below).

---

## Troubleshooting

| What you see | What it means |
| --- | --- |
| "The local rewriter is not running on this machine." | Almost always no Python environment: run `npm run setup:humanizer` and start Breadboard again. If `.runtime/humanizer-venv` does exist, the launcher printed why it skipped the service — check the stack output, or run `npm run dev:humanizer` on its own to see it start. |
| "The rewriting model has not been downloaded yet." | Environment present, checkpoint absent. `npm run setup:humanizer -- --download-model`. |
| "The rewriter is already working on something." | One inference at a time, by design. Try again in a moment. |
| "The rewrite took too long and was stopped." | A long answer on CPU. Raise `BREADBOARD_HUMANIZER_TIMEOUT_MS`, or rewrite a shorter passage. |
| "The rewrite changed something it was not allowed to change." | The document-level gate refused it. The response is untouched. Retry produces the same result — generation is deterministic. |
| Health reports `degraded` | `torch` or `transformers` failed to import, or a load failed. `GET /health`'s `detail` says which. Re-run setup. |
| CUDA requested but unavailable | Deliberate hard failure. Either fix the driver or set the device to `auto`. |
| Many reverted sections | Usually a passage dense in numbers and links. Working as intended. |

Server-only diagnostics live in `GET /api/humanizer/status`: mode, expected
model and revision beside what actually answered, the model state, device, dtype
and busy flag.

### Logging

The service never logs source text, rewritten text, protected literals, chunks,
placeholders or diff bodies. Log lines carry a request id, character count,
chunk counts, the model id, device, dtype, duration, the preservation result and
an error category. There is a test that renders the acceptance fixture through
the service and fails if any fragment of it reaches stdout. The desktop log
manager additionally redacts the service secret.

---

## Tests

Everything below runs with a **fake model**. No automated test downloads the
checkpoint.

```bash
npm run test:humanizer          # 92 Python tests: chunking, preservation, pipeline, server
npm --prefix dashboard test     # includes the four humanizer-*.test.mjs suites
npm --prefix desktop test       # includes humanizer-service.test.ts and qa-mode
```

| Suite | Covers |
| --- | --- |
| `humanizer-service/tests/test_chunking.py` | round-trip losslessness, block protection, inline placeholders, sentence packing, token ceilings, one overlong sentence |
| `humanizer-service/tests/test_preservation.py` | changed / invented / missing literals, placeholder loss and reordering, repetition, length, structure, document gate |
| `humanizer-service/tests/test_pipeline.py` | the acceptance fixture, chunk fallback to original, document-gate refusal, cancellation, chunk ceiling |
| `humanizer-service/tests/test_server.py` | authentication, startup preload, malformed JSON, size limits, health states, busy, device selection, explicit-CUDA failure, idle unload, log hygiene |
| `dashboard/tests/humanizer-service-client.test.mjs` | unavailable, not-installed, busy, timeout, cancellation, preservation failure, bearer handling, disabled mode |
| `dashboard/tests/humanizer-versions.test.mjs` | version creation, the original surviving, optimistic concurrency, ownership, the evidence rule |
| `dashboard/tests/humanizer-diff.test.mjs` | line and word diff, unified projection, scoring before and after, warning copy |
| `dashboard/tests/humanizer-review-render.test.mjs` | the dialog and diff rendered for real |
| `dashboard/tests/humanizer-wiring.test.mjs` | authentication, Zod, no-store, **no remote provider anywhere**, no sidecar details in browser code, the switch's position, nothing automatic |
| `desktop/tests/humanizer-service.test.ts` | loopback-only, optional startup participation, secret off argv, shared dev cache, config backfill, redaction |
| `desktop/tests/qa-mode.test.ts` | QA never starts, downloads or reads a real model |
| `dashboard/tests/humanizer-auto.test.mjs` | the preference defaulting off, the round trip through the settings store, and every way a rewrite can fail leaving the write untouched |
| `dashboard/tests/humanize-skill.test.mjs` | the skill's manifest and classification, tool registration on all four sides, the sentences that select it and the ones that must not, the tool route's authentication and its inability to persist anything |

### Real-model smoke test

Behind an explicit flag, because it needs the actual checkpoint:

```bash
set BREADBOARD_HUMANIZER_SMOKE=1

# in-process, through the pipeline
python -m unittest tests.test_real_model_smoke   # from humanizer-service/

# against a running service, end to end
npm run dev:humanizer                            # in another terminal
node scripts/humanizer-smoke.mjs
#   ... restart Breadboard ...
node scripts/humanizer-smoke.mjs --after-restart
```

It verifies service health, rewrites the acceptance fixture, checks that the
version number, the date, the URL, the inline code, the frontmatter, the heading
marker, the blockquote and the percentage are all byte-for-byte identical, that
the generic prose actually changed, and — after a restart — that the environment
and the user-downloaded cache are still valid without any re-download.

### The acceptance fixture

`humanizer-service/tests/fixtures.py`, shared by every layer:

```markdown
---
title: Release notes
version: 2.4
---

# A Pivotal New Chapter

The system represents a groundbreaking and transformative step forward in the rapidly evolving landscape of local knowledge software.

Version 2.4 shipped on August 19, 2026. Read the [release report](https://example.com/releases/2.4).

Run `npm run build` before publishing.

> "Do not alter this quoted statement."

The measured improvement was 18.5%.
```

It passes only when the frontmatter is byte-for-byte unchanged, `# ` is still a
heading marker, `2.4`, `August 19, 2026`, the URL, `npm run build`, the
blockquote and `18.5%` are all exact, the generic prose is rewritten, no
placeholder survives, the original stays available, the reader sees a diff
first, and no external model API is called.

---

## Not built

The editor integration is designed for and deliberately not built: the
assistant-response action was the required first vertical slice, and adding a
second surface before it is proven would have destabilised it. When it is added,
it needs the same optimistic-concurrency rule as the apply path — if the
document changed after the rewrite began, refuse and ask for a fresh one — and
it should reuse `HumanizerReviewDialog` unchanged, passing selected prose, the
current paragraph or the whole note as `content`.
