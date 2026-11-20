# PaperOrchestra

`/agents:paper-orchestra` writes a research paper from the person's idea and
results: an outline, a literature review whose citations are checked against
Semantic Scholar, the sections, and three review-and-revise rounds, compiled to
a PDF. The PDF and the LaTeX source are attached to the chat as artifacts.

The runtime is [google-research/paper-orchestra](https://github.com/google-research/paper-orchestra),
vendored at `paper-orchestra/` (pin in `VENDORED_REPOSITORIES.md`). Breadboard
runs its pipeline unchanged; it does not port it.

```text
/agents:paper-orchestra <idea + results> [--cvpr] [--plots]
        |
  POST /api/paper-orchestra/runs        (records the turn, like Claude Code)
        |
  scripts/paper-orchestra-bridge.py     (stdin: job JSON, stdout: NDJSON stages)
        |
  outline → literature → [plots] → sections → review/compile ×3
        |
  final_paper.pdf + LaTeX folder  →  artifacts of the launching chat
```

## On the chat's model, through ChatMock

Upstream calls Gemini directly (and OpenAI for `gpt*` names), several stages
with hard-coded Gemini model ids. The bridge replaces upstream's call layer
before any agent module is imported, so **every** model call — whatever model
name upstream asks for — goes to ChatMock's `/v1/chat/completions` with the
model selected in chat. PDFs upstream would send to Gemini as bytes are sent
as extracted text; images go as `image_url` parts.

Upstream finds related work with Gemini's Google Search grounding. That is
replaced by Breadboard's own catalog search, the one Get Doc uses:

- **Literature discovery.** For each search task the model writes a few
  keyword queries; the bridge sends them to the run manager as a `search`
  event, which runs `searchDocuments` (OpenAlex, arXiv, Europe PMC, Semantic
  Scholar, Crossref, merged and ranked) and answers on the bridge's stdin. The
  model then picks the relevant hits from that list. Each search shows on the
  run card as a `catalog_search` step.
- **Bibliography.** The picked papers' catalog records (authors, year, venue,
  abstract, citation count) become upstream's `PaperData` directly, so no
  citation is built from the model's memory and the rate-limited
  per-title Semantic Scholar lookup is skipped.
- **Diagram drawing** (`--plots` only) uses the first image-capable model
  ChatMock advertises, found the way ViMax finds it. With none, diagrams are
  skipped.

## LaTeX: Tectonic, not pdflatex

Upstream shells out to `pdflatex`/`bibtex`, which this machine does not have.
The bridge swaps `compile_latex` for `tectonic -X compile`, which runs BibTeX
and the reruns itself and fetches TeX packages on first use (the first compile
of a run can take a few minutes).

## Setup

Once per computer, from the Breadboard folder:

```text
node scripts/setup-paper-orchestra.mjs
```

It builds a Python 3.11 venv with upstream's requirements (minus Streamlit)
using `uv`, and downloads Tectonic, both into `~/.breadboard/paper-orchestra`
(`PAPER_ORCHESTRA_HOME` overrides). Runs never install anything; health reports
the missing step instead. Each run's working files stay in
`<home>/runs/<runId>` (raw materials, outline, literature output, LaTeX).

## Inputs

- The message (plus earlier chat context) is the idea. Upstream also wants a
  separate experimental log; the brief is written there too, with an explicit
  instruction to use only numbers the author stated.
- Attached images become the paper's figures (`figures/info.json`).
- `--cvpr` selects the CVPR 2025 template (ICLR 2025 is the default).
- `--plots` turns on upstream's plotting agent. Plots are drawn by **executing
  model-written matplotlib code in the bridge process**, so the route refuses
  it unless YOLO is on with full autonomy — the same bar Claude Code needs to
  run commands.

## Wiring

Shaped like the Claude Code agent: `lib/paper-orchestra/{identity,run-manager}.ts`,
`api/paper-orchestra/{runs,runs/[runId]/events,runs/[runId]/abort,health}`, run
kind `paper_orchestra` (`external-agent-runs.ts`, `external-agent-cancel.ts`),
the shared `InlineOpenCodeRun` card (`apiSlug="paper-orchestra"`), the
`usePaperOrchestraAgent` hook in Terminal, `launchPaperOrchestra` in Garden
chat, the palette row, a runtime profile and a super-agent brief. Runs live in
the dashboard process (not Runtime V2) with a three-hour limit.

Tests: `dashboard/tests/paper-orchestra-agent.test.mjs`.
